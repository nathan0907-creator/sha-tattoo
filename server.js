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

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { nowInZone, addDays, weekday, toMinutes, fromMinutes, isValidDate, WEEKDAYS } = require('./src/time');
const { holidaysBetween } = require('./src/holidays');
const { pages, notFound } = require('./src/views/pages');
const CONFIG = require('./salon.config.js');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.SHA_DATA || path.join(ROOT, 'data');
const GALERIE = path.join(DATA, 'galerie');
const CHAT = path.join(DATA, 'chat');
const BASE = path.join(DATA, 'base.json');
const PORT = Number(process.env.PORT) || 3100;
const AGE_MINIMUM = 18;
const JOUR = 86400000;

for (const d of [DATA, GALERIE, CHAT]) fs.mkdirSync(d, { recursive: true });

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
  specialites: CONFIG.specialties.join('\n'),
  // Horaires, un réglage par jour (h0 = dimanche … h6 = samedi) : « 09:00-12:30 / 13:30-17:00 », vide = fermé.
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((j) => ['h' + j, (CONFIG.hours[j] || []).map(([a, b]) => `${a}-${b}`).join(' / ')])),
  profil: CONFIG.avatar || '',
  paypal: '',
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
  return { clients: [], sessions: {}, projets: [], galerie: [], sha: null, reglages: {}, exceptions: [], feries: { auto: true, ouverts: [] } };
}

let db;
try {
  db = { ...baseVide(), ...JSON.parse(fs.readFileSync(BASE, 'utf8')) };
} catch {
  db = baseVide();
}
if (!db.reglages || typeof db.reglages !== 'object') db.reglages = {};
if (!Array.isArray(db.exceptions)) db.exceptions = [];
db.feries = { auto: true, ouverts: [], ...db.feries };

let minuterie = null;
function sauver() {
  clearTimeout(minuterie);
  minuterie = setTimeout(sauverMaintenant, 40);
}
function sauverMaintenant() {
  clearTimeout(minuterie);
  const tmp = BASE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, BASE);
}

// Aucun flash n'est fourni avec le site : la galerie ne contient que ce que le salon publie.
// (Nettoyage des anciens flashs d'exemple, si une base créée avant en contient encore.)
if (db.semee !== undefined || db.galerie.some((g) => g.exemple)) {
  db.galerie = db.galerie.filter((g) => !g.exemple);
  delete db.semee;
  sauverMaintenant();
}

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
// Tant qu'ils ne sont pas choisis, un code de configuration (à usage unique) est créé au
// lancement : il faut le saisir sur /salon pour choisir l'identifiant et le mot de passe.
// (Une ancienne base qui n'avait qu'un mot de passe tiré au sort repasse par cette étape.)
const FICHIER_CODE = path.join(DATA, 'CODE-DE-CONFIGURATION.txt');
let codeConfiguration = null;
const accesConfigure = () => Boolean(db.sha && db.sha.identifiant && db.sha.mdp);
if (!accesConfigure()) {
  db.sha = null;
  // Les anciennes connexions à l'espace salon ne valent plus.
  for (const [k, s] of Object.entries(db.sessions || {})) if (s.qui === 'sha') delete db.sessions[k];
  sauverMaintenant();
  codeConfiguration = crypto.randomInt(0, 1e8).toString().padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1-$2');
  fs.writeFileSync(
    FICHIER_CODE,
    `Code de configuration de l'espace salon (adresse du site + /salon) :\n\n  ${codeConfiguration}\n\nIl sert une seule fois, pour choisir l'identifiant et le mot de passe.\nUn nouveau code est créé à chaque lancement tant que l'accès n'est pas configuré.\n`,
  );
  fs.rmSync(path.join(DATA, 'MOT-DE-PASSE-SHA.txt'), { force: true });
  console.log(`\n  Espace salon à configurer : code ${codeConfiguration}\n  (aussi noté dans data/CODE-DE-CONFIGURATION.txt)\n`);
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
  fs.writeFileSync(path.join(dossier, nom), buf);
  return nom;
}

/* ------------------------------------------------------------------ */
/* Sessions, cookies, limites                                         */
/* ------------------------------------------------------------------ */

const COOKIE = { client: 'sha_client', sha: 'sha_atelier' };
const DUREE = { client: 30 * JOUR, sha: 12 * 3600000 };

for (const [k, s] of Object.entries(db.sessions)) if (s.exp < Date.now()) delete db.sessions[k];

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
    flashs: images.filter((g) => g.type === 'flash').map(decrireImage),
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
      },
      address: { street: r.adresse, postalCode: r.codePostal, city: r.ville, full },
      maps: {
        embed: `https://www.google.com/maps?q=${q}&output=embed`,
        directions: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
        view: `https://www.google.com/maps/search/?api=1&query=${q}`,
      },
      booking: { ...CONFIG.booking },
      hours,
      specialties: r.specialites.split(/\n+/).map((s) => s.trim()).filter(Boolean),
      avatar: r.profil,
      depositTerms: r.conditionsAcompte,
      about: { paragraphs: r.presentation.split(/\n+/).map((s) => s.trim()).filter(Boolean) },
      photos: { hero: CONFIG.photoUne || photos[0] || null, gallery: photos },
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
  p.messages.push({ id: id(), de, texte: texteMsg, image, at: Date.now() });
  p.maj = Date.now();
}

function infoFlash(fid) {
  const f = fid && db.galerie.find((g) => g.id === fid && g.type === 'flash');
  return f ? { id: f.id, titre: f.titre, src: f.src, prix: f.prix } : null;
}

