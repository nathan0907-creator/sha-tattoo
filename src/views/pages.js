'use strict';

// Les pages intérieures, reprises de la gazette de L'atelier de Cyrille : même haut de page,
// mêmes encadrés. « La carte » des tarifs devient « Les flashs » ; la réservation en ligne
// laisse la place à la messagerie (devis, puis rendez-vous).

const { html, raw } = require('./html');
const { icon } = require('./icons');
const { layout } = require('./layout');
const { appointmentFlyer } = require('./home');
const {
  PAGES, folio, picture, button, buttonLabel, splitTitle, kicker, stamp, telHref, ratioClass, euros, messageButton,
  houseRules, appointmentSentence, hoursTable, openBadge, specialtiesTable, calendarNotices, availabilityBox,
  socialLinks, paypalButton, videoSection, eventsFor, eventsSteps, eventsPrice,
} = require('./components');

/** L'encadré « À noter » : fermetures et horaires exceptionnels à venir. */
const noticesBox = annonces => (annonces.length ? html`<section class="box" aria-labelledby="a-noter-titre" data-reveal>
  <h2 class="box-title" id="a-noter-titre">À noter</h2>
  <ul class="briefs">${calendarNotices(annonces, { limit: 8 })}</ul>
</section>` : '');

const pageOf = path => PAGES.find(page => page.path === path);

/** Haut de page intérieure : titre courant, surtitre, grand titre, chapeau. */
function pageHead(site, { path, kick, title, deck, extra = '' }) {
  const page = pageOf(path);
  return html`<header class="page-head container">
    ${page ? folio(site, page) : ''}
    ${kicker(kick)}
    <h1 class="headline headline--xl" data-reveal="lines">${splitTitle(title)}</h1>
    ${deck ? html`<p class="deck" data-reveal>${deck}</p>` : ''}
    ${extra}
  </header>`;
}

/** Rubrique encore vide : rien n'est inventé, on annonce simplement la suite. */
const comingSoon = text => html`<p class="a-paraitre" data-reveal><strong>À paraître.</strong> ${text}</p>`;

const FLASH_INTRO = "Des projets dessinés de A à Z au salon. Ils ne sont pas faits à la demande, mais peuvent être modifiés et placés sur la zone de votre choix. Chaque pièce n'est réalisée qu'une seule fois.";

/** La visionneuse plein écran (galerie et planches de flashs) : flèches, clavier, balayage. */
const lightbox = ({ what = 'photo', action = false } = {}) => html`<dialog class="lightbox" data-lightbox aria-label="${what === 'photo' ? 'Photo agrandie' : 'Planche agrandie'}">
  <button type="button" class="icon-btn lightbox-close" data-lightbox-close aria-label="Fermer">${icon('close')}</button>
  <button type="button" class="icon-btn lightbox-nav lightbox-prev" data-lightbox-prev aria-label="${what === 'photo' ? 'Photo précédente' : 'Planche précédente'}">${icon('chevron-left')}</button>
  <figure class="lightbox-figure">
    <img data-lightbox-image alt="">
    <figcaption><span data-lightbox-caption></span><span class="lightbox-count" data-lightbox-count></span></figcaption>
    ${action ? html`<p class="lightbox-action"><button type="button" class="btn btn--accent btn--small" data-ouvrir-chat data-lightbox-action hidden>${buttonLabel('Demander ce flash')}${icon('arrow-right')}</button></p>` : ''}
  </figure>
  <button type="button" class="icon-btn lightbox-nav lightbox-next" data-lightbox-next aria-label="${what === 'photo' ? 'Photo suivante' : 'Planche suivante'}">${icon('chevron-right')}</button>
</dialog>`;

// ── Page 3 — Les flashs : les planches ─────────────────────────────────────

