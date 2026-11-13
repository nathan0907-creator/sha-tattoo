'use strict';
// Identifiant ou mot de passe de l'espace salon oubliés : à lancer site arrêté.
//   npm run reinitialiser-acces
// L'accès est effacé ; au prochain lancement, un nouveau code de configuration est créé
// (data/CODE-DE-CONFIGURATION.txt) pour choisir un nouvel identifiant et un nouveau mot de passe.
const fs = require('node:fs');
const path = require('node:path');

const base = path.join(process.env.SHA_DATA || path.join(__dirname, '..', 'data'), 'base.json');
const db = JSON.parse(fs.readFileSync(base, 'utf8'));
db.sha = null;
for (const [k, s] of Object.entries(db.sessions || {})) if (s.qui === 'sha') delete db.sessions[k];
fs.writeFileSync(base, JSON.stringify(db));
console.log("Accès à l'espace salon effacé. Relancez le site : le code de configuration sera dans data/CODE-DE-CONFIGURATION.txt.");
