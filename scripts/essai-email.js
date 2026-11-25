'use strict';
// Essai des e-mails du site, depuis l'ordinateur, par Resend (comme le site en ligne) :
//   npm run essai-email -- adresse@exemple.fr
// La clé Resend (« re_… ») est demandée au clavier, sans s'afficher ; elle n'est enregistrée nulle part.
// Deux e-mails partent : l'essai, et un exemple de rappel client (rendez-vous fictif demain à 14 h 30).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const destinataire = process.argv[2];
if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(destinataire || '')) {
  console.error('Indiquez l’adresse : npm run essai-email -- adresse@exemple.fr');
  process.exit(1);
}

/** Demande la clé sans l'afficher à l'écran. */
function demanderCle() {
  if (process.env.RESEND_API_KEY) return Promise.resolve(process.env.RESEND_API_KEY);
  return new Promise((resolve) => {
    process.stdout.write('Clé Resend (re_…, rien ne s’affiche pendant la saisie) : ');
    let cle = '';
    const entree = process.stdin;
    if (entree.isTTY) entree.setRawMode(true);
    entree.resume();
    entree.setEncoding('utf8');
    entree.on('data', function lire(morceau) {
      for (const c of morceau) {
        if (c === '\r' || c === '\n') {
          if (entree.isTTY) entree.setRawMode(false);
          entree.pause();
          entree.removeListener('data', lire);
          process.stdout.write('\n');
          return resolve(cle.trim());
        }
        if (c === '\u0003') process.exit(1); // Ctrl+C
        if (c === '\u007f' || c === '\b') cle = cle.slice(0, -1);
        else cle += c;
      }
    });
  });
}

(async () => {
  const cle = await demanderCle();
  if (!/^re_\w+/.test(cle)) {
    console.error('Ce n’est pas une clé Resend (elle commence par « re_ »).');
    process.exit(1);
  }
  // Un dossier de données vide et temporaire : l'essai ne touche pas aux données du site.
  process.env.SHA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sha-essai-'));
  process.env.SHA_SANS_RESEAU = '1';
  const config = require('../salon.config.js');
  const { choisirEnvoi } = require('../src/email.js');
  // (Le site, chargé sur ce dossier vide, annoncerait un code de configuration : sans objet ici.)
  const log = console.log;
  console.log = () => {};
  const { exemplesEmail } = require('../server.js');
  console.log = log;
  const envoyer = choisirEnvoi({ RESEND_API_KEY: cle }, config.emailExpediteur);
  for (const m of exemplesEmail(destinataire)) {
    try {
      await envoyer(m);
      console.log(`Envoyé : « ${m.subject} » → ${m.to}`);
    } catch (e) {
      console.error(`Échec : « ${m.subject} » : ${e.message}`);
      process.exitCode = 1;
    }
  }
  fs.rmSync(process.env.SHA_DATA, { recursive: true, force: true });
})();
