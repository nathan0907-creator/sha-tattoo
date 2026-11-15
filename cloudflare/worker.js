/**
 * Sha Tattoo en ligne sur Cloudflare (configuration : wrangler.jsonc ; mode d'emploi : README).
 *
 * Deux pièces, comme pour L'atelier de Cyrille :
 *  - le Worker (export default) reçoit chaque visite. Il sert lui-même les fichiers de public/
 *    (styles, scripts, photos, flashs, vidéos) et passe tout le reste au salon ;
 *  - le salon (classe Salon, un « Durable Object ») : une seule instance, en Europe de l'Ouest, qui
 *    fait tourner le site comme sur l'ordinateur (server.js) et range ses données dans sa propre
 *    base SQLite (cloudflare/stockage-sql.js) : comptes, messages, photos déposées, réglages.
 */

import { DurableObject } from 'cloudflare:workers';
import serveur from '../server.js';
import { stockageSql } from './stockage-sql.js';
import { toFetchHandler } from './adaptateur.js';
import config from '../salon.config.js';

export class Salon extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Le code de première connexion de l'espace salon : le secret SETUP_CODE (README).
    serveur.initialiser(stockageSql(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn)), { code: env.SETUP_CODE || '' });
    this.gerer = toFetchHandler(serveur.gerer);
  }

  async fetch(request) {
    const reponse = await this.gerer(request);
    serveur.sauverSiBesoin();
    // Notifications en cours d'envoi, vidéo TikTok en cours de récupération : on les laisse finir.
    this.ctx.waitUntil(serveur.travauxEnCours().then(() => serveur.sauverSiBesoin()));
    if (!this.reveilPrevu) await this.prevoirReveil();
    return reponse;
  }

  /** Le réveil, toutes les quinze minutes : les rappels de la veille (envoyés à partir de 18 h). */
  async alarm() {
    serveur.tache();
    await serveur.travauxEnCours();
    serveur.sauverSiBesoin();
    await this.prevoirReveil(true);
  }

  async prevoirReveil(forcer = false) {
    const prevu = forcer ? null : await this.ctx.storage.getAlarm();
    if (prevu === null) await this.ctx.storage.setAlarm(Date.now() + 15 * 60000);
    this.reveilPrevu = true;
  }
}

/** Un fichier de public/, avec les en-têtes de sécurité du site et le bon cache. */
function avecEntetes(reponse, type) {
  const entetes = new Headers(reponse.headers);
  if (reponse.status === 200 || reponse.status === 206) entetes.set('Content-Type', type);
  // Styles, scripts, manifestes et service worker : toujours revalidés (une mise à jour se voit tout de suite).
  entetes.set('Cache-Control', /javascript|css|manifest/.test(type) ? 'no-cache' : 'public, max-age=86400');
  for (const [nom, valeur] of Object.entries(serveur.ENTETES)) entetes.set(nom, valeur);
  entetes.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(reponse.body, { status: reponse.status, headers: entetes });
}

/**
 * Une vidéo demandée par morceaux (« Range ») : Safari et l'iPhone ne lisent une vidéo qu'ainsi.
 * Si Cloudflare a renvoyé le fichier entier, on découpe le morceau demandé.
 */
async function morceau(request, reponse) {
  const plage = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (reponse.status !== 200 || !plage || (!plage[1] && !plage[2])) return reponse;
  const octets = new Uint8Array(await reponse.arrayBuffer());
  const taille = octets.length;
  const debut = plage[1] ? Number(plage[1]) : Math.max(0, taille - Number(plage[2]));
  const fin = plage[1] && plage[2] ? Math.min(Number(plage[2]), taille - 1) : taille - 1;
  if (debut > fin || debut >= taille) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${taille}` } });
  const entetes = new Headers(reponse.headers);
  entetes.set('Content-Range', `bytes ${debut}-${fin}/${taille}`);
  entetes.set('Content-Length', String(fin - debut + 1));
  entetes.set('Accept-Ranges', 'bytes');
  return new Response(octets.slice(debut, fin + 1), { status: 206, headers: entetes });
}

/**
 * L'adresse …workers.dev et « www. » renvoient vers le nom de domaine (siteUrl), page pour page.
 * Sauf ce qui fait marcher les applications déjà installées sur l'ancienne adresse : les échanges
 * avec le serveur (/api/), le service worker et les manifestes.
 */
function versLeDomaine(request, url) {
  const site = config.siteUrl ? new URL(config.siteUrl) : null;
  if (!site || url.hostname === site.hostname) return null;
  if (!url.hostname.endsWith('.workers.dev') && url.hostname !== `www.${site.hostname}`) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js' || url.pathname.endsWith('.webmanifest')) return null;
  return Response.redirect(site.origin + url.pathname + url.search, 301);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const renvoi = versLeDomaine(request, url);
    if (renvoi) return renvoi;
    const extension = /\.[a-z0-9]+$/i.exec(url.pathname)?.[0].toLowerCase();
    const type = extension && serveur.TYPES[extension];
    // Un fichier de public/ est servi directement (les photos déposées, elles, sont dans le salon).
    if (type && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/galerie/')) {
      let reponse = await env.ASSETS.fetch(request);
      if (reponse.status !== 404) {
        if (type === 'video/mp4') reponse = await morceau(request, reponse);
        return avecEntetes(reponse, type);
      }
    }
    return env.SALON.get(env.SALON.idFromName('salon'), { locationHint: 'weur' }).fetch(request);
  },
};
