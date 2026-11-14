'use strict';

/**
 * Le stockage du site en ligne : la base SQLite du salon (Durable Object Cloudflare). Mêmes
 * opérations que les fichiers de data/ sur l'ordinateur (voir src/stockage.js).
 *
 * Cloudflare limite une ligne à 2 Mo : les données (JSON) et les fichiers déposés (photos,
 * images des messages, vidéos récupérées sur TikTok) sont rangés en morceaux d'un Mo.
 */

const MORCEAU = 1_000_000;
const TYPES = ['galerie', 'chat'];

/** JSON en caractères ASCII seulement (accents écrits « é ») : un caractère = un octet, coupable n'importe où. */
const jsonAscii = (donnees) => JSON.stringify(donnees).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function stockageSql(sql, transaction = (fn) => fn()) {
  sql.exec('CREATE TABLE IF NOT EXISTS donnees (morceau INTEGER PRIMARY KEY, valeur TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS fichiers (type TEXT NOT NULL, nom TEXT NOT NULL, morceau INTEGER NOT NULL, octets BLOB NOT NULL, PRIMARY KEY (type, nom, morceau))');
  const verifier = (type) => {
    if (!TYPES.includes(type)) throw new Error(`Type de fichier inconnu : ${type}`);
  };

  return {
    lireBase() {
      const lignes = sql.exec('SELECT valeur FROM donnees ORDER BY morceau').toArray();
      if (!lignes.length) return null;
      try {
        return JSON.parse(lignes.map((l) => l.valeur).join(''));
      } catch (e) {
        // Des données abîmées ne doivent jamais être écrasées en silence.
        throw new Error(`Données illisibles (${e.message})`);
      }
    },
    ecrireBase(db) {
      const texte = jsonAscii(db);
      const n = Math.max(1, Math.ceil(texte.length / MORCEAU));
      transaction(() => {
        for (let i = 0; i < n; i++) sql.exec('INSERT OR REPLACE INTO donnees (morceau, valeur) VALUES (?, ?)', i, texte.slice(i * MORCEAU, (i + 1) * MORCEAU));
        sql.exec('DELETE FROM donnees WHERE morceau >= ?', n);
      });
    },
    lire(type, nom) {
      verifier(type);
      const lignes = sql.exec('SELECT octets FROM fichiers WHERE type = ? AND nom = ? ORDER BY morceau', type, nom).toArray();
      return lignes.length ? Buffer.concat(lignes.map((l) => Buffer.from(l.octets))) : null;
    },
    ecrire(type, nom, octets) {
      verifier(type);
      const buf = Buffer.from(octets);
      transaction(() => {
        sql.exec('DELETE FROM fichiers WHERE type = ? AND nom = ?', type, nom);
        for (let i = 0; i * MORCEAU < Math.max(1, buf.length); i++) {
          // Les octets seuls, sans le reste de la mémoire dont ils peuvent faire partie.
          sql.exec('INSERT INTO fichiers (type, nom, morceau, octets) VALUES (?, ?, ?, ?)', type, nom, i, new Uint8Array(buf.subarray(i * MORCEAU, (i + 1) * MORCEAU)).buffer);
        }
      });
    },
    supprimer(type, nom) {
      verifier(type);
      sql.exec('DELETE FROM fichiers WHERE type = ? AND nom = ?', type, nom);
    },
    // En ligne, le code de configuration est le secret SETUP_CODE : rien à noter ni à effacer.
    noterCode() {},
    oublierCode() {},
  };
}

module.exports = { stockageSql, MORCEAU };
