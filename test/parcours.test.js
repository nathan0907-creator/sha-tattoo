'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sha-test-'));
process.env.SHA_DATA = dossier;
const log = console.log;
console.log = () => {};
const { gerer, ageAu, contactValide, sauverMaintenant } = require('../server.js');
console.log = log;
const codeConfig = /:\s*\n\n\s+(\S+)/.exec(fs.readFileSync(path.join(dossier, 'CODE-DE-CONFIGURATION.txt'), 'utf8'))[1];
const ACCES = { identifiant: 'shannon', motDePasse: 'encre-et-aiguilles' };

let base;
const serveur = http.createServer((req, res) => gerer(req, res));
test.before(() => new Promise((r) => serveur.listen(0, () => { base = `http://localhost:${serveur.address().port}`; r(); })));
test.after(() => { serveur.close(); sauverMaintenant(); fs.rmSync(dossier, { recursive: true, force: true }); });

function navigateur() {
  const cookies = {};
  return async (methode, url, corps) => {
    const rep = await fetch(base + url, {
      method: methode,
      headers: { 'Content-Type': 'application/json', Origin: base, Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    for (const c of rep.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      cookies[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { status: rep.status, corps: await rep.json().catch(() => null) };
  };
}

const page = async (chemin) => {
  const rep = await fetch(base + chemin, { redirect: 'manual' });
  return { status: rep.status, html: await rep.text(), lieu: rep.headers.get('location') };
};
/** Le texte d'une page, sans les balises ni les scripts. */
const lisible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const ilYa = (ans, jours = 0) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - ans);
  d.setDate(d.getDate() + jours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Une vraie image d'un pixel, pour les envois.
const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex').toString('base64');

test('accès au salon : identifiant et mot de passe choisis avec le code de configuration', async () => {
  const sha = navigateur();
  assert.deepStrictEqual((await sha('GET', '/api/sha/etat')).corps, { configure: false });
  assert.strictEqual((await sha('POST', '/api/sha/connexion', ACCES)).status, 409);
  assert.strictEqual((await sha('POST', '/api/sha/configurer', { ...ACCES, code: '0000-0000' })).status, 403);
  assert.strictEqual((await sha('POST', '/api/sha/configurer', { ...ACCES, code: codeConfig, motDePasse: 'court' })).status, 400);
  assert.strictEqual((await sha('POST', '/api/sha/configurer', { ...ACCES, code: codeConfig })).status, 200);
  assert.ok(!fs.existsSync(path.join(dossier, 'CODE-DE-CONFIGURATION.txt')), 'le code ne sert qu’une fois');
  assert.strictEqual((await sha('POST', '/api/sha/configurer', { ...ACCES, code: codeConfig })).status, 409);

  const autre = navigateur();
  assert.strictEqual((await autre('POST', '/api/sha/connexion', { identifiant: 'shannon', motDePasse: 'mauvais-mot' })).status, 401);
  assert.strictEqual((await autre('POST', '/api/sha/connexion', { identifiant: 'quelquun', motDePasse: ACCES.motDePasse })).status, 401);
  assert.strictEqual((await autre('POST', '/api/sha/connexion', { identifiant: 'Shannon', motDePasse: ACCES.motDePasse })).status, 200);
  // Changer de mot de passe demande le mot de passe actuel
  assert.strictEqual((await autre('POST', '/api/sha/reglages', { nouveauMotDePasse: 'un-autre-mot-de-passe' })).status, 403);
  const r = await autre('GET', '/api/sha/reglages');
  assert.strictEqual(r.corps.identifiant, 'shannon');
});

/** Un navigateur connecté à l'espace salon. */
async function salon() {
  const sha = navigateur();
  assert.strictEqual((await sha('POST', '/api/sha/connexion', ACCES)).status, 200);
  return sha;
}

test('âge et contact', () => {
  assert.strictEqual(ageAu('2000-06-15', new Date(2018, 5, 14)), 17);
  assert.strictEqual(ageAu('2000-06-15', new Date(2018, 5, 15)), 18);
  assert.deepStrictEqual(contactValide('06 12 34 56 78'), { type: 'tel', valeur: '0612345678' });
  assert.deepStrictEqual(contactValide('+33 6 12 34 56 78'), { type: 'tel', valeur: '0612345678' });
  assert.deepStrictEqual(contactValide('Lea@Exemple.fr'), { type: 'email', valeur: 'lea@exemple.fr' });
  assert.throws(() => contactValide('bonjour'));
});

test('parcours complet : compte 18+, demande préparée par l’assistant, devis, créneau, acompte, confirmation', async () => {
  const client = navigateur();
  const sha = navigateur();
  const compte = { telephone: '07 11 22 33 44', email: 'lea@exemple.fr', prenom: 'Léa', nom: 'Martin', motDePasse: 'motdepasse1' };

  // Le téléphone est obligatoire
  let r = await client('POST', '/api/inscription', { ...compte, telephone: '', naissance: ilYa(30) });
  assert.strictEqual(r.status, 400);
  r = await client('POST', '/api/inscription', { ...compte, telephone: 'lea@exemple.fr', naissance: ilYa(30) });
  assert.strictEqual(r.status, 400);

  // Mineur bloqué (la veille de ses 18 ans)
  r = await client('POST', '/api/inscription', { ...compte, naissance: ilYa(18, 1) });
  assert.strictEqual(r.status, 403);
  assert.match(r.corps.erreur, /mineures/);

  // Sans compte : pas de message
  r = await client('POST', '/api/projets', { texte: 'Bonjour' });
  assert.strictEqual(r.status, 401);

  r = await client('POST', '/api/inscription', { ...compte, naissance: ilYa(18) });
  assert.strictEqual(r.status, 200);
  r = await client('POST', '/api/inscription', { ...compte, naissance: ilYa(30) });
  assert.strictEqual(r.status, 409);

  // Avant d'envoyer : photo de référence, endroit et taille obligatoires ; message facultatif
  const demande = { reference: png, emplacement: 'Avant-bras', taille: '12 cm', texte: 'Une pivoine, en noir.' };
  assert.strictEqual((await client('POST', '/api/projets', { ...demande, reference: undefined })).status, 400);
  assert.strictEqual((await client('POST', '/api/projets', { ...demande, emplacement: '' })).status, 400);
  assert.strictEqual((await client('POST', '/api/projets', { ...demande, taille: ' ' })).status, 400);
  r = await client('POST', '/api/projets', demande);
  assert.strictEqual(r.status, 200);
  const pid = r.corps.id;
  assert.strictEqual(r.corps.etape, 'discussion');
  assert.strictEqual(r.corps.titre, 'Projet · Avant-bras');
  assert.deepStrictEqual({ e: r.corps.infos.emplacement, t: r.corps.infos.taille }, { e: 'Avant-bras', t: '12 cm' });
  const duClient = r.corps.messages.filter((m) => m.de === 'client');
  assert.deepStrictEqual(duClient.map((m) => m.texte), ['Endroit : Avant-bras\nTaille : 12 cm\nUne pivoine, en noir.']);
  assert.ok(duClient[0].image && duClient[0].image === r.corps.infos.reference);
  // Une fausse image est refusée
  r = await client('POST', '/api/projets', { ...demande, reference: 'data:image/png;base64,AAAA' });
  assert.strictEqual(r.status, 400);

  // Les photos d'une demande ne sont visibles que par son client et par le salon
  const image = `/api/projets/${pid}/images/${duClient[0].image}`;
  assert.strictEqual((await fetch(base + image)).status, 401);

  // Le client ne peut pas valider de devis qui n'existe pas, ni payer d'acompte
  assert.strictEqual((await client('POST', `/api/projets/${pid}/accepter-devis`, {})).status, 400);
  assert.strictEqual((await client('POST', `/api/projets/${pid}/acompte`, { mode: 'paypal' })).status, 400);

  // Le salon
  assert.strictEqual((await sha('GET', '/api/sha/projets')).status, 401);
  assert.strictEqual((await sha('POST', '/api/sha/connexion', ACCES)).status, 200);
  r = await sha('GET', '/api/sha/projets');
  assert.strictEqual(r.corps.find((p) => p.id === pid).nonLus, 1);
  // Le salon voit l'endroit, la taille et la référence
  const vueSalon = (await sha('GET', `/api/sha/projets/${pid}`)).corps;
  assert.strictEqual(vueSalon.infos.emplacement, 'Avant-bras');
  assert.strictEqual((await sha('GET', `/api/projets/${pid}/images/${vueSalon.infos.reference}`)).status, 200);
  await sha('POST', '/api/sha/reglages', { paypal: 'https://www.paypal.me/shatattoo', wero: '06 11 22 33 44' });

  // Pas de créneau avant l'accord sur le devis
  assert.strictEqual((await sha('POST', `/api/sha/projets/${pid}/creneau`, { debut: '2099-01-10T14:00', duree: 120 })).status, 400);

  r = await sha('POST', `/api/sha/projets/${pid}/devis`, { prix: 250, acompte: 80, duree: 180, details: 'Noir, trait fin' });
  assert.strictEqual(r.corps.etape, 'devis');
  assert.strictEqual(r.corps.client.age, 18);

  r = await client('POST', `/api/projets/${pid}/accepter-devis`, {});
  assert.strictEqual(r.corps.etape, 'devis_accepte');

  r = await sha('POST', `/api/sha/projets/${pid}/creneau`, { debut: '2099-01-10T14:00', duree: 180 });
  assert.strictEqual(r.corps.etape, 'creneau');

  r = await client('GET', `/api/projets/${pid}`);
  assert.strictEqual(r.corps.paiement.paypal, 'https://paypal.me/shatattoo/80EUR');
  assert.strictEqual(r.corps.paiement.wero, '06 11 22 33 44');
  assert.match(r.corps.paiement.salon, /9 Route de Lille, 62218 Loison-sous-Lens/);
  assert.strictEqual(r.corps.client, undefined, 'le client ne reçoit pas les données réservées au salon');

  r = await client('POST', `/api/projets/${pid}/acompte`, { mode: 'wero' });
  assert.strictEqual(r.corps.etape, 'acompte_declare');

  r = await sha('POST', `/api/sha/projets/${pid}/acompte-recu`, {});
  assert.strictEqual(r.corps.etape, 'confirme');

  // Un autre rendez-vous sur le même créneau est refusé
  const autre = navigateur();
  await autre('POST', '/api/inscription', { ...compte, telephone: '0612345678', email: '', naissance: ilYa(25) });
  const p2 = (await autre('POST', '/api/projets', { ...demande, emplacement: 'Poignet', taille: '3 cm' })).corps.id;
  await sha('POST', `/api/sha/projets/${p2}/devis`, { prix: 60, acompte: 20, duree: 30 });
  await autre('POST', `/api/projets/${p2}/accepter-devis`, {});
  r = await sha('POST', `/api/sha/projets/${p2}/creneau`, { debut: '2099-01-10T15:00', duree: 30 });
  assert.strictEqual(r.status, 409);

  // Cloisonnement : un client ne voit pas la demande d'un autre
  assert.strictEqual((await autre('GET', `/api/projets/${pid}`)).status, 404);

  // Connexion par téléphone (écrit autrement) ou par e-mail
  const meme = navigateur();
  assert.strictEqual((await meme('POST', '/api/connexion', { contact: '+33 6 12 34 56 78', motDePasse: 'motdepasse1' })).status, 200);
  assert.strictEqual((await navigateur()('POST', '/api/connexion', { contact: 'lea@exemple.fr', motDePasse: 'motdepasse1' })).status, 200);

  // Un rendez-vous fixé par le salon : une retouche pour Léa, sans acompte, durée choisie
  r = await sha('POST', '/api/sha/rendez-vous', { depuis: pid, titre: 'Retouche', debut: '2099-02-01T10:00', duree: 30 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.corps.etape, 'confirme');
  assert.strictEqual(r.corps.creneau.duree, 30);
  assert.strictEqual(r.corps.client.prenom, 'Léa');
  const retouche = r.corps.id;
  // … qu'elle retrouve dans ses messages
  const moi = (await client('GET', '/api/moi')).corps;
  assert.ok(moi.projets.some((p) => p.id === retouche && p.nonLus > 0));
  // Un petit créneau pour une personne sans compte, avec acompte
  r = await sha('POST', '/api/sha/rendez-vous', { nom: 'Inès', telephone: '06 99 88 77 66', titre: 'Petit tatouage', debut: '2099-02-01T11:00', duree: 45, prix: 60, acompte: 20 });
  assert.strictEqual(r.corps.etape, 'creneau');
  assert.strictEqual(r.corps.client.compte, false);
  // Chevauchement refusé
  r = await sha('POST', '/api/sha/rendez-vous', { nom: 'X', titre: 'Essai', debut: '2099-02-01T10:15', duree: 30 });
  assert.strictEqual(r.status, 409);

  // Les coordonnées de paiement ne paraissent jamais sur les pages publiques
  for (const chemin of ['/', '/rendez-vous', '/nous-trouver']) {
    const { html } = await page(chemin);
    assert.ok(!html.includes('shatattoo') && !html.includes('06 11 22 33 44'), chemin);
  }
});

test('les pages du journal : la base de Cyrille, les informations de Sha Tattoo', async () => {
  const une = await page('/');
  assert.strictEqual(une.status, 200);
  const texteUne = lisible(une.html);
  assert.match(texteUne, /Sha Tattoo/);
  assert.match(texteUne, /9 Route de Lille/);
  assert.match(texteUne, /Ouvert du mardi au samedi/);
  assert.match(texteUne, /Tatouage en traits fins \(fineline\)/);
  assert.match(texteUne, /Seulement par devis/);
  assert.ok(une.html.includes('<s>Tatouage en traits fins (fineline)</s>'), 'la carte est barrée');
  // Le téléphone ne paraît que dans le pied de page
  for (const chemin of ['/', '/rendez-vous', '/nous-trouver', '/prestations']) {
    const html = (await page(chemin)).html;
    const avantPied = html.slice(0, html.indexOf('<footer'));
    assert.ok(!avantPied.includes('06 50 81 15 32'), chemin);
    assert.ok(html.slice(html.indexOf('<footer')).includes('06 50 81 15 32'), chemin);
    assert.doesNotMatch(lisible(html), /majeur/i, chemin);
  }
  assert.ok(une.html.includes('family=Archivo+Narrow') && une.html.includes('Grand+Hotel'), 'les polices de la gazette de Cyrille');

  // La prise de rendez-vous : la phrase exacte, « devis » en gras et en italique
  const phrase = 'Les rendez-vous se prennent par message';
  assert.doesNotMatch(lisible(une.html), /après le devis/);
  assert.ok(une.html.includes(phrase));
  const rdv = await page('/rendez-vous');
  assert.ok(rdv.html.includes(phrase));
  // Ni encadré « Comment réserver », ni réservation en ligne, ni annonce du compte à créer
  for (const html of [une.html, rdv.html]) {
    const t = lisible(html.slice(html.indexOf('<main'), html.indexOf('</main>')));
    assert.doesNotMatch(t, /Comment réserver|Réserver en ligne|Prochain créneau/i);
    assert.doesNotMatch(t, /\bcompte\b/i, 'la création de compte n’est pas annoncée sur le site');
  }

  const pratique = lisible((await page('/nous-trouver')).html);
  // (Le jour courant porte la mention « (aujourd'hui) » pour les lecteurs d'écran.)
  const jour = (nom, horaires) => new RegExp(`${nom} (\\(aujourd'hui\\) )?${horaires}`);
  assert.match(pratique, jour('Mardi', '9h – 12h30 · 13h30 – 17h'));
  assert.match(pratique, jour('Vendredi', '9h – 12h30 · 13h – 17h'));
  assert.match(pratique, jour('Lundi', 'Fermé'));

  for (const chemin of ['/prestations', '/galerie', '/mentions-legales', '/confidentialite', '/conditions', '/salon']) {
    assert.strictEqual((await page(chemin)).status, 200, chemin);
  }
  const flashs = await page('/flashs');
  assert.strictEqual(flashs.status, 302);
  assert.strictEqual(flashs.lieu, '/prestations#flashs');

  const inconnue = await page('/nimporte-quoi');
  assert.strictEqual(inconnue.status, 404);
  assert.match(lisible(inconnue.html), /jamais été imprimée/);
  assert.match((await page('/robots.txt')).html, /Disallow: \/salon/);
});

test('fermetures, ouvertures et horaires exceptionnels ; jours fériés fermés d’office', async () => {
  const sha = await salon();
  const cal = (await sha('GET', '/api/sha/calendrier')).corps;
  assert.ok(cal.feries.auto);
  // Les jours fériés tombant un jour travaillé sont listés, fermés par défaut
  assert.ok(cal.feries.prochains.length > 0 && cal.feries.prochains.every((f) => !f.ouvert));

  // Une fermeture proche, annoncée sur le site
  const demain = ilYa(0, 1);
  const apresDemain = ilYa(0, 2);
  let r = await sha('POST', '/api/sha/exceptions', { type: 'fermeture', du: demain, au: apresDemain, motif: 'congés' });
  assert.strictEqual(r.status, 200);
  const ferme = r.corps.exceptions[0];
  assert.match(lisible((await page('/')).html), /congés/);
  assert.match(lisible((await page('/nous-trouver')).html), /À noter/);

  // Horaires exceptionnels mal écrits : refusés ; bien écrits : enregistrés
  r = await sha('POST', '/api/sha/exceptions', { type: 'horaires', du: ilYa(0, 5), horaires: 'le matin' });
  assert.strictEqual(r.status, 400);
  r = await sha('POST', '/api/sha/exceptions', { type: 'ouverture', du: ilYa(0, 6), horaires: '10h-16h', motif: 'flash day' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.corps.exceptions.some((e) => e.type === 'ouverture' && e.horaires === '10h – 16h'));
  assert.match(lisible((await page('/')).html), /Ouverture exceptionnelle/);

  // Ouvrir un jour férié
  const ferie = cal.feries.prochains[0];
  r = await sha('POST', '/api/sha/feries', { date: ferie.date, ouvert: true });
  assert.ok(r.corps.feries.prochains.find((f) => f.date === ferie.date).ouvert);

  r = await sha('DELETE', '/api/sha/exceptions/' + ferme.id);
  assert.ok(!r.corps.exceptions.some((e) => e.id === ferme.id));
  assert.strictEqual((await navigateur()('POST', '/api/sha/exceptions', { type: 'fermeture', du: demain })).status, 401);
});

test('l’espace salon : galerie, horaires, photo de profil, refus des faux fichiers et des requêtes externes', async () => {
  const sha = await salon();

  // Aucun flash n'est fourni avec le site : la tatoueuse publie les siens
  assert.deepStrictEqual(await (await fetch(base + '/api/galerie')).json(), []);
  assert.match(lisible((await page('/prestations')).html), /À paraître/);

  let r = await sha('POST', '/api/sha/galerie', { type: 'flash', titre: 'Pivoine', prix: 120, image: png, largeur: 800, hauteur: 1000 });
  assert.strictEqual(r.status, 200);
  const g = r.corps;
  r = await sha('POST', '/api/sha/galerie', { type: 'flash', titre: '', image: png });
  assert.strictEqual(r.status, 200, 'une planche de flashs peut ne pas avoir de titre');
  r = await sha('POST', '/api/sha/galerie', { type: 'photo', image: 'data:image/png;base64,' + Buffer.from('<script>').toString('base64') });
  assert.strictEqual(r.status, 400);

  const pub = await (await fetch(base + '/api/galerie')).json();
  assert.ok(pub.some((x) => x.id === g.id && x.prix === 120));
  assert.strictEqual((await fetch(base + g.src)).status, 200);
  const carte = (await page('/prestations')).html;
  assert.ok(carte.includes(g.src) && carte.includes('width="800" height="1000"'));
  assert.ok(carte.includes(`data-flash="${g.id}"`), 'le flash se demande par message');

  await sha('POST', '/api/sha/galerie/' + g.id, { dispo: false });
  assert.strictEqual((await (await fetch(base + '/api/galerie')).json()).find((x) => x.id === g.id).dispo, false);
  assert.match(lisible((await page('/prestations')).html), /Déjà tatoué/);

  // Horaires : écrits librement, enregistrés toujours de la même façon
  r = await sha('POST', '/api/sha/reglages', { h1: '9h-12h / 14h à 18h30', h6: '' });
  assert.strictEqual(r.corps.h1, '09:00-12:00 / 14:00-18:30');
  assert.strictEqual(r.corps.h6, '');
  assert.match(lisible((await page('/')).html), /Ouvert du lundi au vendredi/);
  r = await sha('POST', '/api/sha/reglages', { h2: 'le matin' });
  assert.strictEqual(r.status, 400);
  assert.match(r.corps.erreur, /mardi/);

  // Photo de profil : le médaillon à côté du nom
  // Par défaut, la photo de profil du salon (salon.config.js)
  assert.ok((await page('/')).html.includes('class="brand-avatar" src="/img/profil.webp"'));
  assert.strictEqual((await fetch(base + '/img/profil.webp')).status, 200);
  r = await sha('POST', '/api/sha/profil', { image: png });
  assert.match(r.corps.profil, /^\/galerie\//);
  assert.ok((await page('/')).html.includes(`class="brand-avatar" src="${r.corps.profil}"`));
  r = await sha('DELETE', '/api/sha/profil');
  assert.strictEqual(r.corps.profil, '');

  // Un réglage obligatoire laissé vide reprend sa valeur de départ
  r = await sha('POST', '/api/sha/reglages', { nom: 'Sha Tattoo', ville: 'Loison-sous-Lens', telephone: '' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.corps.telephone, '');
  assert.strictEqual((await sha('POST', '/api/sha/reglages', { nom: '' })).status, 400);

  const externe = await fetch(base + '/api/sha/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://pirate.example' }, body: '{}' });
  assert.strictEqual(externe.status, 403);
  assert.strictEqual((await fetch(base + '/api/sha/reglages')).status, 401);
});