/** Une planche : l'image (qui s'agrandit), son nom, son prix indicatif, et de quoi la demander. */
function flashBoard(flash, i) {
  const caption = flash.title || flash.alt;
  return html`<li class="planche ${flash.available === false ? 'is-taken' : ''} ${flash.exemple ? 'planche--exemple' : ''}" data-reveal data-delay="${(i % 3) * 70}">
    <button type="button" class="planche-image" data-full="${flash.src}" data-caption="${caption}" ${flash.exemple || flash.available === false ? '' : raw(`data-flash="${flash.id}"`)} data-cursor="Voir" aria-label="Agrandir : ${caption}">
      ${picture(flash)}
      ${flash.available === false ? html`<span class="flash-taken">Déjà tatoué</span>` : ''}
    </button>
    ${flash.exemple ? '' : html`<div class="planche-pied">
      <div>
        ${flash.title ? html`<h2 class="planche-nom">${flash.title}</h2>` : ''}
        ${flash.price ? html`<p class="planche-prix">dès <b>${euros(flash.price)}</b></p>` : ''}
      </div>
      ${flash.available === false
        ? html`<p class="planche-prix">Plus disponible</p>`
        : messageButton('Demander', { variant: 'btn--small', flash: flash.id })}
    </div>`}
  </li>`;
}

function flashsPage(site) {
  const { config, flashs } = site;
  const planches = flashs.length ? flashs : config.flashsExemple;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/flashs',
    kick: 'Planches de flashs',
    title: ['Les', '_flashs_'],
    deck: FLASH_INTRO,
  })}
  <div class="container">
    <p class="notice-line" data-reveal>${icon('info')}<span>Touchez une planche pour la voir en grand, puis passez à la suivante.${flashs.length ? ' Un motif vous plaît ? Demandez-le : il ne sera tatoué qu’une fois.' : ''}</span></p>
    <ul class="planches" data-gallery>${planches.map((flash, i) => flashBoard(flash, i))}</ul>
  </div>
  ${lightbox({ what: 'planche', action: true })}
  <aside class="container help-band" data-reveal>
    <p><strong>Une idée à vous&nbsp;?</strong> <button type="button" class="link" data-ouvrir-chat>Demandez un devis</button>.</p>
  </aside>
</main>`;

  return layout(site, {
    title: 'Flashs de tatouage',
    crumb: 'Les flashs',
    description: `Les planches de flashs de ${config.name}, ${config.trade.toLowerCase()} à ${config.address.city} : des motifs dessinés au salon, chacun tatoué une seule fois.`,
    body,
    styles: ['/css/pages.css'],
    scripts: ['/js/gallery.js'],
  });
}

// ── Page 5 — Événements : l'animation tatouage ─────────────────────────────

function eventsPage(site) {
  const { config } = site;
  const ev = config.evenements;
  const body = html`
<main id="contenu" class="page page-evenements">
  ${pageHead(site, {
    path: '/evenements',
    kick: 'Animations tatouage',
    title: ['Le tatouage', "_s'invite à la fête_"],
    deck: 'Une animation tatouage le jour de votre événement privé : une expérience originale et personnalisée, que vos invités gardent pour toujours.',
    extra: html`<p class="actions" data-reveal>${messageButton('Demander un devis', { evenement: true })}</p>`,
  })}

  <section class="container section" aria-labelledby="pour-titre">
    <h2 class="menu-group-title" id="pour-titre" data-reveal>Pour quels événements</h2>
    ${eventsFor(ev)}
  </section>

  <section class="ev-bande" aria-labelledby="deroule-titre">
    <div class="container ev-bande-grille">
      <div>
        <p class="kicker" data-reveal>Le jour J</p>
        <h2 class="headline headline--l" id="deroule-titre" data-reveal="lines">${splitTitle(['Comment', '_ça se passe_'])}</h2>
      </div>
      ${eventsSteps(ev)}
    </div>
  </section>

  <section class="container section" aria-labelledby="tarif-titre">
    <h2 class="menu-group-title" id="tarif-titre" data-reveal>Les tarifs</h2>
    <div class="ev-tarif">
      ${eventsPrice(ev, { cta: false })}
      <div class="ev-cta" data-reveal data-delay="200">
        ${messageButton('Demander un devis', { evenement: true })}
        <p class="field-hint">Indiquez le type d’événement, la date et le lieu&nbsp;: le devis arrive dans vos messages.</p>
      </div>
    </div>
  </section>
