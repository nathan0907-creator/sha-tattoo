'use strict';

// Repris de la gazette de L'atelier de Cyrille : mêmes motifs (surtitre, bandeau de rubrique,
// tampon, bandeau défilant, titres découpés), sans ce qui touchait à la coiffure et à la
// réservation en ligne (tableaux de tarifs, horaires, créneaux).

const { html, raw, escapeHtml } = require('./html');
const { icon } = require('./icons');
const { frTime, weekday, WEEKDAYS, formatLong, dayOfYear } = require('../time');

/** 42 → « 42 € », 24.5 → « 24,50 € » */
const euros = amount => `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace('.', ',')} €`;

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
const telHref = phone => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Image : width et height réservent la place avant le chargement, la page ne saute pas.
 * (Les photos publiées par le salon sont déjà allégées à l'envoi.)
 */
function picture(photo, { lazy = true, className = '' } = {}) {
  if (!photo || !photo.src) return '';
  return html`<img class="${className}" src="${photo.src}"
    ${photo.width && photo.height ? raw(`width="${escapeHtml(photo.width)}" height="${escapeHtml(photo.height)}"`) : ''}
    alt="${photo.alt || ''}" ${raw(lazy ? 'loading="lazy"' : 'fetchpriority="high"')} decoding="async">`;
}

/** Classe CSS du format d'une photo : « 4/5 » → « r-4-5 ». */
const ratioClass = photo => `r-${['4/3', '4/5', '1/1', '3/4', '16/9'].includes(photo.ratio) ? photo.ratio.replace('/', '-') : '4-5'}`;

// ── Le journal : pages, date d'édition ─────────────────────────────────────

/** Les pages du journal, dans l'ordre où on les tourne. */
const PAGES = [
  { path: '/', number: 1, label: 'La une' },
  { path: '/prestations', number: 2, label: 'La carte' },
  { path: '/flashs', number: 3, label: 'Les flashs' },
  { path: '/galerie', number: 4, label: 'En images' },
  { path: '/evenements', number: 5, label: 'Événements' },
  { path: '/rendez-vous', number: 6, label: 'Prendre rendez-vous' },
  { path: '/nous-trouver', number: 7, label: 'Pratique' },
];

/** « samedi 10 octobre 2026 » et numéro du jour dans l'année, comme sur la manchette d'un quotidien. */
function edition(now) {
  return { date: `${formatLong(now.date)} ${now.date.slice(0, 4)}`, number: dayOfYear(now.date) };
}

/** Titre courant en haut de chaque page : « Page 2 — La carte — samedi 10 octobre 2026 ». */
function folio(site, page) {
  return html`<p class="folio" data-reveal>
    <span>Page ${page.number}</span><span>${page.label}</span><span>${capitalize(edition(site.now).date)}</span>
  </p>`;
}

// ── Horaires ───────────────────────────────────────────────────────────────

/** Horaires de la semaine, lundi d'abord, avec le jour courant repéré. */
function weekHours(config, now) {
  const today = weekday(now.date);
  return [1, 2, 3, 4, 5, 6, 0].map(day => ({
    day: capitalize(WEEKDAYS[day]),
    today: day === today,
    label: config.hours[day].length
      ? config.hours[day].map(r => `${frTime(r.start)} – ${frTime(r.end)}`).join(' · ')
      : 'Fermé',
    closed: !config.hours[day].length,
  }));
}

function hoursTable(config, now) {
  return html`<table class="hours">
    <caption class="sr-only">Horaires d'ouverture</caption>
    <tbody>
      ${weekHours(config, now).map(row => html`<tr class="${row.today ? 'is-today' : ''} ${row.closed ? 'is-closed' : ''}">
        <th scope="row">${row.day}${row.today ? html`<span class="sr-only"> (aujourd'hui)</span>` : ''}</th>
        <td>${row.label}</td>
      </tr>`)}
    </tbody>
  </table>`;
}

/** « du mardi au samedi » : premier et dernier jour d'ouverture de la semaine. */
function openDaysSentence(config) {
  const open = [1, 2, 3, 4, 5, 6, 0].filter(day => config.hours[day].length);
  if (!open.length) return '';
  if (open.length === 1) return `le ${WEEKDAYS[open[0]]}`;
  return `du ${WEEKDAYS[open[0]]} au ${WEEKDAYS[open.at(-1)]}`;
}

/** « Ouvert jusqu'à 17h » ou « Fermé · ouvre demain à 9h » */
function openStatusLabel(status) {
  if (status.open) return `Ouvert jusqu'à ${frTime(status.until)}`;
  if (!status.date) return 'Fermé';
  const day = status.offset === 0 ? '' : status.offset === 1 ? 'demain ' : `${WEEKDAYS[weekday(status.date)]} `;
  return `Fermé · ouvre ${day}à ${frTime(status.at)}`;
}

function openBadge(status) {
  return html`<p class="open-badge ${status.open ? 'is-open' : 'is-closed'}"><span class="dot" aria-hidden="true"></span>${openStatusLabel(status)}</p>`;
}

// ── La carte ───────────────────────────────────────────────────────────────

/**
 * La carte : les spécialités du salon, ligne par ligne, et une seule option au bout — le devis.
 * (Chez Cyrille, chaque ligne porte ses prix ; ici, tout passe par le devis.)
 */
function specialtiesTable(specialties, caption) {
  // La carte, et un post-it collé à côté : « Mais seulement par devis… ici », le « ici » entouré
  // à la main est le bouton qui ouvre la demande de devis.
  return html`<div class="carte-devis">
    <ul class="carte-liste" aria-label="${caption}" data-stagger>
      ${specialties.map(name => html`<li data-reveal>${name}</li>`)}
    </ul>
    <div class="post-it" data-reveal="stamp" data-delay="300">
      <p>Mais seulement <span>par devis</span></p>
      <button type="button" class="post-it-ici" data-ouvrir-chat aria-label="Demander un devis">
        <span class="post-it-ici-mot">ici</span>${icon('arrow-right')}
      </button>
    </div>
  </div>`;
}

/**
 * Les prochaines disponibilités, pour une retouche ou un petit tatouage : un encadré, jour par
 * jour, avec les plages libres. Chaque jour ouvre la messagerie (le rendez-vous se prend par
 * message, avec l'acompte, comme les autres).
 */
function availabilityBox(disponibilites, { id = 'dispos-titre' } = {}) {
  return html`<section class="box dispos" aria-labelledby="${id}" data-reveal>
    <h2 class="box-title" id="${id}">Prochaines disponibilités</h2>
    <p class="dispos-pour">Pour une retouche ou un petit tatouage.</p>
    ${disponibilites.length
      ? html`<ul class="dispos-liste">${disponibilites.map(d => html`<li>
          <button type="button" class="dispos-jour" data-ouvrir-chat data-date="${d.date}">
            <span class="dispos-date">${capitalize(d.jour)}</span>
            <span class="dispos-heures">${d.texte}</span>
          </button>
        </li>`)}</ul>`
      : html`<p class="field-hint">Pas de disponibilité dans les prochaines semaines : écrivez quand même, une place peut se libérer.</p>`}
    <p class="field-hint">Pour un projet plus grand, le créneau est fixé avec le devis. Un acompte est demandé pour chaque rendez-vous.</p>
  </section>`;
}

/** Les annonces du calendrier (fermetures, ouvertures, horaires exceptionnels) en brèves. */
function calendarNotices(annonces, { limit = 4 } = {}) {
  return annonces.slice(0, limit).map(a => html`<li class="${a.type === 'fermeture' ? 'briefs-alert' : 'briefs-note'}"><strong>${a.type === 'fermeture' ? 'Fermeture.' : 'À noter.'}</strong> ${capitalize(a.texte.replace(/^Fermé /, ''))}.</li>`);
}

// ── Motifs du journal ──────────────────────────────────────────────────────

/** Les règles du salon, dites d'un bloc : « Uniquement sur rendez-vous », puis l'acompte. */
function houseRules(config, { className = 'rules' } = {}) {
  const { appointmentOnly, rule } = config.booking;
  if (!appointmentOnly && !rule) return '';
  return html`<p class="${className}">${icon('info')}<span>${appointmentOnly ? html`<strong>${appointmentOnly}.</strong> ` : ''}${rule}</span></p>`;
}

/**
 * La phrase de la prise de rendez-vous, toujours écrite de la même façon :
 * « Les rendez-vous se prennent par message ».
 */
const appointmentSentence = () => html`Les rendez-vous se prennent par message`;

/** Surtitre d'article : « À LA UNE », « PRATIQUE »… */
const kicker = text => html`<p class="kicker" data-reveal>${text}</p>`;

/** Bandeau de rubrique : un titre entre deux filets et, à droite, le renvoi vers la page concernée. */
function sectionBar(id, title, page = null) {
  return html`<header class="section-bar" data-reveal>
    <h2 class="section-title" id="${id}">${title}</h2>
    ${page ? html`<a class="section-note" href="${page.path}" aria-label="${page.label}, page ${page.number}">Suite page ${page.number} ${icon('arrow-right')}</a>` : ''}
  </header>`;
}

/**
 * Tampon rond dont le texte tourne. Avec href, c'est un lien (flèche au centre) ;
 * sinon un simple décor. id doit être unique dans la page.
 */
function stamp(text, { id, href = '', label = '', className = '', attrs = '' } = {}) {
  const art = html`<svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <defs><path id="${id}" d="M100 100m-74 0a74 74 0 1 1 148 0a74 74 0 1 1-148 0"/></defs>
    <circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="52"/>
    <text><textPath href="#${id}" textLength="452">${text}</textPath></text>
  </svg>`;
  return href
    ? html`<a class="stamp stamp--solid ${className}" href="${href}" aria-label="${label}" ${raw(attrs)}>${art}${icon('arrow-up-right')}</a>`
    : html`<span class="stamp ${className}" aria-hidden="true" ${raw(attrs)}>${art}</span>`;
}

/** Bandeau qui défile en haut de la une. L'étiquette de gauche ne défile pas. */
function ticker(items, label = 'Au salon') {
  return html`<div class="ticker" aria-hidden="true" data-marquee>
    <p class="ticker-label">${label}</p>
    <div class="ticker-window">
      <div class="ticker-track">
        ${[0, 1].map(() => html`<ul>${items.map(item => html`<li>${item}</li>`)}</ul>`)}
      </div>
    </div>
  </div>`;
}

// ── Boutons et titres ──────────────────────────────────────────────────────

/** Libellé de bouton : data-text sert à l'effet de « roulement » du texte au survol. */
const buttonLabel = label => html`<span data-text="${label}">${label}</span>`;

function button(label, href, { variant = '', iconName = 'arrow-right', magnetic = false, external = false } = {}) {
  return html`<a class="btn ${variant}" href="${href}" ${raw(magnetic ? 'data-magnetic' : '')} ${raw(external ? 'target="_blank" rel="noopener"' : '')}>${buttonLabel(label)}${iconName ? icon(iconName) : ''}</a>`;
}

/**
 * Bouton qui ouvre la messagerie (le devis, puis le rendez-vous, se font par message).
 * flash : la demande porte sur ce flash ; evenement : c'est une demande d'animation tatouage.
 */
function messageButton(label = 'Écrire un message', { variant = 'btn--accent', flash = '', evenement = false } = {}) {
  return html`<button type="button" class="btn ${variant}" data-ouvrir-chat ${flash ? raw(`data-flash="${escapeHtml(flash)}"`) : ''} ${evenement ? raw('data-evenement') : ''}>${buttonLabel(label)}${icon('arrow-right')}</button>`;
}

// ── Réseaux, paiement, vidéos ──────────────────────────────────────────────

const RESEAUX = [
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['facebook', 'Facebook'],
];

/** « https://www.tiktok.com/@sha22.10 » → « @sha22.10 » : le nom du compte, tel qu'on le cherche. */
function handle(url) {
  const m = /(?:instagram\.com|tiktok\.com)\/(@?[\w.-]+)/i.exec(url || '');
  return m ? `@${m[1].replace(/^@/, '')}` : '';
}

/**
 * Les réseaux du salon, en pastilles rondes avec leur icône.
 *   withNames : le nom du réseau et du compte à côté de l'icône (sinon, l'icône seule).
 */
function socialLinks(contact, { withNames = false, className = '' } = {}) {
  const liens = RESEAUX.filter(([key]) => contact[key]);
  if (!liens.length) return '';
  return html`<ul class="reseaux ${withNames ? 'reseaux--noms' : ''} ${className}">
    ${liens.map(([key, name]) => html`<li><a class="reseau reseau--${key}" href="${contact[key]}" target="_blank" rel="noopener" ${withNames ? '' : raw(`aria-label="${name} (nouvel onglet)"`)}>
      <span class="reseau-icone">${icon(key)}</span>
      ${withNames ? html`<span class="reseau-texte"><b>${name}</b>${handle(contact[key]) ? html`<small>${handle(contact[key])}</small>` : ''}</span>` : ''}
    </a></li>`)}
  </ul>`;
}

/** Le bouton PayPal : un lien sobre, qui ouvre PayPal dans un nouvel onglet. */
function paypalButton(contact, { label = 'Payer par PayPal', variant = 'btn--outline' } = {}) {
  if (!contact.paypal) return '';
  return html`<a class="btn btn-paypal-site ${variant}" href="${contact.paypal}" target="_blank" rel="noopener">${icon('paypal')}${buttonLabel(label)}${icon('arrow-up-right')}</a>`;
}

/**
 * Les vidéos TikTok, au format vertical. Rien n'est chargé depuis TikTok avant le clic : une
 * vignette et un bouton lecture tiennent la place (comme le plan Google Maps). Sans vidéo
 * publiée, des cadres « exemple » montrent où elles iront et mènent au compte TikTok.
 */
function videoGrid(videos, contact, { limit = 4 } = {}) {
  const compte = handle(contact.tiktok);
  if (!videos.length) {
    return html`<ul class="videos videos--exemple">
      ${[1, 2, 3].map(i => html`<li class="video" data-reveal data-delay="${i * 80}">
        <a class="video-facade" ${contact.tiktok ? raw(`href="${escapeHtml(contact.tiktok)}" target="_blank" rel="noopener"`) : ''} aria-label="Exemple de vidéo ${i}, à ajouter${contact.tiktok ? ' : voir le compte TikTok' : ''}">
          <span class="video-exemple"><b>Exemple</b><span>Vidéo TikTok ${i}</span><small>à ajouter</small></span>
          <span class="video-play">${icon('play')}</span>
          ${compte ? html`<span class="video-marque">${icon('tiktok')}${compte}</span>` : ''}
        </a>
      </li>`)}
    </ul>`;
  }
  return html`<ul class="videos">
    ${videos.slice(0, limit).map((v, i) => html`<li class="video" data-reveal data-delay="${i * 80}">
      ${videoPlayer(v, compte)}
      ${v.titre ? html`<p class="video-titre">${v.titre}</p>` : ''}
    </li>`)}
  </ul>`;
}

/** Une vidéo TikTok verticale : vignette et bouton lecture ; le lecteur TikTok se charge au clic. */
function videoPlayer(v, compte = '', { lazy = true } = {}) {
  return html`<div class="video-cadre" data-tiktok="${v.id}">
    <button type="button" class="video-facade" data-tiktok-play aria-label="Lire la vidéo${v.titre ? ` : ${v.titre}` : ''}">
      ${v.vignette ? html`<img src="${v.vignette}" alt="" width="540" height="960" ${raw(lazy ? 'loading="lazy"' : 'fetchpriority="high"')} decoding="async">` : ''}
      <span class="video-play">${icon('play')}</span>
      <span class="video-marque">${icon('tiktok')}${v.auteur ? `@${v.auteur}` : compte}</span>
    </button>
  </div>`;
}

/** La rubrique vidéo : les vidéos, puis les réseaux. */
function videoSection(site, { id = 'videos-titre', title = 'En vidéo', bar, videos = site.videos } = {}) {
  const { config } = site;
  if (!config.contact.tiktok && !videos.length) return '';
  return html`<section class="container section video-section" aria-labelledby="${id}">
    ${bar ? bar(id, title) : html`<h2 class="menu-group-title" id="${id}" data-reveal>${title}</h2>`}
    ${videoGrid(videos, config.contact)}
    <div class="video-pied" data-reveal>
      ${socialLinks(config.contact, { withNames: true })}
      ${videos.length ? html`<p class="field-hint">Les vidéos sont lues depuis TikTok, qui dépose ses propres cookies quand vous en lancez une.</p>` : ''}
    </div>
  </section>`;
}

/**
 * Titre découpé en lignes puis en mots : chaque mot sort de son masque, comme une ligne
 * qu'on compose. _mots_ → en écriture, dans la couleur du salon ; *mots* → en écriture multicolore.
 * (Une espace sépare les lignes : elles peuvent ainsi se suivre sur une seule, en bandeau.)
 */
function splitTitle(lines) {
  return lines.map((line, n) => {
    const words = String(line).split(/(_[^_]+_|\*[^*]+\*)/).filter(Boolean).flatMap(part => {
      const mark = /^_.+_$/.test(part) ? 'script' : /^\*.+\*$/.test(part) ? 'magic' : '';
      return (mark ? part.slice(1, -1) : part).split(/ +/).filter(Boolean).map(word => ({ word, mark }));
    });
    return html`${n ? ' ' : ''}<span class="line">${words.map((w, i) => html`${i ? ' ' : ''}<span class="w"><span class="w-i">${
      w.mark === 'magic' ? html`<em class="magic">${w.word}</em>` : w.mark ? html`<em>${w.word}</em>` : w.word
    }</span></span>`)}</span>`;
  });
}

module.exports = {
  euros, capitalize, telHref, picture, ratioClass, PAGES, edition, folio, weekHours, hoursTable, openDaysSentence,
  openStatusLabel, openBadge, specialtiesTable, availabilityBox, calendarNotices, houseRules, appointmentSentence,
  kicker, sectionBar, stamp, ticker, buttonLabel, button, messageButton, splitTitle,
  socialLinks, paypalButton, videoGrid, videoSection, videoPlayer, handle,
};
