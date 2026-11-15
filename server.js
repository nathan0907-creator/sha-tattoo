'use strict';

/**
 * Sha Tattoo — serveur du site (Node 22+, aucune dépendance).
 *
 * Le site public reprend la gazette de L'atelier de Cyrille (gabarits dans src/views, styles et
 * animations dans public/). Ce qui est propre à Sha Tattoo :
 * - pas de réservation en ligne : les rendez-vous se prennent par message ;
 * - un compte client est obligatoire pour écrire (téléphone, nom, prénom, date de naissance,
 *   e-mail facultatif) : les mineurs sont refusés ;
 * - l'espace salon est protégé par un identifiant et un mot de passe choisis par la tatoueuse ;
 * - fermetures, ouvertures et horaires exceptionnels ; jours fériés fermés d'office ;
 * - la tatoueuse peut aussi fixer elle-même un rendez-vous (retouche, suite, petit créneau) ;
 * - chaque demande suit le même chemin : messages → devis → créneau choisi par la tatoueuse
 *   → acompte (PayPal, Wero ou au salon) → rendez-vous confirmé à réception ;
 * - les photos et les flashs sont publiés par la tatoueuse depuis son espace (/salon).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { nowInZone, addDays, weekday, toMinutes, fromMinutes, isValidDate, WEEKDAYS } = require('./src/time');
const { holidaysBetween } = require('./src/holidays');
const { pages, notFound } = require('./src/views/pages');
const { stockageFichiers } = require('./src/stockage');
const notifications = require('./src/push');
const CONFIG = require('./salon.config.js');

// En ligne sur Cloudflare (cloudflare/worker.js), il n'y a ni disque ni dossier : les données sont
// dans la base du salon, les fichiers de public/ sont servis par Cloudflare.
const SUR_CLOUDFLARE = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
const ROOT = typeof __dirname === 'string' ? __dirname : '/';
const PUBLIC = path.join(ROOT, 'public');
const DATA = (typeof process !== 'undefined' && process.env.SHA_DATA) || path.join(ROOT, 'data');
const PORT = Number(typeof process !== 'undefined' && process.env.PORT) || 3100;
const AGE_MINIMUM = 18;
const JOUR = 86400000;
// Les fichiers déposés (photos, images des messages, vidéos) : type « galerie » (public) ou « chat » (privé).
const GALERIE = 'galerie';
const CHAT = 'chat';

/** Le stockage en service (voir src/stockage.js), choisi par initialiser(). */
let stockage = null;

/* ------------------------------------------------------------------ */
/* Base de données : un seul fichier JSON, écrit de façon atomique.    */
/* ------------------------------------------------------------------ */

// Ce que la tatoueuse peut régler depuis son espace ; au départ, les valeurs de salon.config.js.
const REGLAGES_DEFAUT = {
  nom: CONFIG.name,
  titreUne: CONFIG.headline.join(' / '),
  presentation: CONFIG.about.paragraphs.join('\n'),
  adresse: CONFIG.address.street,
  codePostal: CONFIG.address.postalCode,
  ville: CONFIG.address.city,
  telephone: CONFIG.contact.phone,
  email: CONFIG.contact.email,
  instagram: CONFIG.contact.instagram,
  facebook: CONFIG.contact.facebook,
  tiktok: CONFIG.contact.tiktok || '',
  specialites: CONFIG.specialties.join('\n'),
  // Horaires, un réglage par jour (h0 = dimanche … h6 = samedi) : « 09:00-12:30 / 13:30-17:00 », vide = fermé.
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((j) => ['h' + j, (CONFIG.hours[j] || []).map(([a, b]) => `${a}-${b}`).join(' / ')])),
  profil: CONFIG.avatar || '',
  paypal: CONFIG.contact.paypal || '',
  wero: '',
  conditionsAcompte: "L'acompte bloque votre créneau et sera déduit du prix final.",
};
// Ces réglages ne peuvent pas rester vides : à défaut, la valeur de départ revient.
const OBLIGATOIRES = ['nom', 'titreUne', 'adresse', 'codePostal', 'ville'];

/**
 * Les horaires d'un jour, tels que la tatoueuse les écrit : « 9h-12h30 / 13h30-17h », « 09:00-12:30 »…
 * Renvoie les plages en minutes ; une saisie vide veut dire « fermé ».
 */
function lirePlages(saisie, jour) {
  const texteJour = String(saisie || '').trim();
  if (!texteJour || /^ferm[ée]e?$/i.test(texteJour)) return [];
  const heure = (s) => {
    const m = /^(\d{1,2})\s*(?:h|:)?\s*(\d{2})?$/i.exec(s.trim());
    return m ? toMinutes(`${m[1].padStart(2, '0')}:${m[2] || '00'}`) : null;
  };
  const plages = texteJour.split(/\s*(?:\/|,|·|\bet\b|\bpuis\b)\s*/i).filter(Boolean).map((morceau) => {
    const bornes = morceau.split(/\s*[-–—]\s*|\s+à\s+/i);
    const debut = bornes.length === 2 ? heure(bornes[0]) : null;
    const fin = bornes.length === 2 ? heure(bornes[1]) : null;
    if (debut === null || fin === null || fin <= debut) {
      throw new Erreur(400, `Horaires du ${WEEKDAYS[jour]} : écrivez par exemple « 9h-12h30 / 13h30-17h », ou laissez vide pour « fermé ».`);
    }
    return { start: debut, end: fin };
  });
  return plages.sort((a, b) => a.start - b.start);
}
const ecrirePlages = (plages) => plages.map((p) => `${fromMinutes(p.start)}-${fromMinutes(p.end)}`).join(' / ');

/* ------------------------------------------------------------------ */
/* Le calendrier : semaine type, exceptions, jours fériés             */
/* ------------------------------------------------------------------ */

const TYPES_EXCEPTION = { fermeture: 'Fermeture', ouverture: 'Ouverture exceptionnelle', horaires: 'Horaires modifiés' };

/** Les horaires de la semaine type (réglages), en plages de minutes. Une saisie illisible = fermé. */
function horairesSemaine(r) {
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((j) => {
    try {
      return [j, lirePlages(r['h' + j], j)];
    } catch {
      return [j, []];
    }
  }));
}

/** Le jour férié d'une date, s'il y en a un. */
const ferieDu = (date) => holidaysBetween(date, date)[0] || null;

/**
 * Les horaires réels d'une date : une exception saisie par la tatoueuse (fermeture, ouverture
 * exceptionnelle, horaires modifiés) passe en premier ; sinon un jour férié ferme d'office,
 * sauf si elle l'a ouvert (ou a arrêté la fermeture automatique) ; sinon la semaine type.
 */
function horairesDu(date, semaine) {
  const exception = db.exceptions.filter((e) => e.du <= date && date <= e.au).at(-1);
  if (exception) return { plages: exception.type === 'fermeture' ? [] : exception.plages, motif: exception.motif, exception };
  const ferie = ferieDu(date);
  if (ferie && semaine[weekday(date)].length && db.feries.auto && !db.feries.ouverts.includes(date)) {
    return { plages: [], motif: ferie.name + ' (jour férié)', ferie };
  }
  return { plages: semaine[weekday(date)], motif: '' };
}

/** Ouvert en ce moment ? Sinon, quand le salon rouvre (comme le badge de la gazette de Cyrille). */
function etatOuverture(semaine, now) {
  const enCours = horairesDu(now.date, semaine).plages.find((p) => now.minutes >= p.start && now.minutes < p.end);
  if (enCours) return { open: true, until: enCours.end };
  for (let offset = 0; offset < 60; offset++) {
    const date = addDays(now.date, offset);
    const prochaine = horairesDu(date, semaine).plages.find((p) => offset > 0 || p.start > now.minutes);
    if (prochaine) return { open: false, date, offset, at: prochaine.start };
  }
  return { open: false };
}

/**
 * Les prochaines disponibilités, pour une retouche ou un petit tatouage : les plages libres des
 * prochains jours d'ouverture (horaires réels : exceptions et jours fériés compris), moins les
 * rendez-vous déjà fixés ou proposés. À partir du lendemain ; seules les plages d'au moins
 * 30 minutes comptent. Les grosses pièces, elles, ont leur créneau fixé avec le devis.
 */
/** Les rendez-vous fixés ou proposés, jour par jour : ce qui n'est plus libre. */
const creneauxOccupes = () => db.projets.filter((p) => p.creneau && p.etape !== 'annule').map((p) => ({
  date: p.creneau.debut.slice(0, 10),
  start: toMinutes(p.creneau.debut.slice(11)),
  end: toMinutes(p.creneau.debut.slice(11)) + p.creneau.duree,
}));

/** Les plages encore libres d'un jour (au moins « minimum » minutes chacune). */
function libresDu(date, horaires, occupes, minimum = 30) {
  let libres = horaires.plages.map((p) => ({ ...p }));
  for (const o of occupes.filter((x) => x.date === date)) {
    libres = libres.flatMap((l) => {
      if (o.end <= l.start || o.start >= l.end) return [l];
      return [{ start: l.start, end: o.start }, { start: o.end, end: l.end }].filter((x) => x.end > x.start);
    });
  }
  return libres.filter((l) => l.end - l.start >= minimum);
}

function disponibilites(semaine, now, { jours = 5, horizon = 45, minimum = 30 } = {}) {
  const occupes = creneauxOccupes();
  const liste = [];
  for (let offset = 1; offset <= horizon && liste.length < jours; offset++) {
    const date = addDays(now.date, offset);
    const libres = libresDu(date, horairesDu(date, semaine), occupes, minimum);
    if (libres.length) liste.push({ date, jour: jourLong(date), plages: libres, texte: plagesTexte(libres) });
  }
  return liste;
}

/**
 * L'agenda public : les semaines qui viennent, jour par jour, du lundi de la semaine en cours.
 * Pour chaque jour : fermé (et pourquoi), complet, ou les plages encore libres. Aucun nom de
 * client : seulement libre ou pris. Les jours passés sont grisés ; aujourd'hui se demande
 * par téléphone ou message, comme les autres (le créneau est confirmé par la tatoueuse).
 */
