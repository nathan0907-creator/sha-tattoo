'use strict';

/**
 * Où le site range ses données.
 *
 * Le serveur ne touche jamais au disque lui-même : il passe par un « stockage » qui offre
 * toujours les mêmes opérations.
 *   - sur l'ordinateur (npm start, les tests) : des fichiers dans data/ (ce module) ;
 *   - en ligne sur Cloudflare : la base SQLite du salon (cloudflare/stockage-sql.js).
 *
 * Les opérations :
 *   lireBase() / ecrireBase(db)      toutes les données (comptes, demandes, réglages…), en JSON ;
 *   lire(type, nom) → Buffer | null  un fichier déposé : type « galerie » (public) ou « chat » (privé) ;
 *   ecrire(type, nom, octets), supprimer(type, nom) ;
 *   noterCode(code), oublierCode()   le code de configuration de l'espace salon (ici, un fichier
 *                                    à ouvrir ; en ligne, c'est un secret de Cloudflare).
 */

const fs = require('node:fs');
const path = require('node:path');

const TYPES = ['galerie', 'chat'];
const NOM = /^[\w-]+\.(jpg|png|webp|mp4)$/;

function stockageFichiers(dossier) {
  for (const d of [dossier, ...TYPES.map((t) => path.join(dossier, t))]) fs.mkdirSync(d, { recursive: true });
  const base = path.join(dossier, 'base.json');
  const fichierCode = path.join(dossier, 'CODE-DE-CONFIGURATION.txt');
  const chemin = (type, nom) => {
    if (!TYPES.includes(type) || !NOM.test(nom)) throw new Error(`Fichier refusé : ${type}/${nom}`);
    return path.join(dossier, type, nom);
  };

  return {
    lireBase() {
      try {
        return JSON.parse(fs.readFileSync(base, 'utf8'));
      } catch {
        return null;
      }
    },
    ecrireBase(db) {
      const tmp = base + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, base);
    },
    lire(type, nom) {
      try {
        return fs.readFileSync(chemin(type, nom));
      } catch {
        return null;
      }
    },
    ecrire(type, nom, octets) {
      fs.writeFileSync(chemin(type, nom), octets);
    },
    supprimer(type, nom) {
      try {
        fs.rmSync(chemin(type, nom), { force: true });
      } catch { /* nom refusé : rien à effacer */ }
    },
    noterCode(code) {
      fs.writeFileSync(
        fichierCode,
        `Code de configuration de l'espace salon (adresse du site + /salon) :\n\n  ${code}\n\nIl sert une seule fois, pour choisir l'identifiant et le mot de passe.\nUn nouveau code est créé à chaque lancement tant que l'accès n'est pas configuré.\n`,
      );
      fs.rmSync(path.join(dossier, 'MOT-DE-PASSE-SHA.txt'), { force: true });
      console.log(`\n  Espace salon à configurer : code ${code}\n  (aussi noté dans data/CODE-DE-CONFIGURATION.txt)\n`);
    },
    oublierCode() {
      fs.rmSync(fichierCode, { force: true });
    },
  };
}

module.exports = { stockageFichiers, NOM };
