'use strict';

const { html } = require('./html');
const { icon } = require('./icons');
const { layout } = require('./layout');
const {
  PAGES, picture, button, messageButton, splitTitle, kicker, sectionBar, stamp, ticker, edition, capitalize,
  ratioClass, houseRules, appointmentSentence, euros, openBadge, hoursTable, openDaysSentence, specialtiesTable,
  calendarNotices,
} = require('./components');

const { addDays: addDaysISO } = require('../time');

const pageOf = path => PAGES.find(page => page.path === path);

/** La une du journal (même mise en page que la gazette de L'atelier de Cyrille). */
function home(site) {
  const { config, now, status, flashs, annonces } = site;
  const photos = config.photos;
  const gallery = photos.gallery;
  const days = openDaysSentence(config);
  const issue = edition(now);
  const city = config.address.city;
  const story = config.about.paragraphs.filter(Boolean);
  const { appointmentOnly, rule } = config.booking;
  const available = flashs.filter(flash => flash.available);
  // La grande image de la une : la dernière réalisation publiée, sinon le dernier flash disponible.
  const hero = photos.hero || available[0] || null;

  // Fermetures et horaires exceptionnels en tête du bandeau, comme les congés chez Cyrille.
  const tickerItems = [
    ...annonces.slice(0, 3).map(a => html`<b>${a.texte}</b>`),
    appointmentOnly ? html`<b>${appointmentOnly}</b>` : '',
    'Rendez-vous par message',
    rule.replace(/\.$/, ''),
    available.length ? `${available.length} flash${available.length > 1 ? 's' : ''} à découvrir` : '',
    days ? `Ouvert ${days}` : '',
  ].filter(Boolean);
  const prochaineFermeture = annonces.find(a => a.type === 'fermeture');

  const body = html`
<main id="contenu" class="une">
  ${ticker(tickerItems, prochaineFermeture && prochaineFermeture.du <= addDaysISO(now.date, 15) ? 'Fermeture' : 'Au salon')}

  <header class="masthead container">
    <div class="masthead-top">
      <p class="masthead-ear" data-reveal data-delay="250">
        <strong>${city}</strong>
        <span>${capitalize(issue.date)}</span>
        <span>N°&nbsp;${issue.number}<span class="masthead-ear-more"> · édition du jour</span></span>
      </p>
      <p class="nameplate" data-reveal="lines">${splitTitle([config.name])}</p>
      <a class="masthead-ear masthead-ear--slot" href="/rendez-vous" data-reveal data-delay="350">
        <strong>Rendez-vous</strong>
        <span class="masthead-ear-slot">par message</span>
        <span class="masthead-ear-go">Écrire ${icon('arrow-right')}</span>
      </a>
    </div>
    <p class="masthead-line" data-reveal data-delay="450">
      <span>${config.tagline}</span><span>Traits fins · noir et blanc · floral · lettrage</span>${days ? html`<span>Ouvert ${days}</span>` : ''}
    </p>
    ${appointmentOnly || rule ? html`<p class="house-rule" data-reveal data-delay="550">
      ${appointmentOnly ? html`<strong>${appointmentOnly}</strong>` : ''}
      ${rule ? html`<span>${rule}</span>` : ''}
    </p>` : ''}
  </header>

  <section class="container lead ${hero ? '' : 'lead--texte'}" aria-labelledby="une-titre">
    <div class="lead-banner">
      ${kicker(`À la une · ${config.trade} à ${city}`)}
      <h1 class="headline headline--xl" id="une-titre" data-reveal="lines" data-delay="150" data-fit>${splitTitle(config.headline)}</h1>
    </div>

    ${hero ? html`<figure class="lead-photo ${ratioClass(hero)}">
      <div class="frame frame--whole" data-reveal="settle" data-delay="300">
        <div class="frame-inner">${picture(hero, { lazy: false })}</div>
      </div>
    </figure>` : ''}

    ${story.length ? html`<div class="lead-text">
      <div class="columns dropcap" data-reveal data-delay="450">
        ${story.map(text => html`<p>${text}</p>`)}
      </div>
    </div>` : ''}

    <aside class="lead-side" aria-label="En marge de la une">
      <a class="box box--ink slot-box" href="/rendez-vous" data-reveal data-delay="400">
        <span class="box-title">Prendre rendez-vous</span>
        <span class="slot-box-label">Par message</span>
        <span class="slot-box-go">Écrire un message ${icon('arrow-right')}</span>
      </a>

      <section class="box briefs-box" aria-labelledby="bref-titre" data-reveal data-delay="500">
        <h2 class="box-title" id="bref-titre">En bref</h2>
        <ul class="briefs">
          ${calendarNotices(annonces, { limit: 2 })}
          ${days ? html`<li><strong>Ouverture.</strong> ${capitalize(days)}.</li>` : ''}
          ${appointmentOnly ? html`<li><strong>${appointmentOnly}.</strong> ${rule}</li>` : ''}
          <li><strong>Rendez-vous.</strong> ${appointmentSentence()}.</li>
        </ul>
        ${stamp(`Sur rendez-vous · ${config.name} · `, { id: 'tampon-une', className: 'briefs-stamp', attrs: 'data-reveal="stamp" data-delay="1000"' })}
      </section>
    </aside>

    <nav class="lead-index" aria-labelledby="sommaire-titre" data-reveal>
      <h2 class="lead-index-title" id="sommaire-titre">Dans ce numéro</h2>
      <ol class="index-list" data-stagger>
        ${PAGES.slice(1).map(page => html`<li><a href="${page.path}">
          <span class="index-page">Page ${page.number}</span>
          <span class="index-name">${page.label}</span>
        </a></li>`)}
      </ol>
    </nav>
  </section>

  ${config.specialties.length ? html`<section class="container section" aria-labelledby="carte-titre">
    ${sectionBar('carte-titre', 'La carte', pageOf('/prestations'))}
    ${specialtiesTable(config.specialties, 'Les spécialités du salon')}
    ${flashs.length ? html`<p class="section-foot" data-reveal>${button('Voir les flashs', '/prestations#flashs', { variant: 'btn--outline' })}</p>` : ''}
  </section>` : ''}

  ${gallery.length ? html`<section class="hgallery" aria-labelledby="images-titre" data-scrub="pin" data-hgallery>
    <div class="hgallery-sticky">
      <div class="container">
        ${sectionBar('images-titre', 'En images', pageOf('/galerie'))}
      </div>
      <div class="hgallery-viewport" data-hgallery-viewport>
        <ul class="hgallery-track" data-hgallery-track>
          ${gallery.slice(0, 7).map((photo, i) => html`<li class="hgallery-item hgallery-item--${i % 3} ${ratioClass(photo)}">
            <figure class="frame frame--whole" data-reveal="clip">
              <div class="frame-inner">${picture(photo)}</div>
            </figure>
          </li>`)}
          <li class="hgallery-item hgallery-item--end">
            ${stamp('Page 3 · En images · Page 3 · ', { id: 'tampon-images', href: '/galerie', label: 'Voir toute la galerie, page 3', className: 'stamp--cta', attrs: 'data-magnetic' })}
          </li>
        </ul>
      </div>
    </div>
  </section>` : ''}

  <section class="container section" aria-labelledby="annonces-titre">
    ${sectionBar('annonces-titre', 'Prendre rendez-vous', pageOf('/rendez-vous'))}
    <div class="annonces annonces--seule">
      ${appointmentFlyer(config)}
    </div>
  </section>

  <section class="container section" aria-labelledby="pratique-titre">
    ${sectionBar('pratique-titre', 'Carnet pratique', pageOf('/nous-trouver'))}
    <div class="carnet carnet--duo">
      <div class="carnet-col" data-reveal>
        <h3 class="headline headline--s">Où ça&nbsp;?</h3>
        <address>${config.address.street}<br>${config.address.postalCode} ${city}</address>
        ${openBadge(status)}
        <p class="actions">${button('Itinéraire', config.maps.directions, { iconName: 'arrow-up-right', external: true })}</p>
      </div>
      <div class="carnet-col" data-reveal data-delay="90">
        <h3 class="headline headline--s">Quand&nbsp;?</h3>
        ${hoursTable(config, now)}
        ${annonces.length ? html`<ul class="briefs carnet-annonces">${calendarNotices(annonces)}</ul>` : ''}
      </div>
    </div>
  </section>
</main>`;

  return layout(site, {
    description: config.description,
    body,
    bodyClass: 'page-une',
    styles: ['/css/pages.css'],
    preload: hero,
  });
}