function agenda(semaine, now, { semaines = 6, minimum = 30 } = {}) {
  const occupes = creneauxOccupes();
  const lundi = addDays(now.date, -((weekday(now.date) + 6) % 7));
  const jours = [];
  for (let i = 0; i < semaines * 7; i++) {
    const date = addDays(lundi, i);
    const h = horairesDu(date, semaine);
    const base = { date, jour: jourLong(date), numero: Number(date.slice(8)), mois: date.slice(5, 7) };
    if (date < now.date) {
      jours.push({ ...base, etat: 'passe' });
    } else if (!h.plages.length) {
      // Fermé : jour habituel de fermeture, fermeture exceptionnelle ou jour férié.
      jours.push({ ...base, etat: 'ferme', motif: h.ferie ? `${h.ferie.name} (férié)` : h.exception ? (h.motif || 'fermeture') : '' });
    } else {
      const libres = date === now.date
        ? libresDu(date, h, occupes, minimum).map((l) => ({ start: Math.max(l.start, now.minutes), end: l.end })).filter((l) => l.end - l.start >= minimum)
        : libresDu(date, h, occupes, minimum);
      jours.push({
        ...base,
        etat: libres.length ? 'libre' : 'complet',
        horaires: plagesTexte(h.plages),
        libres: plagesTexte(libres),
        modifie: Boolean(h.exception),
        motif: h.exception ? h.motif : '',
      });
    }
  }
  return jours;
}

const frHeure = (min) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const plagesTexte = (plages) => plages.map((p) => `${frHeure(p.start)} – ${frHeure(p.end)}`).join(' · ');
const jourLong = (date) => {
  const [a, m, j] = date.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
};
const periode = (du, au) => (du === au ? `le ${jourLong(du)}` : `du ${jourLong(du)} au ${jourLong(au)}`);

/**
 * Ce que le site annonce (bandeau, « En bref », Pratique) : les exceptions et les jours fériés
 * fermés des deux prochains mois, dites en clair.
 */
function annoncesCalendrier(semaine, aujourdhui, jours = 62) {
  const limite = addDays(aujourdhui, jours);
  const liste = db.exceptions
    .filter((e) => e.au >= aujourdhui && e.du <= limite)
    .map((e) => ({
      du: e.du,
      type: e.type,
      texte: e.type === 'fermeture'
        ? `Fermé ${periode(e.du, e.au)}${e.motif ? ` : ${e.motif}` : ''}`
        : `${e.type === 'ouverture' ? 'Ouverture exceptionnelle' : 'Horaires modifiés'} ${periode(e.du, e.au)} : ${plagesTexte(e.plages)}${e.motif ? ` (${e.motif})` : ''}`,
    }));
  for (const f of holidaysBetween(aujourdhui, limite)) {
    const h = horairesDu(f.date, semaine);
    if (h.ferie) liste.push({ du: f.date, type: 'fermeture', texte: `Fermé le ${jourLong(f.date)} : ${f.name} (jour férié)` });
  }
  return liste.sort((a, b) => a.du.localeCompare(b.du));
}

function reglagesComplets(enregistres = {}) {
  const r = {};
  for (const [cle, defaut] of Object.entries(REGLAGES_DEFAUT)) {
    const v = typeof enregistres[cle] === 'string' ? enregistres[cle] : defaut;
    r[cle] = OBLIGATOIRES.includes(cle) && !v.trim() ? defaut : v;
  }
  return r;
}

/** Les réglages en vigueur : ceux de salon.config.js, sauf ce que la tatoueuse a changé. */
const reglages = () => reglagesComplets(db.reglages);

/** On n'enregistre que ce qui diffère de salon.config.js : le reste continue de suivre ce fichier. */
function garderLesChangements(complets) {
  db.reglages = Object.fromEntries(Object.entries(reglagesComplets(complets)).filter(([cle, v]) => v !== REGLAGES_DEFAUT[cle]));
}

function baseVide() {
  return { clients: [], sessions: {}, projets: [], galerie: [], videos: null, sha: null, reglages: {}, exceptions: [], feries: { auto: true, ouverts: [] } };
}

let db = baseVide();
// Tant que la tatoueuse n'a pas réglé ses vidéos (null), ce sont celles de salon.config.js.
const videosActuelles = () => db.videos || CONFIG.videos || [];

// Enregistrement : sur l'ordinateur, peu après chaque changement ; sur Cloudflare, à la fin de
// chaque requête (cloudflare/worker.js appelle sauverSiBesoin).
let minuterie = null;
let modifie = false;
function sauver() {
  modifie = true;
  if (SUR_CLOUDFLARE) return;
  clearTimeout(minuterie);
  minuterie = setTimeout(sauverMaintenant, 40);
}
function sauverMaintenant() {
  clearTimeout(minuterie);
  modifie = false;
  stockage.ecrireBase(db);
}
function sauverSiBesoin() {
  if (modifie) sauverMaintenant();
}

/**
 * Travaux qui continuent après la réponse (envoi des notifications, récupération d'une vidéo
 * TikTok). Sur Cloudflare, le salon les laisse finir avant de s'endormir (travauxEnCours).
 */
const travaux = new Set();
function enArrierePlan(promesse) {
  const p = Promise.resolve(promesse).catch((e) => console.error(e)).finally(() => travaux.delete(p));
  travaux.add(p);
  return p;
}
const travauxEnCours = () => Promise.all([...travaux]);

/* ------------------------------------------------------------------ */
/* Outils                                                             */
/* ------------------------------------------------------------------ */

class Erreur extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function id() {
  return crypto.randomBytes(9).toString('base64url');
}
const empreinte = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hacher(mdp) {
  const sel = crypto.randomBytes(16).toString('hex');
  return sel + ':' + crypto.scryptSync(mdp, sel, 64).toString('hex');
}
function verifierMdp(mdp, stocke) {
  if (!stocke) {
    crypto.scryptSync(mdp, 'temps-constant-pour-rien', 64);
    return false;
  }
  const [sel, h] = stocke.split(':');
  const a = crypto.scryptSync(mdp, sel, 64);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// L'accès à l'espace salon : un identifiant et un mot de passe choisis par la tatoueuse.
// Tant qu'ils ne sont pas choisis, il faut un code de configuration (à usage unique), à saisir sur
// /salon : sur l'ordinateur, il est tiré au sort à chaque lancement (data/CODE-DE-CONFIGURATION.txt) ;
// en ligne, c'est le secret SETUP_CODE choisi dans Cloudflare.
let codeConfiguration = null;
const accesConfigure = () => Boolean(db.sha && db.sha.identifiant && db.sha.mdp);

/**
 * Démarre le site sur un stockage : lit les données, les complète, prépare l'accès au salon.
 *   code : le code de configuration imposé (Cloudflare) ; sinon un code est tiré au sort.
 */
function initialiser(nouveauStockage, { code = '' } = {}) {
  stockage = nouveauStockage;
  db = { ...baseVide(), ...(stockage.lireBase() || {}) };
  if (!db.reglages || typeof db.reglages !== 'object') db.reglages = {};
  if (!Array.isArray(db.exceptions)) db.exceptions = [];
  if (!Array.isArray(db.videos)) db.videos = null;
  if (!Array.isArray(db.abonnements)) db.abonnements = [];
  db.feries = { auto: true, ouverts: [], ...db.feries };

  // (Nettoyage des anciens flashs d'exemple, si une base créée avant en contient encore.)
  if (db.semee !== undefined || db.galerie.some((g) => g.exemple)) {
    db.galerie = db.galerie.filter((g) => !g.exemple);
    delete db.semee;
  }

  // Les planches de Shannon livrées avec le site (salon.config.js, flashsDepart) : ajoutées une seule
  // fois à la galerie. Ce sont ensuite des flashs comme les autres : elle les renomme, les marque
  // « déjà tatoué » ou les retire (leur image reste dans public/img/flashs, rien n'est effacé).
  if (!db.flashsDepart && Array.isArray(CONFIG.flashsDepart)) {
    const t = Date.now();
    CONFIG.flashsDepart.forEach((f, i) => {
      if (db.galerie.some((g) => g.src === f.src)) return;
      db.galerie.push({ id: crypto.randomBytes(8).toString('hex'), type: 'flash', titre: f.titre, prix: null, src: f.src, largeur: f.largeur, hauteur: f.hauteur, dispo: true, at: t - i * 1000 });
    });
    db.flashsDepart = true;
  }

  // Les fermetures données par la tatoueuse dans salon.config.js : ajoutées une seule fois au
  // calendrier (elle peut ensuite les retirer ou les changer dans l'onglet Fermetures).
  const ajoutees = new Set(db.fermeturesAjoutees || []);
  for (const f of CONFIG.fermetures || []) {
    if (!f.cle || ajoutees.has(f.cle)) continue;
    const au = f.au || f.du;
    db.exceptions.push({ id: id(), type: f.type, du: f.du, au, plages: f.type === 'fermeture' ? [] : lirePlages(f.horaires, weekday(f.du)), motif: f.motif || '', at: Date.now() });
    ajoutees.add(f.cle);
  }
  db.fermeturesAjoutees = [...ajoutees];

  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < Date.now()) delete db.sessions[k];

  codeConfiguration = null;
  if (!accesConfigure()) {
    db.sha = null;
    // Les anciennes connexions à l'espace salon ne valent plus.
    for (const [k, s] of Object.entries(db.sessions || {})) if (s.qui === 'sha') delete db.sessions[k];
    if (code) codeConfiguration = String(code);
    else {
      codeConfiguration = crypto.randomInt(0, 1e8).toString().padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1-$2');
      stockage.noterCode(codeConfiguration);
    }
  }
  sauverMaintenant();
}

function identifiantValide(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,40}$/.test(s)) throw new Erreur(400, 'Identifiant : 3 à 40 caractères, lettres, chiffres, point, tiret ou @.');
  return s;
}
function nouveauMotDePasse(v) {
  const m = String(v || '');
  if (m.length < 10 || m.length > 200) throw new Erreur(400, 'Mot de passe : 10 caractères minimum.');
  return m;
}

const texte = (v, max, nom, requis = true) => {
  const s = typeof v === 'string' ? v.trim().replace(/\r\n/g, '\n') : '';
  if (requis && !s) throw new Erreur(400, `${nom} : champ obligatoire.`);
  if (s.length > max) throw new Erreur(400, `${nom} : ${max} caractères maximum.`);
  return s;
};

function contactValide(v) {
  const s = String(v || '').trim();
  if (s.includes('@')) {
    const e = s.toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/.test(e) || e.length > 120) throw new Erreur(400, 'Adresse e-mail invalide.');
    return { type: 'email', valeur: e };
  }
  let t = s.replace(/[\s.\-()]/g, '');
  if (/^0033/.test(t)) t = '+33' + t.slice(4);
  if (/^\+33[1-9]\d{8}$/.test(t)) t = '0' + t.slice(3);
  if (/^0[1-9]\d{8}$/.test(t) || /^\+\d{8,15}$/.test(t)) return { type: 'tel', valeur: t };
  throw new Erreur(400, 'Entrez une adresse e-mail ou un numéro de téléphone valide.');
}

