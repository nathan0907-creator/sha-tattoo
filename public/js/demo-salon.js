'use strict';
/*
 * La démonstration de l'espace salon (GitHub Pages, sans serveur).
 * Un faux serveur, dans le navigateur : il remplace Sha.api et répond comme le vrai, avec des
 * demandes d'exemple. Tout se manipule (devis, créneau, acompte, photos, fermetures, réglages),
 * mais rien n'est enregistré : recharger la page remet la démo à zéro.
 * Ce fichier n'est chargé que dans la démo (scripts/export-demo.js l'ajoute à la page).
 */

(() => {
  if (!document.documentElement.dataset.demo || typeof Sha === 'undefined') return;

  const BASE = (document.querySelector('link[href$="/css/base.css"]')?.getAttribute('href') || '/css/base.css').replace(/\/css\/base\.css$/, '');
  const MIN = 60000;
  const H = 60 * MIN;
  const maintenant = Date.now();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dansJours = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  let n = 0;
  const id = () => 'demo' + (++n).toString(36) + Math.random().toString(36).slice(2, 6);
  const msg = (de, texte, ilYa) => ({ id: id(), de, texte, image: null, at: maintenant - ilYa });
  const fmt = (debut) => { const t = Sha.creneau(debut); return t.charAt(0).toLowerCase() + t.slice(1); };

  /* ---------- Les données d'exemple ---------- */
  const clients = [
    { id: 'c1', prenom: 'Léa', nom: 'Martin', telephone: '06 00 00 00 01', email: 'lea@exemple.fr', naissance: '1996-04-12', compte: true },
    { id: 'c2', prenom: 'Inès', nom: 'Durand', telephone: '06 00 00 00 02', email: '', naissance: '1990-09-03', compte: true },
    { id: 'c3', prenom: 'Camille', nom: 'Petit', telephone: '06 00 00 00 03', email: '', naissance: '2001-01-20', compte: true },
  ];
  const age = (naissance) => { const [a, m, j] = naissance.split('-').map(Number); const d = new Date(); let x = d.getFullYear() - a; if (d.getMonth() + 1 < m || (d.getMonth() + 1 === m && d.getDate() < j)) x--; return x; };
  const fiche = (c) => ({ ...c, age: age(c.naissance) });

  const projets = [
    {
      id: 'p1', client: 'c1', titre: 'Projet · Avant-bras', etape: 'discussion', maj: maintenant - 20 * MIN, vuSha: 0,
      infos: { emplacement: 'Avant-bras', taille: 'Environ 12 cm', reference: null }, flash: { src: BASE + '/img/exemples/realisation-2.svg', titre: 'Référence' },
      messages: [msg('client', 'Endroit : Avant-bras\nTaille : Environ 12 cm\nUne pivoine en traits fins, plutôt en noir.', 20 * MIN), msg('systeme', 'Demande envoyée. La réponse et votre devis arriveront ici.', 20 * MIN)],
      devis: null, creneau: null, acompte: null,
    },
    {
      id: 'p2', client: 'c2', titre: 'Projet · Clavicule', etape: 'creneau', maj: maintenant - 26 * H, vuSha: 5,
      infos: { emplacement: 'Clavicule', taille: '15 cm', reference: null }, flash: null,
      messages: [
        msg('client', 'Endroit : Clavicule\nTaille : 15 cm\nUne branche de feuillage fine.', 50 * H),
        msg('sha', 'Bonjour Inès ! Très bonne idée, je vous prépare le devis.', 49 * H),
        msg('systeme', 'Devis envoyé : 140 € (acompte 40 €), séance d’environ 2 h.', 48 * H),
        msg('systeme', 'Devis accepté. Réglez l’acompte de 40 € pour bloquer ce créneau.', 26 * H),
      ],
      devis: { prix: 140, acompte: 40, duree: 120, details: 'Traits fins, noir.' }, creneau: { debut: dansJours(9) + 'T14:00', duree: 120 }, acompte: null,
    },
    {
      id: 'p3', client: 'c3', titre: 'Retouche · Poignet', etape: 'confirme', maj: maintenant - 3 * 24 * H, vuSha: 2, parSalon: true,
      infos: null, flash: null,
      messages: [msg('systeme', 'Rendez-vous fixé par le salon : retouche, 30 min.', 72 * H)],
      devis: { prix: 0, acompte: 0, duree: 30, details: '' }, creneau: { debut: dansJours(3) + 'T10:00', duree: 30 }, acompte: null,
    },
  ];

  let galerie = [];
  let exceptions = [{ id: 'x1', type: 'fermeture', du: dansJours(20), au: dansJours(24), plages: [], motif: 'congés', horaires: '' }];
  const feries = { auto: true, ouverts: [] };
  let reglages = {
    nom: 'Sha Tattoo', titreUne: 'Votre tatouage, / _sur mesure_', presentation: 'Traits fins, noir et blanc, ombrages, motifs floraux et lettrages.',
    specialites: 'Tatouage en traits fins (fineline)\nNoir et blanc, ombrages (black and grey)\nProjets personnalisés, floraux et lettrages\nStrass dentaires et blanchiment',
    adresse: '9 Route de Lille', codePostal: '62218', ville: 'Loison-sous-Lens', telephone: '06 50 81 15 32', email: '',
    instagram: 'https://www.instagram.com/sha_tatt00/', facebook: 'https://www.facebook.com/p/Sha-tattoo-61550087068470/',
    h0: '', h1: '', h2: '09:00-12:30 / 13:30-17:00', h3: '13:30-18:00', h4: '09:00-12:30 / 13:30-17:00', h5: '09:00-12:30 / 13:00-17:00', h6: '10:00-12:30 / 13:30-17:00',
    profil: BASE + '/img/profil.webp', paypal: '', wero: '', conditionsAcompte: 'L’acompte bloque votre créneau et sera déduit du prix final.', identifiant: 'demo',
  };

  /* ---------- Les réponses ---------- */
  const erreur = (status, message) => Object.assign(new Error(message), { status });
  const trouver = (pid) => { const p = projets.find((x) => x.id === pid); if (!p) throw erreur(404, 'Demande introuvable.'); return p; };
  const nomClient = (p) => { const c = clients.find((x) => x.id === p.client); return c ? `${c.prenom} ${c.nom}` : (p.externe ? p.externe.nom : 'Client'); };
  const vue = (p) => ({ ...p, client: p.client ? fiche(clients.find((c) => c.id === p.client)) : { prenom: p.externe.nom, nom: '', telephone: p.externe.telephone, compte: false } });
  const ligne = (p) => {
    const dernier = p.messages.filter((m) => m.de !== 'systeme').at(-1);
    return { id: p.id, titre: p.titre, etape: p.etape, maj: p.maj, creneau: p.creneau, parSalon: Boolean(p.parSalon), client: nomClient(p),
      apercu: dernier ? (dernier.de === 'sha' ? 'Vous : ' : '') + dernier.texte : '', nonLus: p.messages.slice(p.vuSha).filter((m) => m.de === 'client').length };
  };
  const systeme = (p, texte) => { p.messages.push(msg('systeme', texte, 0)); p.maj = Date.now(); };
  const RAISONS = { devis: 'devis pas encore accepté', creneau: 'acompte toujours pas payé', acompte_declare: 'acompte en cours de vérification' };
  function verifierCreneau(p, debut, duree) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(debut || '')) throw erreur(400, 'Date ou heure invalide.');
    const d = Date.parse(debut + ':00Z');
    const x = projets.find((o) => o !== p && o.creneau && o.etape !== 'annule' && Date.parse(o.creneau.debut + ':00Z') < d + duree * MIN && d < Date.parse(o.creneau.debut + ':00Z') + o.creneau.duree * MIN);
    if (x) throw erreur(409, x.etape === 'confirme' ? `Créneau déjà réservé (${fmt(x.creneau.debut)}) : rendez-vous confirmé.` : `Créneau déjà proposé à une autre personne (${fmt(x.creneau.debut)}) : ${RAISONS[x.etape]}.`);
    return { debut, duree };
  }
  const plagesTexte = (t) => String(t || '').replace(/(\d{1,2})(?::|h)?(\d{2})?\s*-\s*(\d{1,2})(?::|h)?(\d{2})?/g, (m, a, b, c, d) => `${Number(a)}h${b && b !== '00' ? b : ''} – ${Number(c)}h${d && d !== '00' ? d : ''}`).replace(/\s*\/\s*/g, ' · ');
  function calendrier() {
    const an = new Date().getFullYear();
    const liste = [[`${an}-12-25`, 'Noël'], [`${an + 1}-01-01`, 'Jour de l’An'], [`${an + 1}-05-01`, 'Fête du Travail'], [`${an + 1}-07-14`, 'Fête nationale']]
      .filter(([d]) => d >= iso(new Date()))
      .map(([date, nom]) => ({ date, nom, jour: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date + 'T12:00')), ouvert: !feries.auto || feries.ouverts.includes(date) }));
    return { exceptions: exceptions.slice().sort((a, b) => a.du.localeCompare(b.du)), feries: { auto: feries.auto, prochains: liste } };
  }

  async function api(methode, url, corps = {}) {
    await new Promise((r) => setTimeout(r, 120)); // comme un vrai réseau
    const route = `${methode} ${url.replace(/^.*?\/api\//, '/api/')}`;
    let m;
    if (route === 'GET /api/sha/etat') return { configure: true };
    if (route === 'POST /api/sha/connexion' || route === 'POST /api/sha/deconnexion') return { ok: true };
    if (route === 'GET /api/sha/projets') return projets.slice().sort((a, b) => b.maj - a.maj).map(ligne);
    if ((m = /^GET \/api\/sha\/projets\/([\w-]+)$/.exec(route))) { const p = trouver(m[1]); p.vuSha = p.messages.length; return vue(p); }
    if ((m = /^POST \/api\/sha\/projets\/([\w-]+)\/(\w[\w-]*)$/.exec(route))) {
      const p = trouver(m[1]);
      const action = m[2];
      if (action === 'messages') { p.messages.push({ ...msg('sha', corps.texte || '', 0), image: null }); p.maj = Date.now(); }
      if (action === 'devis') {
        const prix = Number(corps.prix), acompte = Number(corps.acompte), duree = Number(corps.duree);
        if (!prix || !acompte || acompte > prix) throw erreur(400, 'Indiquez un prix et un acompte (inférieur au prix).');
        const creneau = corps.debut ? verifierCreneau(p, corps.debut, duree) : null;
        p.devis = { prix, acompte, duree, details: corps.details || '' };
        p.creneau = creneau;
        p.etape = 'devis';
        systeme(p, `Devis envoyé : ${prix} € (acompte ${acompte} €)` + (creneau ? `, le ${fmt(creneau.debut)}.` : '.'));
        // Dans la démo, le client accepte tout de suite, pour montrer la suite.
        setTimeout(() => { if (p.etape === 'devis') { p.etape = p.creneau ? 'creneau' : 'devis_accepte'; systeme(p, 'Devis accepté par le client (démo).'); p.messages.at(-1).de = 'systeme'; } }, 4000);
      }
      if (action === 'creneau') {
        p.creneau = verifierCreneau(p, corps.debut, Number(corps.duree) || p.devis.duree);
        if (p.etape === 'devis_accepte') p.etape = 'creneau';
        systeme(p, `Créneau proposé : ${fmt(p.creneau.debut)}.`);
      }
      if (action === 'acompte-recu') { p.etape = 'confirme'; systeme(p, `Acompte reçu, merci ! Rendez-vous confirmé le ${fmt(p.creneau.debut)}.`); }
      if (action === 'annuler') { p.etape = 'annule'; systeme(p, 'Demande clôturée par le salon.'); }
      p.vuSha = p.messages.length;
      return vue(p);
    }
    if (route === 'GET /api/sha/clients') return clients.map((c) => ({ id: c.id, prenom: c.prenom, nom: c.nom, telephone: c.telephone }));
    if (route === 'POST /api/sha/rendez-vous') {
      const depuis = corps.depuis ? trouver(corps.depuis) : null;
      const p = { id: id(), client: corps.client || (depuis && depuis.client) || null, externe: corps.client || depuis ? null : { nom: corps.nom, telephone: corps.telephone || '' },
        titre: corps.titre, etape: Number(corps.acompte) ? 'creneau' : 'confirme', maj: Date.now(), vuSha: 1, parSalon: true, infos: null, flash: null,
        devis: { prix: Number(corps.prix) || 0, acompte: Number(corps.acompte) || 0, duree: Number(corps.duree), details: '' }, creneau: null, acompte: null, messages: [] };
      p.creneau = verifierCreneau(p, corps.debut, Number(corps.duree));
      systeme(p, `Rendez-vous fixé par le salon : ${fmt(p.creneau.debut)}.`);
      projets.push(p);
      return vue(p);
    }
    if (route === 'GET /api/sha/calendrier') return calendrier();
    if (route === 'POST /api/sha/exceptions') {
      if (!corps.du) throw erreur(400, 'Date invalide.');
      if (corps.type !== 'fermeture' && !corps.horaires) throw erreur(400, 'Horaires : champ obligatoire.');
      exceptions.push({ id: id(), type: corps.type, du: corps.du, au: corps.au || corps.du, motif: corps.motif || '', horaires: corps.type === 'fermeture' ? '' : plagesTexte(corps.horaires) });
      return calendrier();
    }
    if ((m = /^DELETE \/api\/sha\/exceptions\/([\w-]+)$/.exec(route))) { exceptions = exceptions.filter((x) => x.id !== m[1]); return calendrier(); }
    if (route === 'POST /api/sha/feries') {
      if ('auto' in corps) feries.auto = Boolean(corps.auto);
      if (corps.date) feries.ouverts = corps.ouvert ? [...feries.ouverts, corps.date] : feries.ouverts.filter((d) => d !== corps.date);
      return calendrier();
    }
    if (route === 'GET /api/sha/galerie') return galerie.slice().sort((a, b) => b.at - a.at);
    if (route === 'POST /api/sha/galerie') { const g = { id: id(), type: corps.type, titre: corps.titre || '', prix: corps.prix ? Number(corps.prix) : null, src: corps.image, dispo: true, at: Date.now() }; galerie.push(g); return g; }
    if ((m = /^POST \/api\/sha\/galerie\/([\w-]+)$/.exec(route))) { const g = galerie.find((x) => x.id === m[1]); Object.assign(g, corps); return g; }
    if ((m = /^DELETE \/api\/sha\/galerie\/([\w-]+)$/.exec(route))) { galerie = galerie.filter((x) => x.id !== m[1]); return { ok: true }; }
    if (route === 'GET /api/sha/reglages') return reglages;
    if (route === 'POST /api/sha/reglages') { const { nouveauMotDePasse, motDePasseActuel, ...reste } = corps; reglages = { ...reglages, ...reste }; return reglages; }
    if (route === 'POST /api/sha/profil') { reglages.profil = corps.image; return reglages; }
    if (route === 'DELETE /api/sha/profil') { reglages.profil = ''; return reglages; }
    throw erreur(404, 'Pas disponible dans la démo.');
  }
  Sha.api = api;

  // Un bandeau, pour qu'il n'y ait pas de malentendu.
  const bandeau = Sha.el('p', { class: 'demo-bandeau', role: 'note' },
    Sha.el('strong', {}, 'Démo de l’espace salon. '),
    'Les demandes sont des exemples, et tout se manipule : devis, créneau, acompte, photos, fermetures. Rien n’est enregistré : recharger la page remet tout à zéro.');
  document.body.prepend(bandeau);
})();
