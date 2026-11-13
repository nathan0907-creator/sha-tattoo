'use strict';

/**
 * Fabrique la démonstration du site pour GitHub Pages : une copie « fixe » des pages publiques.
 *
 *   node scripts/export-demo.js _site --base=/sha-tattoo
 *
 * GitHub Pages n'affiche que des fichiers : il ne fait pas tourner le serveur. La démo montre
 * donc la une, la carte, les photos, la prise de rendez-vous, la page Pratique et les pages
 * légales ; la messagerie (comptes, devis, acompte) et l'espace salon n'y fonctionnent pas.
 *
 * Les pages sont produites par le vrai serveur, lancé avec un dossier de données vide et
 * temporaire : aucune donnée réelle (comptes, messages, photos des clients) n'entre dans la démo.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const sortie = path.resolve(process.argv[2] || '_site');
const base = ((process.argv.find((a) => a.startsWith('--base=')) || '--base=').slice(7)).replace(/\/+$/, '');
const racine = path.join(__dirname, '..');

// Un dossier de données vide, jeté à la fin.
const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'sha-demo-'));
process.env.SHA_DATA = donnees;
const log = console.log;
console.log = () => {};
const { gerer } = require(path.join(racine, 'server.js'));
console.log = log;

const PAGES = ['/', '/prestations', '/galerie', '/rendez-vous', '/nous-trouver', '/mentions-legales', '/confidentialite', '/conditions', '/salon'];

/** Les adresses du site (« /prestations », « /img/une.webp ») deviennent celles de la démo (« /sha-tattoo/… »). */
function adapter(html) {
  return html
    .replace(/(\s(?:href|src|action|data-src|data-full|data-zoom|srcset)=")\/(?!\/)/g, `$1${base}/`)
    .replace('<html lang="fr">', '<html lang="fr" data-demo="1">')
    // L'espace salon fonctionne avec un faux serveur d'exemple, chargé juste après les outils communs.
    .replace(/(<script src="[^"]*\/js\/commun\.js" defer><\/script>)(\s*<script src="[^"]*\/js\/sha\.js")/, `$1\n<script src="${base}/js/demo-salon.js" defer></script>$2`);
}

function copier(de, vers) {
  fs.mkdirSync(vers, { recursive: true });
  for (const e of fs.readdirSync(de, { withFileTypes: true })) {
    const a = path.join(de, e.name);
    const b = path.join(vers, e.name);
    if (e.isDirectory()) copier(a, b);
    else fs.copyFileSync(a, b);
  }
}

const serveur = http.createServer((req, res) => gerer(req, res));
serveur.listen(0, async () => {
  const adresse = `http://localhost:${serveur.address().port}`;
  try {
    fs.rmSync(sortie, { recursive: true, force: true });
    copier(path.join(racine, 'public'), sortie);
    for (const page of PAGES) {
      const rep = await fetch(adresse + page);
      if (!rep.ok) throw new Error(`${page} : ${rep.status}`);
      const fichier = page === '/' ? path.join(sortie, 'index.html') : path.join(sortie, page.slice(1), 'index.html');
      fs.mkdirSync(path.dirname(fichier), { recursive: true });
      fs.writeFileSync(fichier, adapter(await rep.text()));
    }
    // La page « introuvable » de GitHub Pages : l'erratum du journal.
    fs.writeFileSync(path.join(sortie, '404.html'), adapter(await (await fetch(adresse + '/page-introuvable')).text()));
    // Sans ce fichier, GitHub Pages ignorerait certains fichiers.
    fs.writeFileSync(path.join(sortie, '.nojekyll'), '');
    console.log(`Démonstration prête dans ${sortie} (${PAGES.length} pages, adresse de base « ${base || '/'} »).`);
  } catch (e) {
    console.error('Échec :', e.message);
    process.exitCode = 1;
  } finally {
    serveur.close();
    fs.rmSync(donnees, { recursive: true, force: true });
  }
});