function ageAu(naissance, maintenant = new Date()) {
  const [a, m, j] = naissance.split('-').map(Number);
  let age = maintenant.getFullYear() - a;
  const mois = maintenant.getMonth() + 1;
  if (mois < m || (mois === m && maintenant.getDate() < j)) age--;
  return age;
}

function naissanceValide(v) {
  const s = String(v || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Erreur(400, 'Date de naissance invalide.');
  const age = ageAu(s);
  if (age < 0 || age > 120) throw new Erreur(400, 'Date de naissance invalide.');
  if (age < AGE_MINIMUM) throw new Erreur(403, 'Le salon ne tatoue pas les personnes mineures.');
  return s;
}

const entier = (v, min, max, nom) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Erreur(400, `${nom} : nombre entre ${min} et ${max}.`);
  return n;
};

const SIGNATURES = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

/** Enregistre une image envoyée en « data URL » (déjà redimensionnée par le navigateur). */
function enregistrerImage(dataUrl, dossier) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Erreur(400, 'Image non reconnue (JPEG, PNG ou WebP).');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw new Erreur(413, 'Image trop lourde (4 Mo maximum).');
  if (!SIGNATURES[ext](buf)) throw new Erreur(400, 'Le fichier ne correspond pas à une image valide.');
  const nom = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  stockage.ecrire(dossier, nom, buf);
  return nom;
}

/** Efface un fichier déposé dont on connaît l'adresse publique (« /galerie/… »). */
function effacerDeLaGalerie(src) {
  if (/^\/galerie\//.test(src || '')) stockage.supprimer(GALERIE, path.basename(src));
}

/* ------------------------------------------------------------------ */
/* Sessions, cookies, limites                                         */
/* ------------------------------------------------------------------ */

const COOKIE = { client: 'sha_client', sha: 'sha_atelier' };
// La tatoueuse reste connectée un mois sur son appareil (application installée, notifications).
const DUREE = { client: 30 * JOUR, sha: 30 * JOUR };

function lireCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // Cookie illisible : ignoré.
      }
    }
  }
  return out;
}

const securise = (req) => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);

function poserCookie(req, res, nom, valeur, maxAge) {
  const c = `${nom}=${valeur}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${securise(req) ? '; Secure' : ''}`;
  const avant = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...avant, c]);
}

function ouvrirSession(req, res, qui, cible) {
  const jeton = crypto.randomBytes(32).toString('base64url');
  db.sessions[empreinte(jeton)] = { qui, id: cible, exp: Date.now() + DUREE[qui] };
  sauver();
  poserCookie(req, res, COOKIE[qui], jeton, Math.floor(DUREE[qui] / 1000));
}

function session(req, qui) {
  const jeton = lireCookies(req)[COOKIE[qui]];
  if (!jeton) return null;
  const s = db.sessions[empreinte(jeton)];
  return s && s.qui === qui && s.exp > Date.now() ? s : null;
}

function fermerSession(req, res, qui) {
  const jeton = lireCookies(req)[COOKIE[qui]];
  if (jeton) delete db.sessions[empreinte(jeton)];
  sauver();
  poserCookie(req, res, COOKIE[qui], '', 0);
}

function clientDeLaSession(req) {
  const s = session(req, 'client');
  return (s && db.clients.find((x) => x.id === s.id)) || null;
}
function clientConnecte(req) {
  const c = clientDeLaSession(req);
  if (!c) throw new Erreur(401, 'Connectez-vous pour continuer.');
  return c;
}
function exigerSha(req) {
  if (!accesConfigure() || !session(req, 'sha')) throw new Erreur(401, 'Session expirée : reconnectez-vous.');
}

