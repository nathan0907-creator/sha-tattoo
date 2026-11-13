'use strict';

// Gabarit commun, repris de la gazette de L'atelier de Cyrille : même en-tête, même pied de page
// (« l'ours »), même rideau d'ouverture. Ce qui change pour Sha Tattoo : pas de réservation en
// ligne (les rendez-vous se prennent par message), et la messagerie est jointe à
// chaque page.

const { html, raw, jsonForScript } = require('./html');
const { icon, sprite } = require('./icons');
const { PAGES, edition, capitalize, telHref, buttonLabel, appointmentSentence, hoursTable, openBadge } = require('./components');
const { fromMinutes } = require('../time');

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Les quatre familles de la gazette (les mêmes que chez Cyrille) :
//   Grand Hotel            le titre et les mots en écriture : une cursive d'enseigne des années trente
//   League Gothic          les gros titres, en capitales étroites
//   Old Standard TT        titres secondaires et texte
//   Archivo Narrow         surtitres, étiquettes, boutons
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@400..700&family=Grand+Hotel&family=League+Gothic&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&display=swap';

/** « 07 45 07 50 16 » → « +33745075016 », la forme que lisent les moteurs de recherche. */
const internationalPhone = phone => {
  const digits = phone.replace(/[^\d+]/g, '');
  return /^0\d{9}$/.test(digits) ? `+33${digits.slice(1)}` : digits;
};

