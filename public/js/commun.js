'use strict';
/* Outils partagés entre la messagerie du site et l'espace salon. */

const Sha = (() => {
  async function api(methode, url, corps) {
    const options = { method: methode, headers: {}, credentials: 'same-origin' };
    if (corps !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(corps);
    }
    let rep;
    try {
      rep = await fetch(url, options);
    } catch {
      throw Object.assign(new Error('Connexion impossible. Vérifiez votre réseau.'), { status: 0 });
    }
    const donnees = await rep.json().catch(() => ({}));
    if (!rep.ok) throw Object.assign(new Error(donnees.erreur || 'Une erreur est survenue.'), { status: rep.status });
    return donnees;
  }

  /** el('p', {class: 'x', onclick: fn}, 'texte', autreNoeud) — le texte est toujours inséré comme texte, jamais comme HTML. */
  function el(tag, attrs, ...enfants) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
    for (const e of enfants.flat()) if (e != null && e !== false) n.append(e.nodeType ? e : String(e));
    return n;
  }

  /** Une icône de la planche du site (les mêmes noms que dans src/views/icons.js). */
  function icone(nom) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + nom);
    svg.append(use);
    return svg;
  }

  /** Un bouton du journal : le libellé « roule » au survol, comme sur le reste du site. */
  function bouton(libelle, attrs = {}, nomIcone = '') {
    const { class: classe = '', ...reste } = attrs;
    return el('button', { type: 'button', class: ('btn ' + classe).trim(), ...reste },
      el('span', { 'data-text': libelle }, libelle), nomIcone ? icone(nomIcone) : null);
  }

  const moisJours = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const jourCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

  /** « 2026-11-20T14:00 » (heure du salon) → « Vendredi 20 novembre à 14 h 00 » */
  function creneau(debut) {
    const [d, h] = debut.split('T');
    const [a, m, j] = d.split('-').map(Number);
    const jour = moisJours.format(new Date(a, m - 1, j));
    return `${jour.charAt(0).toUpperCase() + jour.slice(1)} à ${h.replace(':', ' h ')}`;
  }

  function quand(ts) {
    const d = new Date(ts);
    const auj = new Date();
    return d.toDateString() === auj.toDateString() ? heure.format(d) : `${jourCourt.format(d)} · ${heure.format(d)}`;
  }

  const duree = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ' ' + String(min % 60).padStart(2, '0') : ''}`);

  const ETAPES = {
    discussion: 'En discussion',
    devis: 'Devis à valider',
    devis_accepte: 'Créneau en préparation',
    creneau: 'Acompte à régler',
    acompte_declare: 'Acompte en vérification',
    confirme: 'Rendez-vous confirmé',
    annule: 'Clôturée',
  };

  /**
   * Redimensionne une photo dans le navigateur avant l'envoi : plus légère, et sans les
   * informations cachées de l'appareil (date, lieu). Renvoie aussi ses dimensions.
   */
  async function preparerImageDetail(fichier, max = 1600) {
    if (!/^image\//.test(fichier.type)) throw new Error('Choisissez une image (photo JPEG, PNG ou WebP).');
    if (fichier.size > 25 * 1024 * 1024) throw new Error('Image trop lourde (25 Mo maximum).');
    const bmp = await createImageBitmap(fichier).catch(() => {
      throw new Error('Cette image ne peut pas être lue. Essayez en JPEG.');
    });
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * r);
    c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return { url: exporter(c), largeur: c.width, hauteur: c.height };
  }
  const preparerImage = async (fichier, max) => (await preparerImageDetail(fichier, max)).url;

  /** Le contenu d'un canevas en image légère (WebP, ou JPEG si le navigateur ne sait pas). */
  function exporter(canevas, qualite = 0.86) {
    const url = canevas.toDataURL('image/webp', qualite);
    return url.startsWith('data:image/webp') ? url : canevas.toDataURL('image/jpeg', qualite);
  }

  /* ---------- Visionneuse : une image en grand ---------- */
  function visionneuse(src, alt) {
    const v = document.getElementById('visionneuse');
    if (!v) return window.open(src, '_blank', 'noopener');
    const img = v.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    v.dataset.retour = '1';
    v.retour = document.activeElement;
    v.hidden = false;
    v.querySelector('button').focus();
  }
  function fermerVisionneuse() {
    const v = document.getElementById('visionneuse');
    if (!v || v.hidden) return false;
    v.hidden = true;
    if (v.retour && v.retour.focus) v.retour.focus();
    return true;
  }
  document.addEventListener('click', (e) => {
    const v = document.getElementById('visionneuse');
    if (v && !v.hidden && (e.target === v || e.target.closest('[data-fermer-visionneuse]'))) return fermerVisionneuse();
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) visionneuse(zoom.dataset.zoom, zoom.dataset.caption);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fermerVisionneuse()) e.stopPropagation();
  }, true);

  /* ---------- Avis : un message bref en bas de l'écran (à la place des fenêtres d'alerte) ---------- */
  function avis(message, type = 'erreur') {
    let zone = document.getElementById('avis');
    if (!zone) {
      zone = el('div', { id: 'avis', class: 'avis', role: type === 'erreur' ? 'alert' : 'status', 'aria-live': 'assertive' });
      document.body.append(zone);
    }
    const n = el('p', { class: 'avis-item avis-' + type }, message);
    zone.append(n);
    setTimeout(() => n.classList.add('part'), 5000);
    setTimeout(() => n.remove(), 5600);
  }

  /* ---------- L'application : installation et notifications ---------- */

  const demo = Boolean(document.documentElement.dataset.demo);
  // Le dossier du site (« / », ou « /sha-tattoo/ » pour la démonstration).
  const racine = new URL((document.querySelector('link[rel="manifest"]') || { href: '/' }).href, location.href).href.replace(/[^/]*$/, '');
  const installee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Le service worker : il reçoit les notifications (public/sw.js). Pas dans la démonstration.
  const travailleur = !demo && 'serviceWorker' in navigator
    ? navigator.serviceWorker.register(racine + 'sw.js', { scope: racine }).catch(() => null)
    : Promise.resolve(null);

  // La pastille de l'icône (messages non lus) s'efface quand on ouvre l'application.
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});

  // Chrome et Android proposent l'installation par un événement qu'on garde pour le bouton.
  let invitation = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    invitation = e;
    document.dispatchEvent(new Event('sha:installation'));
  });
  window.addEventListener('appinstalled', () => {
    invitation = null;
    document.dispatchEvent(new Event('sha:installation'));
  });

  const application = {
    installee,
    iphone,
    /** L'installation peut-elle être proposée sur cet appareil ? */
    installable: () => !demo && !installee() && (Boolean(invitation) || iphone()),
    /** Installe (Chrome, Android, Edge) ou explique comment faire (iPhone, iPad). */
    async installer() {
      if (invitation) {
        invitation.prompt();
        const { outcome } = await invitation.userChoice;
        invitation = null;
        document.dispatchEvent(new Event('sha:installation'));
        return outcome === 'accepted';
      }
      avis('Sur iPhone : touchez Partager (le carré avec une flèche), puis « Sur l’écran d’accueil ».', 'info');
      return false;
    },

    /** Les notifications sont-elles possibles ici ? (Sur iPhone, seulement une fois l'application installée.) */
    notificationsPossibles: () => !demo && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    /** « actives », « refusees » (bloquées dans le navigateur), « inactives » ou « impossibles ». */
    async etatNotifications() {
      if (!application.notificationsPossibles()) return 'impossibles';
      if (Notification.permission === 'denied') return 'refusees';
      const reg = await travailleur;
      const abo = reg && (await reg.pushManager.getSubscription().catch(() => null));
      return abo && Notification.permission === 'granted' ? 'actives' : 'inactives';
    },
    /** Demande l'accord, abonne l'appareil et l'enregistre auprès du site (chemin : /api/… ). */
    async activerNotifications(chemin) {
      if (!application.notificationsPossibles()) {
        throw new Error(iphone() && !installee()
          ? 'Sur iPhone, installez d’abord l’application (Partager, puis « Sur l’écran d’accueil »), puis ouvrez-la.'
          : 'Ce navigateur ne permet pas les notifications.');
      }
      const accord = await Notification.requestPermission();
      if (accord !== 'granted') throw new Error('Notifications refusées. Vous pouvez les autoriser dans les réglages du navigateur.');
      const reg = (await travailleur) || (await navigator.serviceWorker.ready);
      const { cle } = await api('GET', '/api/notifications/cle');
      const octets = Uint8Array.from(atob(cle.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      let abo = await reg.pushManager.getSubscription();
      if (abo) {
        // Un abonnement fait avec une autre clé (ancien site) est remplacé.
        const actuelle = abo.options && abo.options.applicationServerKey;
        if (actuelle && btoa(String.fromCharCode(...new Uint8Array(actuelle))) !== btoa(String.fromCharCode(...octets))) {
          await abo.unsubscribe();
          abo = null;
        }
      }
      if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octets });
      await api('POST', chemin, abo.toJSON());
      return true;
    },
    async desactiverNotifications(chemin) {
      const reg = await travailleur;
      const abo = reg && (await reg.pushManager.getSubscription());
      if (!abo) return;
      await api('DELETE', chemin, { endpoint: abo.endpoint }).catch(() => {});
      await abo.unsubscribe();
    },
  };

  // L'agenda ([data-agenda]) : toucher un jour l'affiche en détail sous le calendrier ; s'il est
  // libre, le bouton « Demander ce jour » ouvre la messagerie avec ce jour.
  document.addEventListener('click', (e) => {
    const jour = e.target.closest('[data-agenda-jour]');
    if (!jour) return;
    const agenda = jour.closest('[data-agenda]');
    for (const autre of agenda.querySelectorAll('[data-agenda-jour][aria-pressed="true"]')) autre.setAttribute('aria-pressed', 'false');
    jour.setAttribute('aria-pressed', 'true');
    const nom = jour.dataset.jour;
    agenda.querySelector('[data-agenda-titre]').textContent = nom.charAt(0).toUpperCase() + nom.slice(1);
    agenda.querySelector('[data-agenda-texte]').textContent = jour.dataset.resume;
    const demande = agenda.querySelector('[data-agenda-demande]');
    demande.dataset.date = jour.dataset.date;
    demande.dataset.jour = nom;
    demande.hidden = jour.dataset.etat !== 'libre';
  });

  // Les boutons « Installer l'application » de la page ([data-installer]) : visibles seulement
  // quand l'installation est possible sur cet appareil.
  const boutonsInstaller = () => {
    for (const b of document.querySelectorAll('[data-installer]')) b.hidden = !application.installable();
  };
  document.addEventListener('sha:installation', boutonsInstaller);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-installer]')) application.installer();
  });
  boutonsInstaller();

  return { api, el, icone, bouton, creneau, quand, duree, ETAPES, preparerImage, preparerImageDetail, exporter, visionneuse, avis, application };
})();