const essais = new Map();
function ip(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
/** Connexions : seuls les échecs comptent ; après trop d'échecs, l'adresse attend un quart d'heure. */
function tropDEchecs(req, cle, max) {
  const e = essais.get(cle + '|' + ip(req));
  if (e && e.fin > Date.now() && e.n >= max) throw new Erreur(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
}
function noterEchec(req, cle, fenetre = 15 * 60000) {
  const k = cle + '|' + ip(req);
  const now = Date.now();
  let e = essais.get(k);
  if (!e || e.fin < now) essais.set(k, (e = { n: 0, fin: now + fenetre }));
  e.n++;
}

function limiter(req, cle, max = 10, fenetre = 15 * 60000) {
  const k = cle + '|' + ip(req);
  const now = Date.now();
  let e = essais.get(k);
  if (!e || e.fin < now) essais.set(k, (e = { n: 0, fin: now + fenetre }));
  if (++e.n > max) throw new Erreur(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
}

/* ------------------------------------------------------------------ */
/* Le contexte des pages : réglages, galerie, date du jour             */
/* ------------------------------------------------------------------ */

const FORMATS = [['16/9', 16 / 9], ['4/3', 4 / 3], ['1/1', 1], ['4/5', 4 / 5], ['3/4', 3 / 4]];

/** Une image de la galerie, telle que les gabarits l'attendent (format le plus proche du sien). */
function decrireImage(g) {
  const r = g.largeur && g.hauteur ? g.largeur / g.hauteur : 4 / 5;
  const ratio = FORMATS.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0];
  return {
    id: g.id,
    src: g.src,
    alt: g.titre || (g.type === 'flash' ? 'Planche de flashs' : 'Tatouage réalisé au salon'),
    title: g.titre || '',
    price: g.prix || null,
    available: g.dispo !== false,
    planche: g.type === 'flash',
    ratio,
    width: g.largeur || null,
    height: g.hauteur || null,
  };
}

/** « @sha.tattoo », « sha.tattoo » ou une adresse complète → l'adresse du compte. */
function lienReseau(valeur, racine) {
  const v = String(valeur || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return racine + encodeURIComponent(v.replace(/^@/, ''));
}

/** « @sha22.10 », « sha22.10 » ou une adresse complète → l'adresse du compte TikTok. */
function lienTiktok(valeur) {
  const v = String(valeur || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return 'https://www.tiktok.com/@' + encodeURIComponent(v.replace(/^@/, ''));
}

/** Le nom PayPal.me (« ShannonLouis641 ») tiré de ce qu'a écrit la tatoueuse, ou ''. */
const nomPaypal = (valeur) => String(valeur || '').trim().replace(/^https?:\/\//, '').replace(/^(www\.)?paypal\.me\//i, '').split(/[/?#]/)[0];

function contexte(req, chemin) {
  const r = reglages();
  const full = `${r.adresse}, ${r.codePostal} ${r.ville}`;
  const q = encodeURIComponent(full);
  const images = db.galerie.slice().sort((a, b) => b.at - a.at);
  const photos = images.filter((g) => g.type === 'photo').map(decrireImage);
  const client = clientDeLaSession(req);
  const hote = /^[\w.:[\]-]+$/.test(req.headers.host || '') ? req.headers.host : `localhost:${PORT}`;
  const now = nowInZone(CONFIG.timezone || 'Europe/Paris');
  // Des horaires mal écrits ne doivent jamais empêcher une page de s'afficher : le jour est alors « fermé ».
  const hours = horairesSemaine(r);
  return {
    path: chemin,
    origin: CONFIG.siteUrl || `${securise(req) ? 'https' : 'http'}://${hote}`,
    now,
    status: etatOuverture(hours, now),
    annonces: annoncesCalendrier(hours, now.date),
    disponibilites: disponibilites(hours, now),
    agenda: agenda(hours, now),
    flashs: images.filter((g) => g.type === 'flash').map(decrireImage),
    videos: videosActuelles().map((v) => ({ id: v.id, auteur: v.auteur, titre: v.titre || '', vignette: v.vignette || '', fichier: v.fichier || '' })),
    client: client && {
      unread: db.projets.filter((p) => p.client === client.id).reduce((n, p) => n + (p.messages.length - p.vuClient), 0),
    },
    config: {
      name: r.nom,
      tagline: CONFIG.tagline,
      trade: CONFIG.tagline || 'Salon de tatouage',
      description: CONFIG.description,
      siteUrl: CONFIG.siteUrl || '',
      headline: r.titreUne.split('/').map((s) => s.trim()).filter(Boolean),
      seo: { nearby: [], ...CONFIG.seo },
      contact: {
        phone: r.telephone,
        email: r.email,
        instagram: lienReseau(r.instagram, 'https://www.instagram.com/'),
        facebook: lienReseau(r.facebook, 'https://www.facebook.com/'),
        tiktok: lienTiktok(r.tiktok),
        paypal: nomPaypal(r.paypal) ? 'https://www.paypal.me/' + encodeURIComponent(nomPaypal(r.paypal)) : '',
      },
      evenements: CONFIG.evenements,
      flashsExemple: CONFIG.flashsExemple || [],
      address: { street: r.adresse, postalCode: r.codePostal, city: r.ville, full },
      maps: {
        embed: `https://www.google.com/maps?q=${q}&output=embed`,
        directions: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
        view: `https://www.google.com/maps/search/?api=1&query=${q}`,
      },
      booking: { ...CONFIG.booking },
      hours,
      hoursNote: CONFIG.hoursNote || '',
      style: CONFIG.style || '',
      specialties: r.specialites.split(/\n+/).map((s) => s.trim()).filter(Boolean),
      avatar: r.profil,
      depositTerms: r.conditionsAcompte,
      about: { paragraphs: r.presentation.split(/\n+/).map((s) => s.trim()).filter(Boolean) },
      // Les photos publiées par Shannon ; à défaut, ses flashs (demande de la cliente : « remplace les
      // photos par les flashs ») ; à défaut encore, les images « exemple ».
      photos: (() => {
        // Les planches les plus nettes d'abord (plus de pixels) : certaines ne font que 226 pixels de
        // large et seraient floues en grand sur un téléphone.
        const planches = images.filter((g) => g.type === 'flash' && g.dispo !== false)
          .sort((a, b) => (b.largeur || 0) - (a.largeur || 0)).map(decrireImage);
        const gallery = photos.length ? photos : planches.length ? planches : (CONFIG.photosExemple || []);
        return { hero: photos[0] || planches[0] || CONFIG.photoUne || null, gallery };
      })(),
      legal: { company: r.nom, status: '', siret: '', publisher: '', host: '', ...CONFIG.legal },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Demandes (messages → devis → créneau → acompte → confirmé)         */
/* ------------------------------------------------------------------ */

const MODES = { paypal: 'PayPal', wero: 'Wero', salon: 'au salon' };

function projetDe(c, pid) {
  const p = db.projets.find((x) => x.id === pid && x.client === c.id);
  if (!p) throw new Erreur(404, 'Demande introuvable.');
  return p;
}
function projet(pid) {
  const p = db.projets.find((x) => x.id === pid);
  if (!p) throw new Erreur(404, 'Demande introuvable.');
  return p;
}

function ajouterMessage(p, de, texteMsg, image = null) {
  if (p.messages.length >= 600) throw new Erreur(400, 'Cette conversation est pleine : ouvrez une nouvelle demande.');
  const m = { id: id(), de, texte: texteMsg, image, at: Date.now() };
  p.messages.push(m);
  p.maj = Date.now();
  aPrevenir(p, m);
}

/* ------------------------------------------------------------------ */
/* Notifications : l'autre personne est prévenue de chaque nouveauté   */
/* ------------------------------------------------------------------ */

// Pendant une requête : qui agit (la tatoueuse sur /api/sha/…, sinon le client), et les demandes
// où quelque chose de nouveau s'est passé. Une seule notification par demande et par requête, avec
// le message le plus parlant (celui d'une personne plutôt qu'une ligne automatique).
let acteur = null;
const nouveautes = new Map();
// L'adresse sous laquelle le site est visité (https://…workers.dev, puis le nom de domaine).
let origineConnue = '';

function aPrevenir(p, m) {
  if (!acteur) return;
  const deja = nouveautes.get(p.id);
  if (!deja || (deja.m.de === 'systeme' && m.de !== 'systeme')) nouveautes.set(p.id, { p, m });
}

const resume = (m) => (m.texte ? m.texte.replace(/\s+/g, ' ').slice(0, 140) : m.image ? 'Photo' : 'Nouveau message');

/** Les clés du site pour les notifications (créées une fois, gardées avec les données). */
function clesPush() {
  if (!db.push || !db.push.publicKey) {
    db.push = notifications.generateKeys();
    sauver();
  }
  return db.push;
}

/** Envoie une notification à chaque appareil abonné de la personne ; oublie ceux qui n'existent plus. */
function notifier(cible, message) {
  const abonnes = db.abonnements.filter((a) => a.qui === cible.qui && a.id === cible.id);
  if (!abonnes.length) return;
  const cles = clesPush();
  // L'adresse du site, que les services de notification (Apple surtout) demandent à connaître.
  const sujet = CONFIG.siteUrl || (/^https:/.test(origineConnue) ? origineConnue : 'mailto:contact@sha-tattoo.invalid');
  enArrierePlan(Promise.all(abonnes.map(async (a) => {
    try {
      const r = await notifications.sendPush(a, message, { keys: cles, subject: sujet, ttl: 24 * 3600 });
      if (r.gone) {
        db.abonnements = db.abonnements.filter((x) => x.endpoint !== a.endpoint);
        sauver();
      }
    } catch { /* service injoignable : la notification est perdue, le message reste sur le site */ }
  })));
}

/** À la fin d'une requête : prévenir l'autre personne de ce qui vient de se passer. */
function envoyerNouveautes() {
  for (const { p, m } of nouveautes.values()) {
    if (acteur === 'sha') {
      if (!p.client) continue; // rendez-vous pris pour une personne sans compte
      const nonLus = db.projets.filter((x) => x.client === p.client).reduce((n, x) => n + (x.messages.length - x.vuClient), 0);
      notifier({ qui: 'client', id: p.client }, { title: reglages().nom, body: resume(m), url: '/?messages=' + p.id, tag: 'projet-' + p.id, badge: nonLus });
    } else {
      const c = db.clients.find((x) => x.id === p.client);
      const nonLus = db.projets.reduce((n, x) => n + (x.messages.length - (x.vuSha || 0)), 0);
      notifier({ qui: 'sha', id: 'sha' }, { title: `${c ? `${c.prenom} ${c.nom}` : 'Client'} · ${p.titre}`, body: resume(m), url: '/salon?demande=' + p.id, tag: 'projet-' + p.id, badge: nonLus });
    }
  }
  nouveautes.clear();
}

function infoFlash(fid) {
  const f = fid && db.galerie.find((g) => g.id === fid && g.type === 'flash');
  return f ? { id: f.id, titre: f.titre, src: f.src, prix: f.prix } : null;
}

function lienPaypal(montant) {
  const u = nomPaypal(reglages().paypal);
  return u ? `https://paypal.me/${encodeURIComponent(u)}/${montant}EUR` : null;
}

const fmtCreneau = (debut) => {
  const [d, h] = debut.split('T');
  const [a, m, j] = d.split('-').map(Number);
  const date = new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${date} à ${h.replace(':', ' h ')}`;
};

const dureeTexte = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ' ' + String(min % 60).padStart(2, '0') : ''}`);

function vueProjet(p, pourSha) {
  const r = reglages();
  const out = {
    id: p.id,
    titre: p.titre,
    etape: p.etape,
    cree: p.cree,
    flash: infoFlash(p.flash),
    infos: p.infos || null,
    messages: p.messages,
    devis: p.devis,
    creneau: p.creneau,
    acompte: p.acompte,
  };
  if (p.devis && ['creneau', 'acompte_declare', 'confirme'].includes(p.etape)) {
    out.paiement = {
      reference: 'SHA-' + p.id.slice(0, 6).toUpperCase(),
      paypal: lienPaypal(p.devis.acompte),
      wero: r.wero || null,
      salon: `${r.adresse}, ${r.codePostal} ${r.ville}`,
      conditions: r.conditionsAcompte,
    };
  }
  if (pourSha) out.client = ficheClient(p);
  return out;
}

/** Le client d'une demande : un compte, ou une personne notée par le salon (sans compte). */
function ficheClient(p) {
  const c = p.client && db.clients.find((x) => x.id === p.client);
  if (c) {
    return {
      id: c.id, prenom: c.prenom, nom: c.nom, telephone: c.telephone || (c.typeContact === 'tel' ? c.contact : ''),
      email: c.email || (c.typeContact === 'email' ? c.contact : ''), naissance: c.naissance, age: ageAu(c.naissance), compte: true,
    };
  }
  if (p.externe) return { prenom: p.externe.nom, nom: '', telephone: p.externe.telephone, email: '', compte: false };
  return null;
}
const nomClient = (p) => {
  const f = ficheClient(p);
  return f ? `${f.prenom} ${f.nom}`.trim() : 'Client';
};

function chevauchement(p, debut, duree) {
  const d = Date.parse(debut + ':00Z');
  const f = d + duree * 60000;
  return db.projets.find((x) => {
    if (x.id === p.id || !x.creneau || x.etape === 'annule') return false;
    const xd = Date.parse(x.creneau.debut + ':00Z');
    return xd < f && d < xd + x.creneau.duree * 60000;
  });
}

/* ------------------------------------------------------------------ */
/* Routes de l'API                                                    */
/* ------------------------------------------------------------------ */

const routes = [];
const route = (methode, motif, fn) => routes.push({ methode, motif: new RegExp('^' + motif + '$'), fn });

// --- Public
route('GET', '/api/galerie', () =>
  db.galerie
    .slice()
    .sort((a, b) => b.at - a.at)
    .map(({ id: i, type, titre, prix, src, dispo }) => ({ id: i, type, titre, prix, src, dispo })),
);

// --- Compte client
// Le compte client : le numéro de téléphone est obligatoire (il sert aussi à se connecter),
// l'e-mail est facultatif. La date de naissance bloque les personnes mineures.
route('POST', '/api/inscription', (req, res, corps) => {
  limiter(req, 'inscription', 8, 60 * 60000);
  const tel = contactValide(corps.telephone);
  if (tel.type !== 'tel') throw new Erreur(400, 'Entrez un numéro de téléphone valide.');
  const email = corps.email ? contactValide(corps.email) : null;
  if (email && email.type !== 'email') throw new Erreur(400, 'Adresse e-mail invalide.');
  const prenom = texte(corps.prenom, 60, 'Prénom');
  const nom = texte(corps.nom, 60, 'Nom');
  const naissance = naissanceValide(corps.naissance);
  const mdp = String(corps.motDePasse || '');
  if (mdp.length < 8 || mdp.length > 200) throw new Erreur(400, 'Mot de passe : 8 caractères minimum.');
  if (db.clients.some((c) => c.telephone === tel.valeur || c.contact === tel.valeur)) throw new Erreur(409, 'Un compte existe déjà avec ce numéro.');
  if (email && db.clients.some((c) => c.email === email.valeur || c.contact === email.valeur)) throw new Erreur(409, 'Un compte existe déjà avec cette adresse e-mail.');
  const c = {
    id: id(), typeContact: 'tel', contact: tel.valeur, telephone: tel.valeur, email: email ? email.valeur : '',
    prenom, nom, naissance, mdp: hacher(mdp), cree: Date.now(),
  };
  db.clients.push(c);
  ouvrirSession(req, res, 'client', c.id);
  return { ok: true };
});

route('POST', '/api/connexion', (req, res, corps) => {
  tropDEchecs(req, 'connexion', 10);
  let contact;
  try {
    contact = contactValide(corps.contact).valeur;
  } catch {
    contact = '';
  }
  const c = contact && db.clients.find((x) => x.contact === contact || x.telephone === contact || x.email === contact);
  if (!verifierMdp(String(corps.motDePasse || ''), c && c.mdp)) {
    noterEchec(req, 'connexion');
    throw new Erreur(401, 'Identifiant ou mot de passe incorrect.');
  }
  ouvrirSession(req, res, 'client', c.id);
  return { ok: true };
});

route('POST', '/api/deconnexion', (req, res) => {
  fermerSession(req, res, 'client');
  return { ok: true };
});

route('GET', '/api/moi', (req) => {
  // Un simple visiteur n'est pas une erreur : la messagerie lui présente l'assistant.
  const c = clientDeLaSession(req);
  if (!c) return { client: null, projets: [] };
  const projets = db.projets
    .filter((p) => p.client === c.id)
    .sort((a, b) => b.maj - a.maj)
    .map((p) => ({ id: p.id, titre: p.titre, etape: p.etape, maj: p.maj, creneau: p.creneau, nonLus: p.messages.length - p.vuClient }));
  return { client: { prenom: c.prenom, nom: c.nom, contact: c.contact }, projets };
});

// Une nouvelle demande. Avant d'envoyer, trois choses obligatoires pour que la tatoueuse puisse
// chiffrer : la photo de référence (sauf pour un flash, qui en tient lieu), l'endroit du corps et la
// taille. Le message libre est facultatif. Photos supplémentaires possibles (images).
route('POST', '/api/projets', (req, res, corps) => {
  const c = clientConnecte(req);
  limiter(req, 'projet', 15, 60 * 60000);
  const ouverts = db.projets.filter((p) => p.client === c.id && !['confirme', 'annule'].includes(p.etape));
  if (ouverts.length >= 5) throw new Erreur(400, 'Vous avez déjà 5 demandes en cours : continuez dans l’une d’elles.');
  if (corps.evenement) return demandeEvenement(c, corps);
  const flash = infoFlash(corps.flash);
  if (!corps.reference && !flash) throw new Erreur(400, 'Ajoutez une photo de référence.');
  const emplacement = texte(corps.emplacement, 80, 'Endroit du tatouage');
  const taille = texte(corps.taille, 40, 'Taille');
  const msg = texte(corps.texte, 2000, 'Message', false);
  const reference = corps.reference ? enregistrerImage(corps.reference, CHAT) : null;
  const suite = Array.isArray(corps.images) ? corps.images.slice(0, 3) : [];
  const p = {
    id: id(), client: c.id, cree: Date.now(), maj: Date.now(), etape: 'discussion',
    titre: flash ? (flash.titre ? 'Flash « ' + flash.titre + ' »' : 'Demande de flash') : `Projet · ${emplacement}`.slice(0, 60),
    flash: flash ? flash.id : null, infos: { emplacement, taille, reference },
    messages: [], devis: null, creneau: null, acompte: null, vuClient: 0, vuSha: 0,
  };
  ajouterMessage(p, 'client', [`Endroit : ${emplacement}`, `Taille : ${taille}`, msg].filter(Boolean).join('\n'), reference);
  for (const extra of suite) {
    ajouterMessage(p, 'client', texte(extra && extra.texte, 200, 'Légende', false), enregistrerImage(extra && extra.image, CHAT));
  }
  ajouterMessage(p, 'systeme', 'Demande envoyée. La réponse et votre devis arriveront ici.');
  p.vuClient = p.messages.length;
  db.projets.push(p);
  sauver();
  return vueProjet(p);
});

/**
 * Une demande d'animation tatouage (mariage, anniversaire, autre événement privé) : pas de photo
 * de référence, mais ce qu'il faut pour chiffrer — le type d'événement, la date, le lieu (le
 * tarif dépend du déplacement) et, si on le sait, le nombre d'invités à tatouer et la durée.
 */
const TYPES_EVENEMENT = ['Mariage', 'Anniversaire', 'Autre événement privé'];
function demandeEvenement(c, corps) {
  const e = corps.evenement || {};
  const type = TYPES_EVENEMENT.includes(e.type) ? e.type : null;
  if (!type) throw new Erreur(400, 'Choisissez le type d’événement.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) || isNaN(Date.parse(e.date))) throw new Erreur(400, 'Indiquez la date de l’événement.');
  if (e.date < nowInZone(CONFIG.timezone || 'Europe/Paris').date) throw new Erreur(400, 'La date de l’événement est déjà passée.');
  const lieu = texte(e.lieu, 80, 'Lieu de l’événement');
  const invites = texte(e.invites, 40, 'Nombre d’invités', false);
  const duree = texte(e.duree, 40, 'Durée', false);
  const msg = texte(corps.texte, 2000, 'Message', false);
  const [a, m, j] = e.date.split('-');
  const dateFr = `${j}/${m}/${a}`;
  const p = {
    id: id(), client: c.id, cree: Date.now(), maj: Date.now(), etape: 'discussion',
    titre: `${type} · ${dateFr}`, flash: null,
    infos: { evenement: { type, date: e.date, lieu, invites, duree } },
    messages: [], devis: null, creneau: null, acompte: null, vuClient: 0, vuSha: 0,
  };
  ajouterMessage(p, 'client', [`Animation tatouage : ${type.toLowerCase()}`, `Date : ${dateFr}`, `Lieu : ${lieu}`,
    invites ? `Invités à tatouer : ${invites}` : '', duree ? `Durée souhaitée : ${duree}` : '', msg].filter(Boolean).join('\n'));
  ajouterMessage(p, 'systeme', 'Demande envoyée. La réponse et votre devis arriveront ici.');
  p.vuClient = p.messages.length;
  db.projets.push(p);
  sauver();
  return vueProjet(p);
}

route('GET', '/api/projets/([\\w-]+)', (req, res, corps, [pid]) => {
  const p = projetDe(clientConnecte(req), pid);
  if (p.vuClient !== p.messages.length) {
    p.vuClient = p.messages.length;
    sauver();
  }
  return vueProjet(p);
});

route('POST', '/api/projets/([\\w-]+)/messages', (req, res, corps, [pid]) => {
  const p = projetDe(clientConnecte(req), pid);
  if (p.etape === 'annule') throw new Erreur(400, 'Cette demande est clôturée.');
  limiter(req, 'message', 120, 60 * 60000);
  const msg = texte(corps.texte, 2000, 'Message', !corps.image);
  const image = corps.image ? enregistrerImage(corps.image, CHAT) : null;
  ajouterMessage(p, 'client', msg, image);
  p.vuClient = p.messages.length;
  sauver();
  return vueProjet(p);
});

route('POST', '/api/projets/([\\w-]+)/accepter-devis', (req, res, corps, [pid]) => {
  const p = projetDe(clientConnecte(req), pid);
  if (p.etape !== 'devis') throw new Erreur(400, 'Aucun devis en attente.');
  if (p.creneau) {
    // Devis et créneau acceptés ensemble : reste l'acompte.
    p.etape = 'creneau';
    ajouterMessage(p, 'systeme', `Devis accepté (${p.devis.prix} €) pour le ${fmtCreneau(p.creneau.debut)}. Réglez l’acompte de ${p.devis.acompte} € pour bloquer ce créneau.`);
  } else {
    p.etape = 'devis_accepte';
    ajouterMessage(p, 'systeme', `Devis accepté (${p.devis.prix} €). Votre créneau va vous être proposé.`);
  }
  p.vuClient = p.messages.length;
  sauver();
  return vueProjet(p);
});

route('POST', '/api/projets/([\\w-]+)/acompte', (req, res, corps, [pid]) => {
  const p = projetDe(clientConnecte(req), pid);
  if (p.etape !== 'creneau') throw new Erreur(400, 'Aucun acompte à régler pour le moment.');
  const mode = String(corps.mode || '');
  if (!MODES[mode]) throw new Erreur(400, 'Choisissez PayPal, Wero ou le salon.');
  p.acompte = { mode, declare: Date.now(), recu: null };
  p.etape = 'acompte_declare';
  ajouterMessage(
    p,
    'systeme',
    mode === 'salon'
      ? `Acompte de ${p.devis.acompte} € : à déposer au salon. Le rendez-vous sera confirmé à réception.`
      : `Acompte de ${p.devis.acompte} € envoyé par ${MODES[mode]}. Le rendez-vous sera confirmé dès réception.`,
  );
  p.vuClient = p.messages.length;
  sauver();
  return vueProjet(p);
});

// Images des messages : visibles uniquement par le client de la demande et par la tatoueuse.
route('GET', '/api/projets/([\\w-]+)/images/([\\w.-]+)', (req, res, corps, [pid, fichier]) => {
  const p = session(req, 'sha') ? projet(pid) : projetDe(clientConnecte(req), pid);
  if (!p.messages.some((m) => m.image === fichier)) throw new Erreur(404, 'Image introuvable.');
  return { prive: true, type: CHAT, nom: fichier };
});

// --- Notifications : un appareil s'abonne (client connecté, ou la tatoueuse dans son espace)
route('GET', '/api/notifications/cle', () => ({ cle: clesPush().publicKey }));

function abonner(qui, idPersonne, corps) {
  const a = notifications.readSubscription(corps);
  if (!a) throw new Erreur(400, 'Abonnement aux notifications non reconnu.');
  db.abonnements = db.abonnements.filter((x) => x.endpoint !== a.endpoint);
  db.abonnements.push({ ...a, qui, id: idPersonne, at: Date.now() });
  // Pas plus de 10 appareils par personne : les plus anciens sont oubliés.
  const siens = db.abonnements.filter((x) => x.qui === qui && x.id === idPersonne);
  if (siens.length > 10) db.abonnements = db.abonnements.filter((x) => !siens.slice(0, siens.length - 10).includes(x));
  sauver();
  return { ok: true };
}
function desabonner(corps) {
  db.abonnements = db.abonnements.filter((x) => x.endpoint !== String(corps.endpoint || ''));
  sauver();
  return { ok: true };
}

route('POST', '/api/notifications', (req, res, corps) => abonner('client', clientConnecte(req).id, corps));
route('DELETE', '/api/notifications', (req, res, corps) => desabonner(corps));
route('POST', '/api/sha/notifications', (req, res, corps) => {
  exigerSha(req);
  return abonner('sha', 'sha', corps);
});
route('DELETE', '/api/sha/notifications', (req, res, corps) => {
  exigerSha(req);
  return desabonner(corps);
});
// Un essai, pour que la tatoueuse voie à quoi ressemble une notification.
route('POST', '/api/sha/notifications/essai', (req) => {
  exigerSha(req);
  if (!db.abonnements.some((a) => a.qui === 'sha')) throw new Erreur(400, 'Activez d’abord les notifications sur cet appareil.');
  notifier({ qui: 'sha', id: 'sha' }, { title: reglages().nom, body: 'Les notifications fonctionnent : vous serez prévenue de chaque nouveau message.', url: '/salon', tag: 'essai' });
  return { ok: true };
});

// --- Espace salon
// L'accès est-il configuré ? (Sinon, l'espace propose de choisir identifiant et mot de passe.)
route('GET', '/api/sha/etat', () => ({ configure: accesConfigure() }));

route('POST', '/api/sha/configurer', (req, res, corps) => {
  limiter(req, 'sha-config', 6);
  if (accesConfigure()) throw new Erreur(409, 'L’accès est déjà configuré : connectez-vous.');
  // En ligne, sans secret SETUP_CODE dans Cloudflare, personne ne peut configurer l'accès.
  if (!codeConfiguration) throw new Erreur(503, 'Aucun code de configuration : ajoutez le secret SETUP_CODE dans Cloudflare.');
  const saisi = String(corps.code || '').replace(/\s/g, '').replace(/-/g, '');
  const attendu = codeConfiguration.replace(/\s/g, '').replace(/-/g, '');
  if (saisi.length !== attendu.length || !crypto.timingSafeEqual(Buffer.from(saisi), Buffer.from(attendu))) {
    throw new Erreur(403, 'Code de configuration incorrect.');
  }
  db.sha = { identifiant: identifiantValide(corps.identifiant), mdp: hacher(nouveauMotDePasse(corps.motDePasse)) };
  codeConfiguration = null;
  stockage.oublierCode();
  sauver();
  ouvrirSession(req, res, 'sha', 'sha');
  return { ok: true };
});

route('POST', '/api/sha/connexion', (req, res, corps) => {
  tropDEchecs(req, 'sha', 6);
  if (!accesConfigure()) throw new Erreur(409, 'Choisissez d’abord votre identifiant et votre mot de passe.');
  const bonId = String(corps.identifiant || '').trim().toLowerCase() === db.sha.identifiant;
  const bonMdp = verifierMdp(String(corps.motDePasse || ''), db.sha.mdp);
  if (!bonId || !bonMdp) {
    noterEchec(req, 'sha');
    throw new Erreur(401, 'Identifiant ou mot de passe incorrect.');
  }
  ouvrirSession(req, res, 'sha', 'sha');
  return { ok: true };
});

route('POST', '/api/sha/deconnexion', (req, res) => {
  fermerSession(req, res, 'sha');
  return { ok: true };
});

route('GET', '/api/sha/projets', (req) => {
  exigerSha(req);
  return db.projets
    .slice()
    .sort((a, b) => b.maj - a.maj)
    .map((p) => {
      const dernier = p.messages.filter((m) => m.de !== 'systeme').at(-1);
      return {
        id: p.id, titre: p.titre, etape: p.etape, maj: p.maj, creneau: p.creneau, parSalon: Boolean(p.parSalon),
        client: nomClient(p),
        apercu: dernier ? (dernier.de === 'sha' ? 'Vous : ' : '') + (dernier.texte || 'Photo envoyée') : '',
        nonLus: p.messages.slice(p.vuSha).filter((m) => m.de === 'client').length,
      };
    });
});

route('GET', '/api/sha/projets/([\\w-]+)', (req, res, corps, [pid]) => {
  exigerSha(req);
  const p = projet(pid);
  if (p.vuSha !== p.messages.length) {
    p.vuSha = p.messages.length;
    sauver();
  }
  return vueProjet(p, true);
});

function actionSha(fn) {
  return (req, res, corps, [pid]) => {
    exigerSha(req);
    const p = projet(pid);
    fn(p, corps);
    p.vuSha = p.messages.length;
    sauver();
    return vueProjet(p, true);
  };
}

route('POST', '/api/sha/projets/([\\w-]+)/messages', actionSha((p, corps) => {
  const msg = texte(corps.texte, 2000, 'Message', !corps.image);
  ajouterMessage(p, 'sha', msg, corps.image ? enregistrerImage(corps.image, CHAT) : null);
}));

/** Un créneau saisi par la tatoueuse : format, date à venir, et pas de chevauchement. */
function creneauValide(p, debutSaisi, dureeSaisie) {
  const debut = String(debutSaisi || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(debut) || !isValidDate(debut.slice(0, 10)) || toMinutes(debut.slice(11)) === null) {
    throw new Erreur(400, 'Date ou heure invalide.');
  }
  if (Date.parse(debut) < Date.now()) throw new Erreur(400, 'Ce créneau est déjà passé.');
  const duree = entier(dureeSaisie, 15, 720, 'Durée (minutes)');
  const conflit = chevauchement(p, debut, duree);
  if (conflit) throw new Erreur(409, messageConflit(conflit));
  return { debut, duree };
}

/** Pourquoi un créneau n'est pas libre, dit simplement. */
function messageConflit(x) {
  const quand = fmtCreneau(x.creneau.debut);
  if (x.etape === 'devis') return `Créneau déjà proposé à une autre personne (${quand}) : devis pas encore accepté.`;
  if (x.etape === 'creneau') return `Créneau déjà proposé à une autre personne (${quand}) : acompte toujours pas payé.`;
  if (x.etape === 'acompte_declare') return `Créneau déjà proposé à une autre personne (${quand}) : acompte en cours de vérification.`;
  return `Créneau déjà réservé (${quand}) : rendez-vous confirmé.`;
}

// Le devis, avec le créneau choisi en même temps (facultatif : il peut aussi être fixé plus tard).
route('POST', '/api/sha/projets/([\\w-]+)/devis', actionSha((p, corps) => {
  if (['confirme', 'annule'].includes(p.etape)) throw new Erreur(400, 'Ce rendez-vous est déjà confirmé ou clôturé.');
  const prix = entier(corps.prix, 1, 20000, 'Prix');
  const acompte = entier(corps.acompte, 1, prix, 'Acompte');
  const duree = entier(corps.duree, 15, 720, 'Durée (minutes)');
  const details = texte(corps.details, 1000, 'Détails', false);
  const creneau = corps.debut ? creneauValide(p, corps.debut, duree) : null;
  p.devis = { prix, acompte, duree, details, at: Date.now() };
  p.creneau = creneau;
  p.acompte = null;
  p.etape = 'devis';
  ajouterMessage(p, 'systeme', `Devis envoyé : ${prix} € (acompte ${acompte} €), séance d'environ ${dureeTexte(duree)}` +
    (creneau ? `, le ${fmtCreneau(creneau.debut)}.` : '.'));
}));

route('POST', '/api/sha/projets/([\\w-]+)/creneau', actionSha((p, corps) => {
  if (!p.devis || ['discussion', 'annule'].includes(p.etape)) throw new Erreur(400, 'Envoyez d’abord le devis.');
  const { debut, duree } = creneauValide(p, corps.debut, corps.duree ?? p.devis.duree);
  if (p.etape === 'devis') {
    // Devis pas encore accepté : le créneau change simplement dans le devis.
    p.creneau = { debut, duree };
    ajouterMessage(p, 'systeme', `Créneau du devis modifié : ${fmtCreneau(debut)}.`);
    return;
  }
  const deplacement = Boolean(p.creneau);
  p.creneau = { debut, duree };
  if (!['acompte_declare', 'confirme'].includes(p.etape)) p.etape = 'creneau';
  ajouterMessage(
    p,
    'systeme',
    (deplacement ? 'Rendez-vous déplacé au ' : 'Créneau proposé : ') + fmtCreneau(debut) +
      (p.etape === 'creneau' ? `. Réglez l’acompte de ${p.devis.acompte} € pour bloquer ce créneau.` : '.'),
  );
}));

route('POST', '/api/sha/projets/([\\w-]+)/acompte-recu', actionSha((p) => {
  if (!p.creneau || !['creneau', 'acompte_declare'].includes(p.etape)) throw new Erreur(400, 'Pas d’acompte en attente sur cette demande.');
  p.acompte = { ...(p.acompte || { mode: 'salon', declare: Date.now() }), recu: Date.now() };
  p.etape = 'confirme';
  ajouterMessage(p, 'systeme', `Acompte reçu, merci ! Rendez-vous confirmé le ${fmtCreneau(p.creneau.debut)}.`);
}));

route('POST', '/api/sha/projets/([\\w-]+)/annuler', actionSha((p) => {
  if (p.etape === 'annule') return;
  p.etape = 'annule';
  ajouterMessage(p, 'systeme', 'Demande clôturée par le salon.');
}));

route('GET', '/api/sha/galerie', (req) => {
  exigerSha(req);
  return db.galerie.slice().sort((a, b) => b.at - a.at);
});

route('POST', '/api/sha/galerie', (req, res, corps) => {
  exigerSha(req);
  const type = corps.type === 'flash' ? 'flash' : 'photo';
  const titre = texte(corps.titre, 80, 'Titre', false);
  const prix = type === 'flash' && corps.prix !== '' && corps.prix != null ? entier(corps.prix, 1, 20000, 'Prix') : null;
  // Dimensions annoncées par le navigateur : elles réservent la place de l'image dans la page.
  const dimension = (v) => (Number.isInteger(v) && v > 0 && v <= 12000 ? v : null);
  const nom = enregistrerImage(corps.image, GALERIE);
  const g = {
    id: id(), type, titre, prix, src: '/galerie/' + nom, dispo: true,
    largeur: dimension(corps.largeur), hauteur: dimension(corps.hauteur), at: Date.now(),
  };
  db.galerie.push(g);
  sauver();
  return g;
});

route('POST', '/api/sha/galerie/([\\w-]+)', (req, res, corps, [gid]) => {
  exigerSha(req);
  const g = db.galerie.find((x) => x.id === gid);
  if (!g) throw new Erreur(404, 'Image introuvable.');
  if ('titre' in corps) g.titre = texte(corps.titre, 80, 'Titre', false);
  if ('prix' in corps) g.prix = corps.prix === '' || corps.prix == null ? null : entier(corps.prix, 1, 20000, 'Prix');
  if ('dispo' in corps) g.dispo = Boolean(corps.dispo);
  sauver();
  return g;
});

route('DELETE', '/api/sha/galerie/([\\w-]+)', (req, res, corps, [gid]) => {
  exigerSha(req);
  const i = db.galerie.findIndex((x) => x.id === gid);
  if (i < 0) throw new Erreur(404, 'Image introuvable.');
  const [g] = db.galerie.splice(i, 1);
  effacerDeLaGalerie(g.src);
  sauver();
  return { ok: true };
});

route('GET', '/api/sha/reglages', (req) => {
  exigerSha(req);
  return { ...reglages(), identifiant: db.sha.identifiant, videos: texteVideos() };
});

// La photo de profil : le médaillon affiché à côté du nom du salon.
function changerProfil(src) {
  const ancien = reglages().profil;
  effacerDeLaGalerie(ancien);
  garderLesChangements({ ...reglages(), profil: src });
  sauver();
  return reglages();
}
route('POST', '/api/sha/profil', (req, res, corps) => {
  exigerSha(req);
  return changerProfil('/galerie/' + enregistrerImage(corps.image, GALERIE));
});
route('DELETE', '/api/sha/profil', (req) => {
  exigerSha(req);
  return changerProfil('');
});

route('POST', '/api/sha/reglages', async (req, res, corps) => {
  exigerSha(req);
  // Les vidéos d'abord : un lien non reconnu arrête tout, rien n'est enregistré à moitié.
  const videos = 'videos' in corps ? await lireVideos(texte(corps.videos, 2000, 'Vidéos', false)) : null;
  const limites = {
    nom: 60, titreUne: 80, presentation: 1500, adresse: 120, codePostal: 10, ville: 80, telephone: 30, email: 120,
    instagram: 120, facebook: 160, tiktok: 120, specialites: 800, paypal: 120, wero: 40, conditionsAcompte: 600,
  };
  const prochains = { ...reglages() };
  for (const [k, max] of Object.entries(limites)) {
    if (k in corps) prochains[k] = texte(corps[k], max, k, OBLIGATOIRES.includes(k));
  }
  // Horaires : vérifiés jour par jour, puis réécrits toujours de la même façon.
  for (const j of [0, 1, 2, 3, 4, 5, 6]) {
    if ('h' + j in corps) prochains['h' + j] = ecrirePlages(lirePlages(texte(corps['h' + j], 80, 'Horaires', false), j));
  }
  // Changer l'identifiant ou le mot de passe demande le mot de passe actuel.
  const nouvelId = corps.identifiant ? identifiantValide(corps.identifiant) : db.sha.identifiant;
  if (nouvelId !== db.sha.identifiant || corps.nouveauMotDePasse) {
    if (!verifierMdp(String(corps.motDePasseActuel || ''), db.sha.mdp)) throw new Erreur(403, 'Mot de passe actuel incorrect : identifiant et mot de passe inchangés.');
    if (corps.nouveauMotDePasse) db.sha.mdp = hacher(nouveauMotDePasse(corps.nouveauMotDePasse));
    db.sha.identifiant = nouvelId;
  }
  garderLesChangements(prochains);
  if (videos) remplacerVideos(videos);
  sauver();
  return { ...reglages(), identifiant: db.sha.identifiant, videos: texteVideos() };
});

/* --- Les vidéos TikTok : la tatoueuse colle les liens, le site garde l'identifiant de chaque
   vidéo et, si TikTok la donne, sa vignette (enregistrée ici : celles de TikTok expirent). */

const MAX_VIDEOS = 8;
const TIKTOK_VIDEO = /tiktok\.com\/(?:(@[\w.-]+)\/(?:video|photo)|v|embed(?:\/v2)?|player\/v1)\/(\d{8,25})/i;

async function lireVideos(saisie) {
  const liens = saisie.split(/\s+/).map((l) => l.trim()).filter(Boolean);
  if (liens.length > MAX_VIDEOS) throw new Erreur(400, `${MAX_VIDEOS} vidéos au plus.`);
  const out = [];
  for (const lien of liens) {
    let url = /^https?:\/\//i.test(lien) ? lien : 'https://' + lien;
    let m = TIKTOK_VIDEO.exec(url);
    // Lien court (« vm.tiktok.com/… », bouton Partager de l'application) : on suit la redirection.
    if (!m && /^https:\/\/(vm|vt|www)\.tiktok\.com\/(t\/)?[\w-]+\/?$/i.test(url)) {
      try {
        const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0' } });
        m = TIKTOK_VIDEO.exec(r.headers.get('location') || '');
      } catch { /* réseau indisponible : signalé ci-dessous */ }
    }
    if (!m) throw new Erreur(400, `Lien TikTok non reconnu : « ${lien.slice(0, 60)} ». Sur TikTok, ouvrez la vidéo, touchez « Partager » puis « Copier le lien ».`);
    if (!out.some((v) => v.id === m[2])) out.push({ id: m[2], auteur: (m[1] || '').slice(1) });
  }
  return out;
}

function remplacerVideos(liste) {
  const anciennes = new Map(videosActuelles().map((v) => [v.id, v]));
  db.videos = liste.map((v) => ({ ...anciennes.get(v.id), ...v, auteur: v.auteur || (anciennes.get(v.id) || {}).auteur || '' }));
  for (const v of anciennes.values()) {
    if (db.videos.some((x) => x.id === v.id)) continue;
    for (const f of [v.vignette, v.fichier]) {
      effacerDeLaGalerie(f);
    }
  }
  // La vignette et le fichier vidéo sont cherchés après coup : la page de réglages n'attend pas TikTok.
  if (!(typeof process !== 'undefined' && process.env.SHA_SANS_RESEAU)) for (const v of db.videos.filter((x) => !x.fichier || !x.vignette)) enArrierePlan(chercherVideo(v));
}

/**
 * Récupère, depuis la page publique de la vidéo, sa vignette et son fichier vidéo, enregistrés
 * ici : la vidéo est ensuite lue sur le site même, sans lecteur TikTok (donc sans ses cookies).
 * Si TikTok refuse, la vidéo reste lisible par le lecteur TikTok (chargé au clic).
 */
async function chercherVideo(v) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
  try {
    const r = await fetch(`https://www.tiktok.com/@${v.auteur || 'tiktok'}/video/${v.id}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
    const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const m = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(await r.text());
    const item = m && JSON.parse(m[1]).__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
    if (!item || !db.videos.includes(v)) return;
    if (item.author && item.author.uniqueId && !v.auteur) v.auteur = String(item.author.uniqueId).slice(0, 40);
    const charger = async (url, max) => {
      const rep = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.tiktok.com/', cookie }, signal: AbortSignal.timeout(30000) });
      const buf = Buffer.from(await rep.arrayBuffer());
      return rep.ok && buf.length < max ? { type: (rep.headers.get('content-type') || '').split(';')[0], buf } : null;
    };
    const couverture = item.video.originCover || item.video.cover;
    if (!v.vignette && couverture) {
      const img = await charger(couverture, 3 * 1024 * 1024);
      if (img && /^image\/(jpeg|png|webp)$/.test(img.type)) v.vignette = '/galerie/' + enregistrerImage(`data:${img.type};base64,${img.buf.toString('base64')}`, GALERIE);
    }
    if (!v.fichier && item.video.playAddr) {
      const vid = await charger(item.video.playAddr, 60 * 1024 * 1024);
      // Un vrai MP4 commence par une boîte « ftyp ».
      if (vid && vid.buf.subarray(4, 8).toString() === 'ftyp') {
        const nom = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.mp4`;
        stockage.ecrire(GALERIE, nom, vid.buf);
        v.fichier = '/galerie/' + nom;
      }
    }
  } catch { /* sans fichier, la vidéo passe par le lecteur TikTok ; sans vignette, fond violet et bouton lecture */ }
  sauver();
}

const texteVideos = () => videosActuelles().map((v) => `https://www.tiktok.com/@${v.auteur || 'tiktok'}/video/${v.id}`).join('\n');

/* --- Le calendrier : fermetures, ouvertures et horaires exceptionnels, jours fériés */

function vueCalendrier() {
  const auj = nowInZone(CONFIG.timezone || 'Europe/Paris').date;
  const semaine = horairesSemaine(reglages());
  return {
    exceptions: db.exceptions.filter((e) => e.au >= auj).sort((a, b) => a.du.localeCompare(b.du))
      .map((e) => ({ ...e, horaires: plagesTexte(e.plages) })),
    feries: {
      auto: db.feries.auto,
      // Les jours fériés de l'année à venir qui tombent un jour normalement travaillé.
      prochains: holidaysBetween(auj, addDays(auj, 366)).filter((f) => semaine[weekday(f.date)].length)
        .map((f) => ({ date: f.date, nom: f.name, jour: jourLong(f.date), ouvert: !db.feries.auto || db.feries.ouverts.includes(f.date) })),
    },
  };
}

route('GET', '/api/sha/calendrier', (req) => {
  exigerSha(req);
  return vueCalendrier();
});

route('POST', '/api/sha/exceptions', (req, res, corps) => {
  exigerSha(req);
  const type = String(corps.type || '');
  if (!TYPES_EXCEPTION[type]) throw new Erreur(400, 'Choisissez une fermeture, une ouverture ou des horaires modifiés.');
  const du = String(corps.du || '');
  const au = String(corps.au || du);
  if (!isValidDate(du) || !isValidDate(au)) throw new Erreur(400, 'Date invalide.');
  if (au < du) throw new Erreur(400, 'La date de fin est avant la date de début.');
  if (au > addDays(du, 366)) throw new Erreur(400, 'Une période d’un an au plus.');
  const plages = type === 'fermeture' ? [] : lirePlages(texte(corps.horaires, 80, 'Horaires'), weekday(du));
  db.exceptions.push({ id: id(), type, du, au, plages, motif: texte(corps.motif, 80, 'Motif', false), at: Date.now() });
  sauver();
  return vueCalendrier();
});

route('DELETE', '/api/sha/exceptions/([\\w-]+)', (req, res, corps, [eid]) => {
  exigerSha(req);
  const avant = db.exceptions.length;
  db.exceptions = db.exceptions.filter((e) => e.id !== eid);
  if (db.exceptions.length === avant) throw new Erreur(404, 'Exception introuvable.');
  sauver();
  return vueCalendrier();
});

// Jours fériés : fermés d'office ; la tatoueuse en ouvre un, ou arrête la fermeture automatique.
route('POST', '/api/sha/feries', (req, res, corps) => {
  exigerSha(req);
  if ('auto' in corps) db.feries.auto = Boolean(corps.auto);
  if (corps.date) {
    if (!isValidDate(String(corps.date))) throw new Erreur(400, 'Date invalide.');
    const ouverts = new Set(db.feries.ouverts);
    if (corps.ouvert) ouverts.add(corps.date);
    else ouverts.delete(corps.date);
    db.feries.ouverts = [...ouverts].sort();
  }
  sauver();
  return vueCalendrier();
});

/* --- Les rendez-vous fixés par la tatoueuse : retouche, suite d'une séance, petit créneau… */

route('GET', '/api/sha/clients', (req) => {
  exigerSha(req);
  return db.clients
    .map((c) => ({ id: c.id, prenom: c.prenom, nom: c.nom, telephone: c.telephone || (c.typeContact === 'tel' ? c.contact : '') }))
    .sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, 'fr'));
});

route('POST', '/api/sha/rendez-vous', (req, res, corps) => {
  exigerSha(req);
  const depuis = corps.depuis ? projet(String(corps.depuis)) : null;
  let client = null;
  let externe = null;
  if (corps.client) {
    if (!db.clients.some((c) => c.id === corps.client)) throw new Erreur(404, 'Client introuvable.');
    client = corps.client;
  } else if (depuis) {
    client = depuis.client;
    externe = depuis.externe || null;
  } else {
    const tel = corps.telephone ? contactValide(corps.telephone) : null;
    if (tel && tel.type !== 'tel') throw new Erreur(400, 'Entrez un numéro de téléphone valide.');
    externe = { nom: texte(corps.nom, 80, 'Nom du client'), telephone: tel ? tel.valeur : '' };
  }
  const titre = texte(corps.titre, 80, 'Objet du rendez-vous');
  const debut = String(corps.debut || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(debut) || !isValidDate(debut.slice(0, 10))) throw new Erreur(400, 'Date ou heure invalide.');
  const duree = entier(corps.duree, 15, 720, 'Durée (minutes)');
  const prix = corps.prix === '' || corps.prix == null ? 0 : entier(corps.prix, 0, 20000, 'Prix');
  const acompte = corps.acompte === '' || corps.acompte == null ? 0 : entier(corps.acompte, 0, Math.max(prix, 20000), 'Acompte');
  if (prix && acompte > prix) throw new Erreur(400, 'L’acompte dépasse le prix.');
  const p = {
    id: id(), client, externe, cree: Date.now(), maj: Date.now(), titre, flash: depuis ? depuis.flash : null,
    messages: [], devis: { prix, acompte, duree, details: '', at: Date.now() }, creneau: null, acompte: null,
    etape: acompte ? 'creneau' : 'confirme', vuClient: 0, vuSha: 0, parSalon: true, depuis: depuis ? depuis.id : null,
  };
  const conflit = chevauchement(p, debut, duree);
  if (conflit) throw new Erreur(409, messageConflit(conflit));
  p.creneau = { debut, duree };
  ajouterMessage(p, 'systeme', `Rendez-vous fixé par le salon : ${fmtCreneau(debut)}, ${dureeTexte(duree)}.` +
    (acompte ? ` Réglez l’acompte de ${acompte} € pour le confirmer.` : ''));
  p.vuSha = p.messages.length;
  db.projets.push(p);
  sauver();
  return vueProjet(p, true);
});

/* ------------------------------------------------------------------ */
/* Serveur HTTP                                                       */
/* ------------------------------------------------------------------ */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json',
};

// Les mêmes en-têtes de sécurité que le site de Cyrille (le plan Google Maps est la seule page extérieure).
const ENTETES = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    // Google Maps (plan de la page Pratique) et le lecteur TikTok (vidéos, chargées au clic).
    'frame-src https://www.google.com https://www.tiktok.com',
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** La plage demandée (« Range ») d'un fichier de cette taille : null = tout le fichier, false = impossible. */
function plageDemandee(req, taille) {
  const plage = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!plage || (!plage[1] && !plage[2])) return null;
  const debut = plage[1] ? Number(plage[1]) : Math.max(0, taille - Number(plage[2]));
  const fin = plage[1] && plage[2] ? Math.min(Number(plage[2]), taille - 1) : taille - 1;
  return debut > fin || debut >= taille ? false : { debut, fin };
}

/**
 * Envoie un fichier : en entier, ou par morceaux (Safari et l'iPhone ne lisent une vidéo qu'ainsi).
 * lire(debut, fin) → ce qu'il faut envoyer (un Buffer, ou un flux sur l'ordinateur).
 */
function envoyerContenu(req, res, { taille, type, cache, etag, lire }) {
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cache });
    return res.end();
  }
  const entetes = { ...ENTETES, ETag: etag, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  const plage = plageDemandee(req, taille);
  if (plage === false) {
    res.writeHead(416, { 'Content-Range': `bytes */${taille}` });
    return res.end();
  }
  const { debut, fin } = plage || { debut: 0, fin: taille - 1 };
  res.writeHead(plage ? 206 : 200, { ...entetes, 'Content-Length': taille ? fin - debut + 1 : 0, ...(plage && { 'Content-Range': `bytes ${debut}-${fin}/${taille}` }) });
  if (req.method === 'HEAD' || !taille) return res.end();
  const contenu = lire(debut, fin);
  if (Buffer.isBuffer(contenu)) return res.end(contenu);
  contenu.pipe(res);
}

/** Un fichier de public/ (sur l'ordinateur seulement : en ligne, Cloudflare les sert lui-même). */
function envoyerFichier(req, res, fichier, cache) {
  fs.stat(fichier, (err, st) => {
    if (err || !st.isFile()) return envoyerJson(res, 404, { erreur: 'Introuvable.' });
    envoyerContenu(req, res, {
      taille: st.size,
      type: TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream',
      cache,
      etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
      lire: (debut, fin) => fs.createReadStream(fichier, { start: debut, end: fin }),
    });
  });
}

/** Un fichier déposé (galerie, images des messages), lu dans le stockage. */
function envoyerDepose(req, res, type, nom, cache) {
  const octets = stockage.lire(type, nom);
  if (!octets) return envoyerJson(res, 404, { erreur: 'Introuvable.' });
  envoyerContenu(req, res, {
    taille: octets.length,
    type: TYPES[path.extname(nom).toLowerCase()] || 'application/octet-stream',
    cache,
    // Le nom d'un fichier déposé ne sert qu'une fois : il suffit à l'identifier.
    etag: `"${nom}"`,
    lire: (debut, fin) => octets.subarray(debut, fin + 1),
  });
}

function envoyerJson(res, status, donnees) {
  res.writeHead(status, { ...ENTETES, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(donnees));
}

function envoyerTexte(req, res, status, type, corps) {
  const buf = Buffer.from(String(corps), 'utf8');
  res.writeHead(status, { ...ENTETES, 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'private, no-cache' });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

/** Le corps JSON d'une requête (lu morceau par morceau : sur l'ordinateur comme sur Cloudflare). */
async function lireCorps(req, limite) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  let taille = 0;
  const morceaux = [];
  for await (const c of req) {
    taille += c.length;
    if (taille > limite) throw new Erreur(413, 'Envoi trop volumineux.');
    morceaux.push(Buffer.from(c));
  }
  if (!morceaux.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(morceaux).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new Erreur(400, 'Requête invalide.');
  }
}

function memeOrigine(req) {
  const o = req.headers.origin;
  if (o) {
    try {
      return new URL(o).host === req.headers.host;
    } catch {
      return false;
    }
  }
  return req.headers['sec-fetch-site'] === 'same-origin';
}

async function gerer(req, res) {
  const url = new URL(req.url, 'http://local');
  let chemin;
  try {
    chemin = decodeURIComponent(url.pathname);
  } catch {
    chemin = '\0';
  }
  if (chemin.includes('\0')) return envoyerJson(res, 400, { erreur: 'Adresse invalide.' });

  if (chemin.startsWith('/api/')) {
    try {
      if (req.method !== 'GET' && !memeOrigine(req)) throw new Erreur(403, 'Requête refusée.');
      const r = routes.find((x) => x.methode === req.method && x.motif.test(chemin));
      if (!r) throw new Erreur(404, 'Adresse inconnue.');
      // Une demande peut porter plusieurs photos (emplacement, référence).
      const limite = /^\/api\/projets$/.test(chemin) ? 14 * 1024 * 1024 : /galerie|messages/.test(chemin) ? 6 * 1024 * 1024 : 32 * 1024;
      const corps = await lireCorps(req, limite);
      if (/^[\w.:-]+$/.test(req.headers.host || '')) origineConnue = `${securise(req) ? 'https' : 'http'}://${req.headers.host}`;
      // Qui agit : ce qui est nouveau sera annoncé à l'autre personne (notifications).
      acteur = chemin.startsWith('/api/sha/') ? 'sha' : 'client';
      nouveautes.clear();
      let resultat;
      try {
        resultat = await r.fn(req, res, corps, r.motif.exec(chemin).slice(1));
        envoyerNouveautes();
      } finally {
        acteur = null;
        nouveautes.clear();
      }
      if (resultat && resultat.prive) return envoyerDepose(req, res, resultat.type, resultat.nom, 'private, max-age=86400');
      return envoyerJson(res, 200, resultat ?? { ok: true });
    } catch (e) {
      if (!(e instanceof Erreur)) console.error(e);
      return envoyerJson(res, e.status || 500, { erreur: e instanceof Erreur ? e.message : 'Erreur du serveur.' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return envoyerJson(res, 405, { erreur: 'Méthode non autorisée.' });

  // Les pages du journal
  const page = chemin.length > 1 ? chemin.replace(/\/+$/, '') : chemin;
  const ANCIENNES = { '/sha': '/salon' };
  if (ANCIENNES[page]) {
    res.writeHead(302, { Location: ANCIENNES[page] });
    return res.end();
  }
  if (pages[page]) return envoyerTexte(req, res, 200, TYPES['.html'], pages[page](contexte(req, page)));
  if (page === '/robots.txt') return envoyerTexte(req, res, 200, TYPES['.txt'], 'User-agent: *\nDisallow: /salon\nDisallow: /api/\n');

  // Les images publiées par le salon, puis les fichiers du site
  const m = /^\/galerie\/([\w-]+\.(?:jpg|png|webp|mp4))$/.exec(chemin);
  if (m) return envoyerDepose(req, res, GALERIE, m[1], 'public, max-age=31536000, immutable');

  // Les fichiers de public/ (en ligne, Cloudflare les a déjà servis avant d'arriver ici).
  if (!SUR_CLOUDFLARE) {
    const fichier = path.join(PUBLIC, chemin);
    const existe = fichier.startsWith(PUBLIC + path.sep) && fs.existsSync(fichier) && fs.statSync(fichier).isFile();
    // HTML, CSS, JS et le « service worker » : toujours revalidés, pour qu'une mise à jour se voie immédiatement.
    if (existe) return envoyerFichier(req, res, fichier, /\.(css|js|webmanifest)$/.test(fichier) ? 'no-cache' : 'public, max-age=86400');
  }

  // Adresse inconnue : la page « Erratum ».
  return envoyerTexte(req, res, 404, TYPES['.html'], notFound(contexte(req, chemin)));
}

// Sur l'ordinateur (npm start, les tests, la démo), le site démarre tout de suite sur le dossier
// data/. Sur Cloudflare, c'est le salon (cloudflare/worker.js) qui l'initialise sur sa base.
if (!SUR_CLOUDFLARE) initialiser(stockageFichiers(DATA));

if (typeof require !== 'undefined' && require.main === module) {
  const http = require('node:http');
  const serveur = http.createServer((req, res) => {
    gerer(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) envoyerJson(res, 500, { erreur: 'Erreur du serveur.' });
    });
  });
  serveur.listen(PORT, () => {
    const adresse = `http://localhost:${PORT}`;
    console.log(`  Sha Tattoo est en ligne sur ${adresse}  (espace salon : ${adresse}/salon)`);
    if (process.argv.includes('--open')) require('node:child_process').exec(`start "" "${adresse}"`);
  });
  const arreter = () => {
    sauverMaintenant();
    process.exit(0);
  };
  process.on('SIGINT', arreter);
  process.on('SIGTERM', arreter);
}

module.exports = {
  gerer, initialiser, sauverMaintenant, sauverSiBesoin, travauxEnCours, ENTETES, TYPES,
  ageAu, contactValide, naissanceValide, lienPaypal,
};