/** Données structurées lues par les moteurs de recherche : la fiche du salon et le fil d'Ariane. */
function structuredData(site, { crumb = '', trail = [] } = {}) {
  const { config, origin, path } = site;
  const at = target => `${origin}${target}`;
  const hero = config.photos.hero;
  const links = [config.contact.instagram, config.contact.facebook].filter(Boolean);

  const salon = {
    '@type': 'TattooParlor',
    '@id': at('/#salon'),
    name: config.name,
    description: config.description,
    url: at('/'),
    ...(config.contact.phone && { telephone: internationalPhone(config.contact.phone) }),
    ...(config.contact.email && { email: config.contact.email }),
    ...(hero && { image: [at(hero.src)] }),
    address: {
      '@type': 'PostalAddress',
      streetAddress: config.address.street,
      postalCode: config.address.postalCode,
      addressLocality: config.address.city,
      addressCountry: 'FR',
    },
    areaServed: [config.address.city, ...config.seo.nearby].map(name => ({ '@type': 'City', name })),
    hasMap: config.maps.view,
    openingHoursSpecification: Object.entries(config.hours).flatMap(([day, ranges]) =>
      ranges.map(range => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${SCHEMA_DAYS[day]}`,
        opens: fromMinutes(range.start),
        closes: fromMinutes(range.end),
      }))),
    ...(links.length && { sameAs: links }),
  };

  const graph = [salon];
  if (path === '/') {
    graph.push({ '@type': 'WebSite', '@id': at('/#site'), url: at('/'), name: config.name, inLanguage: 'fr-FR', publisher: { '@id': salon['@id'] } });
  } else if (crumb) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [{ name: config.name, path: '/' }, ...trail, { name: crumb, path }]
        .map((step, i) => ({ '@type': 'ListItem', position: i + 1, name: step.name, item: at(step.path) })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * La photo de profil du salon, en médaillon rond cerclé d'un dégradé violet. Tant qu'aucune
 * photo n'est déposée (espace salon, Réglages), le médaillon porte l'initiale du salon.
 */
function avatar(config, className = 'brand-avatar') {
  return config.avatar
    ? html`<img class="${className}" src="${config.avatar}" alt="" width="44" height="44" decoding="async">`
    : html`<span class="${className} avatar-lettre" aria-hidden="true">${config.name.charAt(0)}</span>`;
}

/** Le titre de la gazette, en écriture d'enseigne, avec la photo de profil en médaillon. */
function brand(config, href = '/') {
  return html`<a class="brand" href="${href}" aria-label="${config.name}, retour à la une">${avatar(config)}${config.name}</a>`;
}

/**
 * Rideau d'ouverture, joué une fois par visite (voir boot.js) : le journal du jour s'ouvre en deux.
 * Chez Cyrille, des ciseaux le coupent ; ici, la machine à tatouer trace la ligne.
 */
function intro(site) {
  const { config, now } = site;
  const half = side => html`<div class="intro-half intro-half--${side}"><p>${config.name}</p></div>`;
  return html`<div class="intro" aria-hidden="true">
    ${half('top')}${half('bottom')}
    <p class="intro-date">Édition du ${edition(now).date}</p>
    <span class="intro-cut">${icon('machine')}</span>
  </div>`;
}

function header(site) {
  const { config, path } = site;
  return html`<header class="site-header" data-header>
    <div class="site-header-inner">
      ${brand(config)}
      <nav class="site-nav" id="menu" aria-label="Pages du journal">
        <ul>
          ${PAGES.map(page => html`<li><a ${page.path === '/rendez-vous' ? raw('class="nav-book"') : ''} href="${page.path}" ${path === page.path ? raw('aria-current="page"') : ''}><span class="nav-num">${page.number}</span>${page.label}</a></li>`)}
        </ul>
        <p class="nav-meta">${config.address.street}, ${config.address.postalCode} ${config.address.city}</p>
      </nav>
      <a class="btn btn--small btn--accent header-cta" href="/rendez-vous">${buttonLabel('Rendez-vous')}${icon('arrow-right')}</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="menu" data-menu-toggle>
        <span class="menu-toggle-label">Sommaire</span>
        <span class="menu-toggle-bars" aria-hidden="true"><span></span><span></span></span>
      </button>
    </div>
  </header>`;
}

/** Téléphone : la prise de rendez-vous reste à portée de pouce, dans une barre en bas de l'écran. */
function dock(site) {
  if (site.path === '/rendez-vous') return '';
  return html`<a class="dock" href="/rendez-vous" data-dock>
    <span class="dock-text">
      <span class="dock-label">Rendez-vous</span>
      <span class="dock-slot">Par message</span>
    </span>
    <span class="dock-go">Écrire ${icon('arrow-right')}</span>
  </a>`;
}

/**
 * Avis sur les cookies. Le site n'en dépose aucun pour suivre ses visiteurs ; la seule chose à
 * accepter ou refuser est le plan Google Maps.
 */
function cookieNotice() {
  return html`<section class="cookies" aria-label="Cookies" data-cookies hidden>
    <p class="cookies-text"><strong>Cookies.</strong> Ce site ne vous suit pas : ni publicité, ni traceur. Seul le plan Google Maps de la page Pratique dépose des cookies de Google. Les acceptez-vous&nbsp;?</p>
    <div class="cookies-actions">
      <button type="button" class="btn btn--small" data-cookies-choice="non">${buttonLabel('Refuser')}</button>
      <button type="button" class="btn btn--small" data-cookies-choice="oui">${buttonLabel('Accepter')}</button>
      <a class="link" href="/confidentialite#cookies">En savoir plus</a>
    </div>
  </section>`;
}

/** Bas de page : « tournez la page », comme dans un journal. */
function pager(path) {
  const index = PAGES.findIndex(page => page.path === path);
  if (index === -1) return '';
  const previous = PAGES[index - 1];
  const next = PAGES[index + 1];
  return html`<nav class="pager container" aria-label="Tourner les pages">
    ${previous
      ? html`<a class="pager-link pager-link--prev" href="${previous.path}">${icon('arrow-right')}<span><small>Page ${previous.number}</small>${previous.label}</span></a>`
      : html`<span></span>`}
    ${next
      ? html`<a class="pager-link pager-link--next" href="${next.path}"><span><small>Tournez la page · page ${next.number}</small>${next.label}</span>${icon('arrow-right')}</a>`
      : html`<a class="pager-link pager-link--next" href="/"><span><small>Fin du journal</small>Revenir à la une</span>${icon('arrow-right')}</a>`}
  </nav>`;
}

function footer(site) {
  const { config, now, status, path } = site;
  const { contact } = config;
  return html`<footer class="site-footer">
    ${pager(path)}
    <div class="ours">
      <div class="container ours-grid">
        <div class="ours-col ours-brand">
          ${brand(config)}
          <p>${config.tagline}${config.tagline ? ' · ' : ''}${config.address.city}</p>
          ${config.booking.appointmentOnly ? html`<p class="ours-rule">${config.booking.appointmentOnly}</p>` : ''}
          <p class="ours-phrase">${appointmentSentence()}.</p>
          ${openBadge(status)}
        </div>
        <div class="ours-col">
          <h2 class="ours-title">Adresse</h2>
          <address>${config.address.street}<br>${config.address.postalCode} ${config.address.city}</address>
          <a class="link" href="/nous-trouver">Plan et itinéraire</a>
        </div>
        <div class="ours-col">
          <h2 class="ours-title">Horaires</h2>
          ${hoursTable(config, now)}
        </div>
        <div class="ours-col">
          <h2 class="ours-title">Contact</h2>
          <ul class="ours-list">
            <li><button type="button" class="link" data-ouvrir-chat>Écrire un message</button></li>
            ${contact.phone ? html`<li><a class="link" href="${telHref(contact.phone)}">${contact.phone}</a></li>` : ''}
            ${contact.email ? html`<li><a class="link" href="mailto:${contact.email}">${contact.email}</a></li>` : ''}
            ${contact.instagram ? html`<li><a class="link" href="${contact.instagram}" target="_blank" rel="noopener">Instagram</a></li>` : ''}
            ${contact.facebook ? html`<li><a class="link" href="${contact.facebook}" target="_blank" rel="noopener">Facebook</a></li>` : ''}
          </ul>
        </div>
      </div>
      <div class="container ours-bottom">
        <p>© ${now.date.slice(0, 4)} ${config.name} · ${capitalize(edition(now).date)}</p>
        <ul>
          <li><a href="/mentions-legales">L'ours : mentions légales</a></li>
          <li><a href="/confidentialite">Confidentialité</a></li>
          <li><a href="/conditions">Conditions d'utilisation</a></li>
          <li><button type="button" class="ours-button" data-cookies-open>Cookies</button></li>
          <li><a href="/salon" rel="nofollow">La rédaction</a></li>
        </ul>
      </div>
    </div>
  </footer>`;
}

/**
 * La messagerie, jointe à chaque page : un panneau qui s'ouvre depuis n'importe quel bouton
 * [data-ouvrir-chat]. Un client déjà connecté retrouve ses messages par la pastille en bas d'écran.
 */
function messaging(site) {
  const unread = site.client ? site.client.unread : 0;
  return html`${site.client ? html`<button class="chat-bulle" type="button" data-ouvrir-chat aria-label="Ouvrir mes messages${unread ? ` (${unread} non lu${unread > 1 ? 's' : ''})` : ''}">
    ${icon('chat')}<span>Mes messages</span>${unread ? html`<b class="chat-bulle-nb">${unread}</b>` : ''}
  </button>` : ''}
  <div class="chat-fond" id="chat-fond" hidden></div>
  <aside class="chat" id="chat" role="dialog" aria-modal="true" aria-labelledby="chat-titre" hidden>
    <header class="chat-tete">
      <button class="icon-btn" type="button" id="chat-retour" aria-label="Retour" hidden>${icon('arrow-left')}</button>
      <div class="chat-qui">
        ${avatar(site.config, 'chat-avatar')}
        <div>
          <p class="chat-titre" id="chat-titre">${site.config.name}</p>
          <p class="chat-sous" id="chat-sous">Devis et rendez-vous</p>
        </div>
      </div>
      <button class="icon-btn" type="button" id="chat-fermer" aria-label="Fermer la messagerie">${icon('close')}</button>
    </header>
    <div class="chat-corps" id="chat-corps"></div>
  </aside>
  <div class="visionneuse" id="visionneuse" hidden>
    <button class="icon-btn" type="button" aria-label="Fermer l'image" data-fermer-visionneuse>${icon('close')}</button>
    <img alt="">
  </div>`;
}

/**
 * Gabarit commun.
 *   bare    : page sans en-tête ni pied de page du site (espace salon) ;
 *   crumb   : nom de la page dans le fil d'Ariane des moteurs de recherche ;
 *   trail   : les pages entre la une et celle-ci, dans ce fil ([{ name, path }]) ;
 *   preload : la grande image à charger en priorité.
 */
function layout(site, {
  title, description, body, bodyClass = '', styles = [], scripts = [],
  bare = false, noindex = false, crumb = '', trail = [], preload = null,
}) {
  const { config, path } = site;
  const origin = site.origin || config.siteUrl;
  // Sans titre propre (la une) : le métier et la ville d'abord, ce que tapent les clients.
  const fullTitle = title ? `${title} · ${config.name}` : `${config.trade} à ${config.address.city} · ${config.name}`;
  const metaDescription = description || config.description;
  const url = `${origin}${path === '/' ? '/' : path}`;

  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${metaDescription}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : raw('<meta name="robots" content="index, follow, max-image-preview:large">')}
${noindex || !origin ? '' : html`<link rel="canonical" href="${url}">`}
<meta name="theme-color" content="#f1efec">
<meta name="color-scheme" content="only light">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${config.name}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${metaDescription}">
${origin ? html`<meta property="og:url" content="${url}">` : ''}
<meta name="twitter:card" content="summary">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${preload && preload.src ? html`<link rel="preload" as="image" href="${preload.src}" fetchpriority="high">` : ''}
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/css/base.css">
${styles.map(href => html`<link rel="stylesheet" href="${href}">`)}
<link rel="stylesheet" href="/css/messages.css">
<script src="/js/boot.js"></script>
${bare || !origin ? '' : html`<script type="application/ld+json">${jsonForScript(structuredData({ ...site, origin }, { crumb, trail }))}</script>`}
</head>
<body class="${bodyClass}">
${sprite}
<a class="skip-link" href="#contenu">Aller au contenu</a>
${bare ? '' : html`${intro(site)}<span class="scroll-progress" aria-hidden="true" data-scroll-progress></span>`}
${bare ? '' : header(site)}
${body}
${bare ? '' : html`${footer(site)}${dock(site)}${cookieNotice()}${messaging(site)}`}
${bare ? '' : html`<script type="module" src="/js/site.js"></script>
<script src="/js/commun.js" defer></script>
<script src="/js/chat.js" defer></script>`}
${scripts.map(src => (src.endsWith('.mjs') || src === '/js/gallery.js'
    ? html`<script type="module" src="${src}"></script>`
    : html`<script src="${src}" defer></script>`))}
</body>
</html>`;
}

module.exports = { layout, brand };