</main>`;

  return layout(site, {
    title: 'Animation tatouage : mariages, anniversaires',
    crumb: 'Événements',
    description: `Animation tatouage par ${config.name} pour les mariages, anniversaires et autres événements privés. ${ev.tarif}.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Page 2 — La carte : spécialités et flashs ──────────────────────────────

function carte(site) {
  const { config, flashs } = site;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/prestations',
    kick: 'Spécialités et flashs',
    title: ['La carte,', '_ligne par ligne_'],
    extra: html`<p class="notice-line" data-reveal>${icon('info')}<span>Chaque projet fait l'objet d'un devis : le prix dépend du motif, de sa taille et de son emplacement.</span></p>`,
  })}
  <div class="container menu">
    <section class="menu-group" aria-labelledby="specialites-titre">
      <h2 class="menu-group-title" id="specialites-titre" data-reveal>Les spécialités</h2>
      ${specialtiesTable(config.specialties, 'Les spécialités du salon')}
    </section>
    <section class="menu-group" id="flashs" aria-labelledby="flashs-titre">
      <h2 class="menu-group-title" id="flashs-titre" data-reveal>Les flashs</h2>
      <p class="flash-intro" data-reveal>${FLASH_INTRO}</p>
      <p class="actions" data-reveal>${button(flashs.length ? `Voir les ${flashs.length} planche${flashs.length > 1 ? 's' : ''}` : 'Voir les planches', '/flashs', { variant: 'btn--outline' })}</p>
    </section>
    <section class="menu-group" aria-labelledby="evenements-carte-titre">
      <h2 class="menu-group-title" id="evenements-carte-titre" data-reveal>Animations tatouage</h2>
      <p class="flash-intro" data-reveal>${config.evenements.pour.join(', ')}. ${config.evenements.tarif}.</p>
      <p class="actions" data-reveal>${button('Découvrir', '/evenements', { variant: 'btn--outline' })}</p>
    </section>
  </div>
  <div class="container">${houseRules(config)}</div>
  <aside class="container help-band" data-reveal>
    <p><strong>Une question&nbsp;?</strong> <button type="button" class="link" data-ouvrir-chat>Écrivez un message</button>.</p>
  </aside>
</main>`;

  return layout(site, {
    title: `Tatouage à ${config.address.city} : spécialités et flashs`,
    crumb: 'La carte',
    description: `La carte de ${config.name}, ${config.trade.toLowerCase()} à ${config.address.city} : traits fins, noir et blanc, floraux, lettrages et flashs. Sur devis.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Page 3 — En images ─────────────────────────────────────────────────────

function gallery(site) {
  const { config } = site;
  const photos = config.photos.gallery;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/galerie',
    kick: 'Reportage',
    title: ['Sorti', '_du salon_'],
  })}
  <div class="container">
    ${photos.length ? html`<ul class="masonry" data-gallery>
      ${photos.map((photo, i) => html`<li class="masonry-item ${ratioClass(photo)}" data-reveal>
        <button type="button" class="masonry-button frame" data-index="${i}" data-full="${photo.src}" data-caption="${photo.alt}" data-cursor="Voir" aria-label="Agrandir : ${photo.alt}">
          ${picture(photo, { className: photo.planche ? 'is-planche' : '' })}
        </button>
      </li>`)}
    </ul>` : comingSoon('Les premières réalisations seront publiées ici.')}
  </div>
  ${videoSection(site, { id: 'galerie-videos' })}
  ${lightbox()}