/**
 * L'affichette de la prise de rendez-vous : une seule phrase, toujours la même, et de quoi écrire.
 * (Chez Cyrille, cette affichette porte les créneaux à détacher ; ici, tout passe par message.)
 */
function appointmentFlyer(config) {
  return html`<div class="flyer flyer--message" data-reveal>
    <p class="flyer-kicker">Rendez-vous</p>
    <p class="flyer-title">Par <span>message</span></p>
    <p class="flyer-text flyer-phrase">${appointmentSentence()}.</p>
    ${houseRules(config)}
    <p class="actions">${messageButton('Écrire un message')}</p>
  </div>`;
}

/** Un flash, en petite annonce : le dessin, son nom, son prix indicatif, et de quoi le demander. */
function flashCard(flash) {
  return html`<li class="flash-card ${flash.available ? '' : 'is-taken'}" data-reveal>
    <button type="button" class="flash-frame frame" data-zoom="${flash.src}" data-caption="${flash.alt}" aria-label="Agrandir le flash${flash.title ? ` : ${flash.title}` : ''}">
      ${picture(flash)}
      ${flash.available ? '' : html`<span class="flash-taken">Déjà tatoué</span>`}
    </button>
    <div class="flash-foot">
      ${flash.title ? html`<h3 class="flash-name">${flash.title}</h3>` : ''}
      ${flash.price ? html`<p class="flash-price">dès <b>${euros(flash.price)}</b></p>` : ''}
      ${flash.available
        ? messageButton('Demander ce flash', { variant: 'btn--small', flash: flash.id })
        : html`<p class="flash-price">Plus disponible</p>`}
    </div>
  </li>`;
}

module.exports = { home, flashCard, appointmentFlyer };