function lienPaypal(montant) {
  const u = reglages().paypal.trim().replace(/^https?:\/\//, '').replace(/^(www\.)?paypal\.me\//i, '').split(/[/?#]/)[0];
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
  return { fichier: path.join(CHAT, fichier), prive: true };
});

// --- Espace salon
// L'accès est-il configuré ? (Sinon, l'espace propose de choisir identifiant et mot de passe.)
route('GET', '/api/sha/etat', () => ({ configure: accesConfigure() }));

route('POST', '/api/sha/configurer', (req, res, corps) => {
  limiter(req, 'sha-config', 6);
  if (accesConfigure()) throw new Erreur(409, 'L’accès est déjà configuré : connectez-vous.');
  const saisi = String(corps.code || '').replace(/\D/g, '');
  const attendu = codeConfiguration.replace(/\D/g, '');
  if (saisi.length !== attendu.length || !crypto.timingSafeEqual(Buffer.from(saisi), Buffer.from(attendu))) {
    throw new Erreur(403, 'Code de configuration incorrect.');
  }
  db.sha = { identifiant: identifiantValide(corps.identifiant), mdp: hacher(nouveauMotDePasse(corps.motDePasse)) };
  codeConfiguration = null;
  fs.rmSync(FICHIER_CODE, { force: true });
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
  if (g.src.startsWith('/galerie/')) fs.rmSync(path.join(GALERIE, path.basename(g.src)), { force: true });
  sauver();
  return { ok: true };
});

route('GET', '/api/sha/reglages', (req) => {
  exigerSha(req);
  return { ...reglages(), identifiant: db.sha.identifiant };
});

// La photo de profil : le médaillon affiché à côté du nom du salon.
function changerProfil(src) {
  const ancien = reglages().profil;
  if (ancien.startsWith('/galerie/')) fs.rmSync(path.join(GALERIE, path.basename(ancien)), { force: true });
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

route('POST', '/api/sha/reglages', (req, res, corps) => {
  exigerSha(req);
  const limites = {
    nom: 60, titreUne: 80, presentation: 1500, adresse: 120, codePostal: 10, ville: 80, telephone: 30, email: 120,
    instagram: 120, facebook: 160, specialites: 800, paypal: 120, wero: 40, conditionsAcompte: 600,
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
  sauver();
  return { ...reglages(), identifiant: db.sha.identifiant };
});

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
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

// Les mêmes en-têtes de sécurité que le site de Cyrille (le plan Google Maps est la seule page extérieure).
const ENTETES = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    'frame-src https://www.google.com',
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

function envoyerFichier(req, res, fichier, cache) {
  fs.stat(fichier, (err, st) => {
    if (err || !st.isFile()) return envoyerJson(res, 404, { erreur: 'Introuvable.' });
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cache });
      return res.end();
    }
    res.writeHead(200, {
      ...ENTETES,
      ETag: etag,
      'Content-Type': TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(fichier).pipe(res);
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

function lireCorps(req, limite) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve({});
    let taille = 0;
    const morceaux = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > limite) {
        reject(new Erreur(413, 'Envoi trop volumineux.'));
        req.destroy();
      } else morceaux.push(c);
    });
    req.on('end', () => {
      if (!morceaux.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(morceaux).toString('utf8'));
        resolve(v && typeof v === 'object' ? v : {});
      } catch {
        reject(new Erreur(400, 'Requête invalide.'));
      }
    });
    req.on('error', reject);
  });
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
      const resultat = await r.fn(req, res, corps, r.motif.exec(chemin).slice(1));
      if (resultat && resultat.prive) return envoyerFichier(req, res, resultat.fichier, 'private, max-age=86400');
      return envoyerJson(res, 200, resultat ?? { ok: true });
    } catch (e) {
      if (!(e instanceof Erreur)) console.error(e);
      return envoyerJson(res, e.status || 500, { erreur: e instanceof Erreur ? e.message : 'Erreur du serveur.' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return envoyerJson(res, 405, { erreur: 'Méthode non autorisée.' });

  // Les pages du journal
  const page = chemin.length > 1 ? chemin.replace(/\/+$/, '') : chemin;
  const ANCIENNES = { '/sha': '/salon', '/flashs': '/prestations#flashs' };
  if (ANCIENNES[page]) {
    res.writeHead(302, { Location: ANCIENNES[page] });
    return res.end();
  }
  if (pages[page]) return envoyerTexte(req, res, 200, TYPES['.html'], pages[page](contexte(req, page)));
  if (page === '/robots.txt') return envoyerTexte(req, res, 200, TYPES['.txt'], 'User-agent: *\nDisallow: /salon\nDisallow: /api/\n');

  // Les images publiées par le salon, puis les fichiers du site
  const m = /^\/galerie\/([\w-]+\.(?:jpg|png|webp))$/.exec(chemin);
  if (m) return envoyerFichier(req, res, path.join(GALERIE, m[1]), 'public, max-age=31536000, immutable');

  const fichier = path.join(PUBLIC, chemin);
  const existe = fichier.startsWith(PUBLIC + path.sep) && fs.existsSync(fichier) && fs.statSync(fichier).isFile();
  // HTML, CSS et JS : toujours revalidés, pour qu'une mise à jour du site se voie immédiatement.
  if (existe) return envoyerFichier(req, res, fichier, /\.(css|js)$/.test(fichier) ? 'no-cache' : 'public, max-age=86400');

  // Adresse inconnue : la page « Erratum ».
  return envoyerTexte(req, res, 404, TYPES['.html'], notFound(contexte(req, chemin)));
}

if (require.main === module) {
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

module.exports = { gerer, ageAu, contactValide, naissanceValide, lienPaypal, sauverMaintenant };
