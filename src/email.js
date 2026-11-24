'use strict';

/**
 * Envoi d'e-mails (les rappels de la veille), sans bibliothèque. Deux façons, au choix :
 *  - Cloudflare Email Service : la liaison « send_email » nommée EMAIL dans wrangler.jsonc
 *    (formule Workers Paid, domaine shatattoo.com ajouté dans Email Sending) ;
 *  - Resend (resend.com, gratuit jusqu'à 3 000 e-mails par mois) : le secret RESEND_API_KEY.
 * Sans l'un ni l'autre, rien n'est envoyé (les notifications, elles, partent toujours).
 */

/** « Sha Tattoo <rappel@shatattoo.com> » → { name, email }. */
function lireAdresse(texte) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(texte || ''));
  return m ? { name: m[1].replace(/^"|"$/g, ''), email: m[2].trim() } : { name: '', email: String(texte || '').trim() };
}

const ecrireAdresse = (a) => (a.name ? `${a.name.replace(/[<>"]/g, '')} <${a.email}>` : a.email);

/** Cloudflare : env.EMAIL.send({ from, to, subject, text, html, replyTo }). */
function viaCloudflare(liaison, expediteur) {
  const from = expediteur.name ? expediteur : expediteur.email;
  return async (m) => {
    await liaison.send({ from, to: m.to, subject: m.subject, text: m.text, html: m.html, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
  };
}

/** Resend : une requête HTTPS avec la clé. */
function viaResend(cle, expediteur) {
  return async (m) => {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: ecrireAdresse(expediteur), to: [m.to], subject: m.subject, text: m.text, html: m.html,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      }),
    });
    if (!r.ok) throw new Error(`Resend a refusé l’e-mail (${r.status}) : ${(await r.text()).slice(0, 300)}`);
  };
}

/**
 * La fonction d'envoi selon ce qui est configuré (variables de Cloudflare ou de l'ordinateur),
 * ou null. `expediteur` : « Nom <adresse@domaine> », une adresse du domaine vérifié.
 */
function choisirEnvoi(env = {}, expediteur) {
  const de = lireAdresse(expediteur);
  if (!de.email) return null;
  if (env.EMAIL && typeof env.EMAIL.send === 'function') return viaCloudflare(env.EMAIL, de);
  if (env.RESEND_API_KEY) return viaResend(env.RESEND_API_KEY, de);
  return null;
}

module.exports = { choisirEnvoi, lireAdresse };
