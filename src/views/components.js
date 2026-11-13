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
  { path: '/galerie', number: 3, label: 'En images' },
  { path: '/rendez-vous', number: 4, label: 'Prendre rendez-vous' },
  { path: '/nous-trouver', number: 5, label: 'Pratique' },
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
  // La carte est barrée d'un trait, et une étiquette est collée par-dessus : « Seulement par devis ».
  return html`<div class="carte-devis">
    <div class="carte-barree">
      <ul class="carte-liste" aria-label="${caption}" data-stagger>
        ${specialties.map(name => html`<li data-reveal><s>${name}</s></li>`)}
      </ul>
      <p class="carte-etiquette" data-reveal="stamp" data-delay="300">Seulement par devis</p>
    </div>
    <p class="actions carte-action" data-reveal>${messageButton('Demander un devis')}</p>
  </div>`;
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

/** Bouton qui ouvre la messagerie (le devis, puis le rendez-vous, se font par message). */
function messageButton(label = 'Écrire un message', { variant = 'btn--accent', flash = '' } = {}) {
  return html`<button type="button" class="btn ${variant}" data-ouvrir-chat ${flash ? raw(`data-flash="${escapeHtml(flash)}"`) : ''}>${buttonLabel(label)}${icon('arrow-right')}</button>`;
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
  openStatusLabel, openBadge, specialtiesTable, calendarNotices, houseRules, appointmentSentence,
  kicker, sectionBar, stamp, ticker, buttonLabel, button, messageButton, splitTitle,
};