</main>`;

  return layout(site, {
    title: 'Tatouages en photos',
    crumb: 'En images',
    description: `Les réalisations de ${config.name}, ${config.trade.toLowerCase()} à ${config.address.city}, en photos et en vidéos.`,
    body,
    styles: ['/css/pages.css'],
    scripts: [...(photos.length ? ['/js/gallery.js'] : []), ...(site.videos.length ? ['/js/videos.js'] : [])],
  });
}

// ── Page 4 — Prendre rendez-vous ───────────────────────────────────────────
// Pas de réservation en ligne : une seule phrase, toujours la même, et la messagerie.

function appointment(site) {
  const { config, status, now, annonces } = site;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/rendez-vous',
    kick: 'Rendez-vous',
    title: ['Prendre', '_rendez-vous_'],
  })}
  <div class="container annonces rdv-page">
    ${appointmentFlyer(config)}
    ${availabilityBox(site.disponibilites)}

    <div class="box how-box" data-reveal data-delay="120">
      <h2 class="box-title">Le salon</h2>
      ${openBadge(status)}
      <dl class="info-list">
        <div>
          <dt>Adresse</dt>
          <dd>${config.address.street}<br>${config.address.postalCode} ${config.address.city}</dd>
        </div>
      </dl>
      ${hoursTable(config, now)}
      ${annonces.length ? html`<ul class="briefs">${calendarNotices(annonces)}</ul>` : ''}
      ${button('Itinéraire', config.maps.directions, { variant: 'btn--outline', iconName: 'arrow-up-right', external: true })}
    </div>

    <section class="box acompte-box" aria-labelledby="acompte-titre" data-reveal data-delay="160">
      <h2 class="box-title" id="acompte-titre">L'acompte</h2>
      <p>${config.booking.rule} Il se règle après le devis${config.contact.paypal ? ', par PayPal,' : ''} par Wero ou au salon.</p>
      ${config.contact.paypal ? html`${paypalButton(config.contact)}
      <p class="field-hint">Indiquez la référence de votre devis (elle est dans vos messages). Le lien exact, avec le bon montant, vous est aussi donné avec le devis.</p>` : ''}
    </section>
  </div>
</main>`;

  return layout(site, {
    title: 'Prendre rendez-vous',
    crumb: 'Prendre rendez-vous',
    description: `Prendre rendez-vous chez ${config.name}, à ${config.address.city} : les rendez-vous se prennent par message.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Page 5 — Pratique : nous trouver ───────────────────────────────────────

function find(site) {
  const { config, status, now, annonces } = site;
  const { address, contact } = config;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/nous-trouver',
    kick: 'Carnet pratique',
    title: ['On est', '_juste là_'],
  })}
  <div class="container find-page">
    <div class="box find-card" data-reveal>
      <h2 class="box-title">L'adresse</h2>
      ${openBadge(status)}
      <dl class="info-list">
        <div>
          <dt>Adresse</dt>
          <dd>${address.street}<br>${address.postalCode} ${address.city}</dd>
        </div>
        ${contact.email ? html`<div>
          <dt>E-mail</dt>
          <dd><a class="link" href="mailto:${contact.email}">${contact.email}</a></dd>
        </div>` : ''}
        ${contact.instagram || contact.tiktok || contact.facebook ? html`<div>
          <dt>Réseaux</dt>
          <dd>${socialLinks(contact, { withNames: true })}</dd>
        </div>` : ''}
        ${config.booking.appointmentOnly ? html`<div>
          <dt>Accueil</dt>
          <dd><strong>${config.booking.appointmentOnly}</strong></dd>
        </div>` : ''}
        <div>
          <dt>Rendez-vous</dt>
          <dd>${appointmentSentence()}.</dd>
        </div>
      </dl>
      <div class="actions">
        ${button('Itinéraire', config.maps.directions, { iconName: 'arrow-up-right', external: true })}
        ${button('Rendez-vous', '/rendez-vous', { variant: 'btn--outline' })}
      </div>
    </div>

    <div class="map" data-map data-src="${config.maps.embed}" data-title="Plan d'accès : ${address.full}" data-reveal>
      <div class="map-facade">
        <div class="map-art" aria-hidden="true">
          <span class="map-road map-road--1"></span><span class="map-road map-road--2"></span>
          <span class="map-road map-road--3"></span><span class="map-road map-road--4"></span>
          <span class="map-block map-block--1"></span><span class="map-block map-block--2"></span><span class="map-block map-block--3"></span>
          <span class="map-pin">${icon('pin')}</span>
        </div>
        <div class="map-facade-copy">
          <p class="map-address">${address.full}</p>
          <button type="button" class="btn" data-map-load>${buttonLabel('Afficher le plan')}${icon('pin')}</button>
          <p class="map-note">Le plan est fourni par Google Maps. En l'affichant, vous acceptez que Google dépose ses cookies.</p>
          <a class="link" href="${config.maps.view}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>
        </div>
      </div>
    </div>
  </div>

  <div class="container find-extra">
    <section class="box" aria-labelledby="horaires-titre" data-reveal>
      <h2 class="box-title" id="horaires-titre">Les horaires</h2>
      ${hoursTable(config, now)}
    </section>
    ${noticesBox(annonces)}
  </div>
</main>`;

  return layout(site, {
    title: "Adresse, horaires et plan d'accès",
    crumb: 'Adresse et horaires',
    description: `${config.name}, ${address.full}. Horaires d'ouverture, plan d'accès, itinéraire et téléphone. ${config.booking.appointmentOnly || 'Sur rendez-vous'}.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Pages légales ──────────────────────────────────────────────────────────

const LEGAL_PAGES = [
  { path: '/mentions-legales', label: 'Mentions légales' },
  { path: '/confidentialite', label: 'Confidentialité et cookies' },
  { path: '/conditions', label: "Conditions d'utilisation" },
];

const legalNav = current => html`<nav class="container legal-nav" aria-label="Pages légales">
  <ul>${LEGAL_PAGES.map(page => html`<li><a href="${page.path}" ${page.path === current ? html`aria-current="page"` : ''}>${page.label}</a></li>`)}</ul>
</nav>`;

/** Les moyens de joindre le salon, selon ce qui est renseigné ; à défaut, la messagerie du site. */
function reachLinks(contact) {
  const links = [
    contact.email ? html`<a class="link" href="mailto:${contact.email}">${contact.email}</a>` : '',
    contact.phone ? html`<a class="link" href="${telHref(contact.phone)}">${contact.phone}</a>` : '',
  ].filter(Boolean);
  return links.length ? links.map((link, i) => html`${i ? ' · ' : ''}${link}`) : 'la messagerie du site';
}

/** Une information légale pas encore fournie : on le dit, on n'invente rien. */
const orPending = value => value || html`<em>à compléter</em>`;

function legal(site) {
  const { config } = site;
  const { legal: info, contact, address } = config;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, { path: '', kick: "L'ours", title: ['Mentions', '_légales_'] })}
  ${legalNav('/mentions-legales')}
  <div class="container prose">
    <section>
      <h2>Éditeur du site</h2>
      <p>${info.company}${info.status ? `, ${info.status}` : ''}<br>
        ${address.full}<br>
        SIRET&nbsp;: ${orPending(info.siret)}<br>
        Responsable de la publication&nbsp;: ${orPending(info.publisher)}<br>
        Contact&nbsp;: ${reachLinks(contact)}</p>
    </section>
    <section>
      <h2>Hébergement</h2>
      <p>${orPending(info.host)}</p>
    </section>
    <section>
      <h2>Crédits</h2>
      <p>Textes, dessins et photographies&nbsp;: ${info.company}, sauf mention contraire. Toute reproduction sans accord est interdite, y compris celle des flashs.</p>
    </section>
    <section>
      <h2>Vos données et l'usage du site</h2>
      <p>Ce que le salon fait de vos informations est expliqué dans la page <a class="link" href="/confidentialite">Confidentialité et cookies</a>. Les règles de la prise de rendez-vous sont dans les <a class="link" href="/conditions">Conditions d'utilisation</a>.</p>
    </section>
  </div>
</main>`;

  return layout(site, { title: 'Mentions légales', crumb: 'Mentions légales', description: `Mentions légales du site de ${config.name}, ${config.trade.toLowerCase()} à ${address.city} : éditeur, hébergeur, crédits.`, body, styles: ['/css/pages.css'] });
}

function privacy(site) {
  const { config } = site;
  const { legal: info, contact, address } = config;
  const reach = reachLinks(contact);
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, { path: '', kick: 'Vos données', title: ['Confidentialité', '_et cookies_'] })}
  ${legalNav('/confidentialite')}
  <div class="container prose">
    <section>
      <h2>En deux mots</h2>
      <p>Le salon ne garde que ce qu'il faut pour préparer votre devis et vous recevoir. Rien n'est vendu ni transmis, aucune publicité, aucun traceur.</p>
    </section>
    <section>
      <h2>Qui est responsable</h2>
      <p>${info.company}, ${address.full}. Pour toute question sur vos données&nbsp;: ${reach}.</p>
    </section>
    <section id="donnees">
      <h2>Ce qui est enregistré, et pourquoi</h2>
      <h3>Votre compte</h3>
      <p>Pour écrire au salon, vous créez un compte&nbsp;: votre numéro de téléphone, votre nom, votre prénom, votre date de naissance, un mot de passe (enregistré sous forme chiffrée, que le salon ne peut pas lire) et, si vous le souhaitez, une adresse e-mail. La date de naissance sert à vérifier l'âge requis pour être tatoué. Ces informations servent uniquement à préparer votre devis et votre rendez-vous (mesures prises à votre demande, article 6.1.b du RGPD).</p>
      <h3>Vos messages et vos photos</h3>
      <p>Les messages que vous échangez avec le salon, votre devis, votre rendez-vous et le suivi de l'acompte sont gardés avec votre demande. Les photos que vous envoyez (l'emplacement du tatouage, votre image de référence) ne sont vues que par vous et par la tatoueuse&nbsp;; elles ne partent qu'au moment où vous envoyez votre demande.</p>
      <h3>L'acompte</h3>
      <p>Le paiement de l'acompte se fait chez PayPal, par Wero ou au salon&nbsp;: le site ne reçoit ni ne conserve aucune donnée bancaire.</p>
      <h3>Quand vous visitez le site</h3>
      <p>Le site ne mesure pas son audience et ne vous suit pas d'une page à l'autre.</p>
    </section>
    <section>
      <h2>Qui y a accès</h2>
      <p>La tatoueuse, dans son espace protégé par mot de passe, et l'hébergeur du site, qui stocke les données sans les utiliser.</p>
    </section>
    <section>
      <h2>Combien de temps</h2>
      <p>Votre compte et vos demandes sont gardés tant que vous êtes cliente ou client du salon. Vous pouvez demander leur suppression à tout moment.</p>
    </section>
    <section>
      <h2>Vos droits</h2>
      <p>Vous pouvez à tout moment demander à consulter, corriger ou faire effacer vos informations, ou vous opposer à leur utilisation, en contactant le salon (${reach}). Si la réponse ne vous satisfait pas, vous pouvez saisir la CNIL, 3 place de Fontenoy, 75007 Paris (cnil.fr).</p>
    </section>
    <section id="cookies">
      <h2>Cookies</h2>
      <p>Ce site ne dépose aucun cookie publicitaire ni de mesure d'audience. Les seuls cookies qu'il utilise gardent votre compte connecté (et la tatoueuse connectée à son espace)&nbsp;: ils sont nécessaires à la messagerie.</p>
      <p>Le plan de la page Pratique est fourni par Google Maps, qui dépose ses propres cookies. Il ne s'affiche donc que si vous l'acceptez. Votre choix est gardé six mois dans votre navigateur et se modifie quand vous voulez&nbsp;:</p>
      <p><button type="button" class="btn btn--outline" data-cookies-open><span>Modifier mon choix</span></button></p>
      <p>Les vidéos sont lues sur le site même&nbsp;: elles ne déposent aucun cookie. Les liens vers Instagram, TikTok, Facebook et PayPal ouvrent ces sites, qui appliquent leurs propres règles.</p>
      <p>Les polices de caractères sont servies par Google Fonts, qui reçoit à cette occasion l'adresse IP de votre appareil, sans déposer de cookie.</p>
    </section>
  </div>
</main>`;

  return layout(site, {
    title: 'Confidentialité et cookies',
    crumb: 'Confidentialité et cookies',
    description: `Ce que ${config.name} fait de vos données : compte, messages, photos, vos droits (RGPD) et les cookies du site.`,
    body,
    styles: ['/css/pages.css'],
  });
}

function terms(site) {
  const { config } = site;
  const { booking: rules } = config;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, { path: '', kick: 'Règles du jeu', title: ['Conditions', "_d'utilisation_"] })}
  ${legalNav('/conditions')}
  <div class="container prose">
    <section>
      <h2>À quoi sert ce site</h2>
      <p>Ce site présente ${config.name} (flashs, photos, adresse) et permet d'écrire au salon pour demander un devis. Son usage est gratuit. L'utiliser, c'est accepter les règles ci-dessous.</p>
    </section>
    <section id="rendez-vous">
      <h2>Le devis et le rendez-vous</h2>
      <p>${rules.appointmentOnly ? html`<strong>${rules.appointmentOnly}.</strong> ` : ''}${appointmentSentence()}. Le devis est gratuit&nbsp;; il indique le prix, l'acompte et la durée prévue. Une fois le devis accepté, la tatoueuse propose un créneau.</p>
      <p>Pour écrire au salon, un compte est demandé&nbsp;: indiquez votre vrai nom et un numéro où vous joindre. Le salon peut aussi fixer lui-même un rendez-vous de suite ou de retouche&nbsp;; il apparaît alors dans vos messages.</p>
    </section>
    <section id="acompte">
      <h2>L'acompte</h2>
      <p>${rules.rule} Il se règle par PayPal, par Wero ou au salon&nbsp;; le rendez-vous est confirmé quand le salon l'a reçu. L'acompte est déduit du prix final.</p>
      ${config.depositTerms ? html`<p>${config.depositTerms}</p>` : ''}
    </section>
    <section>
      <h2>Le site</h2>
      <p>Le salon fait de son mieux pour que le site soit disponible et à jour, sans pouvoir le garantir à tout instant.</p>
      <p>Les textes, les dessins et les photographies appartiennent à ${config.legal.company}&nbsp;; ils ne peuvent pas être réutilisés sans accord.</p>
    </section>
    <section>
      <h2>Vos données, le droit applicable</h2>
      <p>Ce que le salon fait de vos informations est expliqué dans la page <a class="link" href="/confidentialite">Confidentialité et cookies</a>. Ces conditions relèvent du droit français.</p>
    </section>
  </div>
</main>`;

  return layout(site, {
    title: "Conditions d'utilisation",
    crumb: "Conditions d'utilisation",
    description: `Les règles du site de ${config.name} : devis, rendez-vous par message, acompte.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Page introuvable ───────────────────────────────────────────────────────

function notFound(site) {
  const body = html`
<main id="contenu" class="page">
  <div class="container not-found">
    ${kicker('Erratum')}
    <h1 class="headline headline--xl">Cette page n'a <em>jamais été imprimée</em></h1>
    <div class="actions">
      ${button('Revenir à la une', '/')}
      ${button('Prendre rendez-vous', '/rendez-vous', { variant: 'btn--outline' })}
    </div>
    ${stamp('Erreur 404 · Page introuvable · ', { id: 'tampon-404', className: 'not-found-stamp' })}
  </div>
</main>`;

  return layout(site, { title: 'Page introuvable', body, styles: ['/css/pages.css'], noindex: true });
}

// ── L'espace salon (« la rédaction ») ──────────────────────────────────────

function salon(site) {
  const body = html`
<main id="app" class="app"><p class="chargement" role="status"><span class="point"></span>Chargement…</p></main>
<div class="visionneuse" id="visionneuse" hidden>
  <button class="icon-btn" type="button" aria-label="Fermer l'image" data-fermer-visionneuse>${icon('close')}</button>
  <img alt="">
</div>`;
  return layout(site, { title: 'Espace salon', body, bare: true, noindex: true, bodyClass: 'espace', styles: ['/css/sha.css'], scripts: ['/js/commun.js', '/js/sha.js'] });
}

const pages = {
  '/': require('./home').home,
  '/prestations': carte,
  '/flashs': flashsPage,
  '/galerie': gallery,
  '/evenements': eventsPage,
  '/rendez-vous': appointment,
  '/nous-trouver': find,
  '/mentions-legales': legal,
  '/confidentialite': privacy,
  '/conditions': terms,
  '/salon': salon,
};

module.exports = { pages, notFound };
