'use strict';
/*
 * La messagerie du site. Les rendez-vous se prennent par message :
 *   l'assistant prépare la demande (photo de l'emplacement, image de référence, description)
 *   → messages → devis → créneau choisi par la tatoueuse → acompte → confirmé.
 * Un compte est demandé au moment d'envoyer la demande (il n'est pas annoncé ailleurs sur le site).
 */

window.ShaChat = (() => {
  const { api, el, icone, bouton, ETAPES, avis } = Sha;
  const chat = document.getElementById('chat');
  if (!chat) return { ouvrir() {}, fermer() {} };
  const fond = document.getElementById('chat-fond');
  const corps = document.getElementById('chat-corps');
  const btnRetour = document.getElementById('chat-retour');
  const titre = document.getElementById('chat-titre');
  const sous = document.getElementById('chat-sous');
  const NOM = titre.textContent;

  const etat = { moi: null, charge: false, flash: null, retour: null, minuterie: null, signature: '', declencheur: null };

  /* ---------- Ouverture / fermeture ---------- */

  async function ouvrir(opts = {}) {
    etat.declencheur = document.activeElement;
    chat.hidden = false;
    fond.hidden = false;
    document.documentElement.classList.add('chat-ouvert');
    requestAnimationFrame(() => chat.classList.add('ouvert'));
    if (opts.flash) etat.flash = await trouverFlash(opts.flash);
    if (!etat.charge || opts.flash) await charger();
    focusPremier();
  }

  function fermer() {
    arreterSuivi();
    chat.classList.remove('ouvert');
    document.documentElement.classList.remove('chat-ouvert');
    fond.hidden = true;
    setTimeout(() => { if (!chat.classList.contains('ouvert')) chat.hidden = true; }, 380);
    // À la réouverture, une conversation en cours reprend là où elle en était.
    if (etat.reprendre) etat.charge = false;
    if (etat.declencheur && etat.declencheur.focus) etat.declencheur.focus();
  }

  async function trouverFlash(fid) {
    try {
      const f = (await api('GET', '/api/galerie')).find((g) => g.id === fid && g.type === 'flash' && g.dispo);
      return f || null;
    } catch {
      return null;
    }
  }

  function focusPremier() {
    const cible = corps.querySelector('[autofocus], textarea, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=range]), button, label.btn');
    if (cible) cible.focus({ preventScroll: true });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ouvrir-chat]');
    if (!b) return;
    e.preventDefault();
    ouvrir({ flash: b.dataset.flash || '' });
  });
  document.getElementById('chat-fermer').addEventListener('click', fermer);
  fond.addEventListener('click', fermer);
  btnRetour.addEventListener('click', () => etat.retour && etat.retour());
  chat.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return fermer();
    if (e.key !== 'Tab') return;
    const f = [...chat.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]):not([type=file]), textarea:not([disabled]), select, canvas[tabindex], label.btn')].filter((n) => n.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  });

  function afficher(noeuds, { titre: t = NOM, sousTitre = 'Devis et rendez-vous', retour = null } = {}) {
    arreterSuivi();
    titre.textContent = t;
    sous.textContent = sousTitre;
    etat.retour = retour;
    etat.reprendre = false;
    btnRetour.hidden = !retour;
    corps.replaceChildren(...[noeuds].flat());
    corps.scrollTop = 0;
  }

  async function charger() {
    afficher(el('p', { class: 'chargement', role: 'status' }, el('span', { class: 'spinner' }), 'Chargement…'));
    try {
      etat.moi = await lireMoi();
    } catch (e) {
      etat.moi = null;
      return afficher(erreurBloc(e.message, charger));
    }
    etat.charge = true;
    return apresConnexion();
  }

  /**
   * Le parcours : d'abord se connecter ou créer son compte, puis la conversation avec la
   * tatoueuse s'ouvre — celle en cours s'il y en a une, sinon une nouvelle (un flash choisi
   * ouvre toujours une nouvelle conversation).
   */
  function apresConnexion() {
    if (!etat.moi) return vueCompte('inscription');
    if (etat.flash) return vueNouvelleConversation();
    const enCours = etat.moi.projets.find((p) => !['confirme', 'annule'].includes(p.etape));
    if (enCours) return ouvrirProjet(enCours.id);
    return vueNouvelleConversation();
  }

  /** Le compte ouvert et ses demandes ; null pour un simple visiteur. */
  async function lireMoi() {
    const r = await api('GET', '/api/moi');
    return r.client ? r : null;
  }

  const erreurBloc = (msg, reessayer) =>
    el('div', { class: 'chat-vide' }, el('p', { class: 'notice notice--error' }, msg), bouton('Réessayer', { class: 'btn--small', onclick: reessayer }));

  const intro = (grand, petit) => el('div', { class: 'chat-intro' }, el('p', { class: 'chat-intro-titre' }, grand), petit ? el('p', {}, petit) : null);

  /* ---------- Une nouvelle demande, avant la conversation avec la tatoueuse ---------- */

  const ENDROITS = ['Avant-bras', 'Bras', 'Épaule', 'Poignet', 'Main', 'Clavicule', 'Poitrine', 'Sous la poitrine', 'Côtes',
    'Ventre', 'Dos', 'Colonne', 'Nuque', 'Hanche', 'Cuisse', 'Mollet', 'Cheville', 'Pied', 'Derrière l’oreille'];

  /**
   * Avant d'envoyer sa demande, le client donne ce qu'il faut à la tatoueuse pour chiffrer :
   * une photo de référence (sauf pour un flash, qui en tient lieu), l'endroit du corps et la
   * taille. Un message est facultatif. L'envoi ouvre la conversation.
   */
  function vueNouvelleConversation() {
    const flash = etat.flash;
    const erreur = el('p', { class: 'field-error', role: 'alert' });
    let reference = null;

    // La photo de référence : l'appareil photo ou la galerie du téléphone, avec un aperçu.
    const apercu = el('div', { class: 'ref-apercu', hidden: true });
    const input = el('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'n-reference' });
    const choisir = el('label', { class: 'btn btn--outline btn-plein', for: 'n-reference', tabindex: '0', role: 'button' }, el('span', {}, 'Choisir une photo'), icone('image'));
    choisir.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      try {
        reference = await Sha.preparerImage(input.files[0]);
        apercu.replaceChildren(el('img', { src: reference, alt: 'Votre photo de référence' }));
        apercu.hidden = false;
        choisir.querySelector('span').textContent = 'Changer de photo';
      } catch (e) {
        avis(e.message);
        input.value = '';
      }
    });

    const listeEndroits = el('datalist', { id: 'n-endroits' }, ENDROITS.map((e) => el('option', { value: e })));
    const form = el('form', { class: 'formulaire nouvelle-demande', novalidate: true },
      flash
        ? el('div', { class: 'field' }, el('p', { class: 'field-label' }, 'Le flash choisi'),
            el('div', { class: 'ref-apercu' }, el('img', { src: flash.src, alt: flash.titre ? 'Flash « ' + flash.titre + ' »' : 'Le flash choisi' })))
        : el('div', { class: 'field' }, el('p', { class: 'field-label' }, 'Photo de référence'), apercu, choisir, input,
            el('p', { class: 'field-hint' }, 'Le motif ou le style qui vous plaît.')),
      el('div', { class: 'field' }, el('label', { for: 'n-emplacement' }, 'Endroit du corps'),
        el('input', { id: 'n-emplacement', name: 'emplacement', list: 'n-endroits', required: true, maxlength: 80, placeholder: 'Avant-bras, épaule, mollet…', autocomplete: 'off' }), listeEndroits),
      el('div', { class: 'field' }, el('label', { for: 'n-taille' }, 'Taille'),
        el('input', { id: 'n-taille', name: 'taille', required: true, maxlength: 40, placeholder: 'Environ 10 cm' })),
      el('div', { class: 'field' }, el('label', { for: 'n-texte' }, 'Message (facultatif)'),
        el('textarea', { id: 'n-texte', name: 'texte', rows: 3, maxlength: 2000, placeholder: 'Noir ou couleur, date souhaitée, une précision…' })),
      erreur,
      bouton('Envoyer ma demande', { type: 'submit', class: 'btn--accent btn-plein' }, 'send'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erreur.textContent = '';
      const d = Object.fromEntries(new FormData(form));
      if (!flash && !reference) { erreur.textContent = 'Ajoutez une photo de référence.'; choisir.focus(); return; }
      if (!d.emplacement.trim()) { erreur.textContent = 'Indiquez l’endroit du corps.'; form.emplacement.focus(); return; }
      if (!d.taille.trim()) { erreur.textContent = 'Indiquez la taille.'; form.taille.focus(); return; }
      const envoi = form.querySelector('[type=submit]');
      envoi.disabled = true;
      envoi.classList.add('occupe');
      try {
        const p = await api('POST', '/api/projets', { ...d, reference: reference || undefined, flash: flash ? flash.id : undefined });
        etat.flash = null;
        etat.moi = await lireMoi().catch(() => etat.moi);
        vueProjet(p);
      } catch (err) {
        erreur.textContent = err.message;
        envoi.disabled = false;
        envoi.classList.remove('occupe');
      }
    });

    const aDesDemandes = etat.moi && etat.moi.projets.length;
    afficher([intro('Votre demande', 'Pour que la tatoueuse puisse voir votre projet.'), form],
      { titre: NOM, sousTitre: 'Nouvelle demande', retour: aDesDemandes ? () => { etat.flash = null; vueListe(); } : null });
  }

  /* ---------- Compte (demandé au moment d'écrire) ---------- */

  function aujourdhui() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function age(iso) {
    const [a, m, j] = iso.split('-').map(Number);
    const n = new Date();
    let x = n.getFullYear() - a;
    if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < j)) x--;
    return x;
  }

  function champ(libelle, attrs, aide) {
    const idc = 'c-' + attrs.name;
    return el('div', { class: 'field' },
      el('label', { for: idc }, libelle),
      el('input', { id: idc, ...attrs, 'aria-describedby': aide ? idc + '-aide' : null }),
      aide ? el('p', { class: 'field-hint', id: idc + '-aide' }, aide) : null);
  }

  function vueCompte(mode, apres = null) {
    const erreur = el('p', { class: 'field-error', role: 'alert' });
    const tete = intro('Demander un devis', 'Connectez-vous ou créez votre compte : la conversation avec la tatoueuse s’ouvre ensuite.');

    const onglets = el('div', { class: 'onglets', role: 'tablist' },
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === 'inscription'), onclick: () => vueCompte('inscription', apres) }, 'Créer mon compte'),
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === 'connexion'), onclick: () => vueCompte('connexion', apres) }, 'J’ai déjà un compte'));

    let form;
    if (mode === 'inscription') {
      // Rien n'est annoncé à l'avance : le blocage n'apparaît que si la date saisie est celle d'une personne mineure.
      const blocage = el('p', { class: 'notice notice--error', role: 'alert', hidden: true }, 'Le salon ne tatoue pas les personnes mineures.');
      const envoyer = bouton(apres ? 'Créer mon compte et envoyer' : 'Créer mon compte', { type: 'submit', class: 'btn--accent btn-plein' }, 'arrow-right');
      const naissance = champ('Date de naissance', { name: 'naissance', type: 'date', required: true, max: aujourdhui(), min: '1900-01-01', autocomplete: 'bday' });
      const saisie = naissance.querySelector('input');
      const verifierAge = () => {
        const mineur = /^\d{4}-\d{2}-\d{2}$/.test(saisie.value) && age(saisie.value) < 18;
        blocage.hidden = !mineur;
        envoyer.disabled = mineur;
        naissance.classList.toggle('is-invalid', mineur);
      };
      saisie.addEventListener('change', verifierAge);
      saisie.addEventListener('input', verifierAge);

      form = el('form', { class: 'formulaire', novalidate: true },
        champ('Téléphone', { name: 'telephone', type: 'tel', required: true, autocomplete: 'tel', inputmode: 'tel' }, 'Il sert aussi à vous connecter.'),
        el('div', { class: 'deux' },
          champ('Prénom', { name: 'prenom', required: true, autocomplete: 'given-name', maxlength: 60 }),
          champ('Nom', { name: 'nom', required: true, autocomplete: 'family-name', maxlength: 60 })),
        naissance,
        blocage,
        champ('E-mail (facultatif)', { name: 'email', type: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false' }),
        champ('Mot de passe', { name: 'motDePasse', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }, '8 caractères minimum.'),
        erreur,
        envoyer);
    } else {
      form = el('form', { class: 'formulaire', novalidate: true },
        champ('Téléphone ou e-mail', { name: 'contact', required: true, autocomplete: 'username', inputmode: 'tel', autocapitalize: 'off', spellcheck: 'false' }),
        champ('Mot de passe', { name: 'motDePasse', type: 'password', required: true, autocomplete: 'current-password' }, 'Mot de passe oublié ? Contactez le salon.'),
        erreur,
        bouton(apres ? 'Me connecter et envoyer' : 'Me connecter', { type: 'submit', class: 'btn--accent btn-plein' }, 'arrow-right'));
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erreur.textContent = '';
      const d = Object.fromEntries(new FormData(form));
      const manque = [...form.querySelectorAll('[required]')].find((n) => !n.value.trim());
      if (manque) {
        erreur.textContent = 'Merci de remplir tous les champs.';
        manque.focus();
        return;
      }
      const envoi = form.querySelector('[type=submit]');
      envoi.disabled = true;
      envoi.classList.add('occupe');
      try {
        await api('POST', mode === 'inscription' ? '/api/inscription' : '/api/connexion', d);
        etat.moi = await lireMoi();
        if (apres) await apres();
        else await charger();
        focusPremier();
      } catch (err) {
        erreur.textContent = err.message;
        envoi.disabled = false;
        envoi.classList.remove('occupe');
      }
    });

    afficher([tete, onglets, form], { sousTitre: mode === 'inscription' ? 'Création de compte' : 'Connexion' });
    focusPremier();
  }

  /* ---------- Mes demandes ---------- */

  function vueListe() {
    const { client, projets } = etat.moi;
    const liste = el('ul', { class: 'projets' },
      projets.map((p) => el('li', {},
        el('button', { type: 'button', class: 'projet-ligne', onclick: () => ouvrirProjet(p.id) },
          el('span', { class: 'projet-titre' }, p.titre),
          el('span', { class: 'badge badge-' + p.etape }, ETAPES[p.etape]),
          p.creneau && p.etape !== 'annule' ? el('span', { class: 'projet-date' }, icone('calendar'), Sha.creneau(p.creneau.debut)) : null,
          p.nonLus > 0 ? el('span', { class: 'pastille', 'aria-label': p.nonLus + ' nouveau(x) message(s)' }, String(p.nonLus)) : null))));

    afficher([
      intro('Bonjour ' + client.prenom, 'Vos demandes et vos rendez-vous.'),
      bouton('Nouvelle conversation', { class: 'btn--accent btn-plein', onclick: () => { etat.flash = null; vueNouvelleConversation(); } }, 'plus'),
      liste,
      el('button', { type: 'button', class: 'lien-discret', onclick: deconnexion }, 'Se déconnecter (' + client.contact + ')'),
    ], { sousTitre: 'Mes demandes' });
  }

  async function deconnexion() {
    await api('POST', '/api/deconnexion').catch(() => {});
    etat.moi = null;
    const bulle = document.querySelector('.chat-bulle');
    if (bulle) bulle.remove();
    vueCompte('connexion');
  }

  /* ---------- Conversation d'une demande ---------- */

  async function ouvrirProjet(pid) {
    try {
      vueProjet(await api('GET', '/api/projets/' + pid));
    } catch (e) {
      afficher(erreurBloc(e.message, () => ouvrirProjet(pid)), { retour: retourListe });
    }
  }

  async function retourListe() {
    etat.moi = await lireMoi().catch(() => etat.moi);
    if (etat.moi) vueListe();
    else vueCompte('connexion');
  }

  const ORDRE = ['Messages', 'Devis', 'Créneau', 'Acompte', 'Confirmé'];
  function progression(etape) {
    const pos = { discussion: 0, devis: 1, devis_accepte: 2, creneau: 3, acompte_declare: 3, confirme: 4, annule: -1 }[etape];
    return el('ol', { class: 'progression', 'aria-label': 'Avancement : ' + ETAPES[etape] },
      ORDRE.map((nom, i) => el('li', { class: i < pos ? 'fait' : i === pos ? 'actuel' : '', 'aria-current': i === pos ? 'step' : null }, nom)));
  }

  function bulle(p, m) {
    if (m.de === 'systeme') return el('li', { class: 'msg msg-systeme' }, el('p', {}, m.texte));
    const src = `/api/projets/${p.id}/images/${m.image}`;
    return el('li', { class: 'msg ' + (m.de === 'client' ? 'msg-moi' : 'msg-elle') },
      m.image ? el('button', { type: 'button', class: 'msg-image', 'aria-label': 'Agrandir l’image', onclick: () => Sha.visionneuse(src, m.texte) },
        el('img', { src, alt: m.texte || (m.de === 'client' ? 'Image envoyée' : 'Image reçue'), loading: 'lazy' })) : null,
      m.texte ? el('p', {}, m.texte) : null,
      el('time', { datetime: new Date(m.at).toISOString() }, Sha.quand(m.at)));
  }

  function action(p, rafraichir) {
    const faire = (url, corpsReq) => async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.classList.add('occupe');
      try {
        rafraichir(await api('POST', `/api/projets/${p.id}/${url}`, corpsReq));
      } catch (err) {
        avis(err.message);
        b.disabled = false;
        b.classList.remove('occupe');
      }
    };
    const d = p.devis;
    const lignesDevis = d && el('dl', { class: 'devis-lignes' },
      el('div', {}, el('dt', {}, 'Prix'), el('dd', {}, d.prix + ' €')),
      el('div', {}, el('dt', {}, 'Acompte'), el('dd', {}, d.acompte + ' €')),
      el('div', {}, el('dt', {}, 'Durée'), el('dd', {}, Sha.duree(d.duree))));
    const date = () => el('p', { class: 'creneau-date' }, icone('calendar'), Sha.creneau(p.creneau.debut));

    switch (p.etape) {
      case 'devis':
        return el('section', { class: 'carte carte-devis' },
          el('p', { class: 'box-title' }, 'Votre devis'), lignesDevis,
          p.creneau ? el('p', { class: 'creneau-date' }, icone('calendar'), Sha.creneau(p.creneau.debut)) : null,
          d.details ? el('p', { class: 'devis-details' }, d.details) : null,
          bouton(p.creneau ? 'J’accepte le devis et le créneau' : 'J’accepte ce devis', { class: 'btn--accent btn-plein', onclick: faire('accepter-devis') }, 'check'),
          el('p', { class: 'field-hint' }, 'Une question ou un changement ? Écrivez ci-dessous.'));
      case 'devis_accepte':
        return el('section', { class: 'carte' }, el('p', { class: 'box-title' }, 'Devis accepté'),
          el('p', {}, 'Votre créneau est en préparation : il vous sera proposé ici.'));
      case 'creneau': {
        const pay = p.paiement || {};
        const options = [];
        if (pay.paypal) {
          options.push(el('div', { class: 'paiement' },
            el('p', { class: 'paiement-nom' }, 'PayPal'),
            el('a', { class: 'btn btn-paypal btn-plein', href: pay.paypal, target: '_blank', rel: 'noopener' }, el('span', {}, `Payer ${d.acompte} € avec PayPal`), icone('arrow-up-right')),
            el('button', { type: 'button', class: 'lien-action', onclick: faire('acompte', { mode: 'paypal' }) }, 'J’ai payé par PayPal')));
        }
        if (pay.wero) {
          options.push(el('div', { class: 'paiement' },
            el('p', { class: 'paiement-nom' }, 'Wero'),
            el('p', {}, `Envoyez ${d.acompte} € depuis l’application de votre banque au `, el('strong', {}, pay.wero), ', avec la référence ', el('strong', {}, pay.reference), '.'),
            el('button', { type: 'button', class: 'lien-action', onclick: faire('acompte', { mode: 'wero' }) }, 'J’ai payé par Wero')));
        }
        options.push(el('div', { class: 'paiement' },
          el('p', { class: 'paiement-nom' }, 'Au salon'),
          el('p', {}, 'Déposez l’acompte au salon' + (pay.salon ? ' : ' + pay.salon + '.' : '.')),
          el('button', { type: 'button', class: 'lien-action', onclick: faire('acompte', { mode: 'salon' }) }, 'Je le dépose au salon')));
        return el('section', { class: 'carte carte-creneau' },
          el('p', { class: 'box-title' }, 'Créneau proposé'),
          date(),
          el('p', { class: 'field-hint' }, 'Durée prévue : ' + Sha.duree(p.creneau.duree)),
          el('p', { class: 'acompte-titre' }, `Acompte de ${d.acompte} € pour bloquer ce créneau`),
          ...options,
          pay.conditions ? el('p', { class: 'field-hint' }, pay.conditions) : null);
      }
      case 'acompte_declare':
        return el('section', { class: 'carte' }, el('p', { class: 'box-title' }, 'Acompte en vérification'),
          date(),
          el('p', {}, p.acompte.mode === 'salon' ? 'Déposez l’acompte au salon : le rendez-vous sera confirmé à réception.' : 'Votre rendez-vous sera confirmé dès réception du paiement.'));
      case 'confirme':
        return el('section', { class: 'carte carte-ok' },
          el('p', { class: 'box-title' }, 'Rendez-vous confirmé'),
          date(),
          p.paiement && p.paiement.salon ? el('p', { class: 'carte-lieu' }, icone('pin'), p.paiement.salon) : null,
          d.prix > d.acompte ? el('p', { class: 'field-hint' }, 'Reste à régler le jour du rendez-vous : ' + (d.prix - d.acompte) + ' €.') : null);
      case 'annule':
        return el('section', { class: 'carte' }, el('p', {}, 'Cette demande est clôturée. Ouvrez une nouvelle demande pour un autre projet.'));
      default:
        return null;
    }
  }

  /** Zone « joindre une image » de la saisie d'un message. */
  function pieceJointe() {
    const apercu = el('div', { class: 'pj-apercu', hidden: true });
    const input = el('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'pj-' + Math.random().toString(36).slice(2) });
    const zone = { image: null, input, apercu };
    zone.vider = () => { zone.image = null; apercu.hidden = true; apercu.replaceChildren(); input.value = ''; };
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        zone.image = await Sha.preparerImage(f);
        apercu.replaceChildren(el('img', { src: zone.image, alt: 'Image jointe' }),
          el('button', { type: 'button', class: 'icon-btn pj-retirer', 'aria-label': 'Retirer l’image', onclick: zone.vider }, icone('close')));
        apercu.hidden = false;
      } catch (e) {
        avis(e.message);
        zone.vider();
      }
    });
    zone.bouton = el('label', { class: 'icon-btn', for: input.id, title: 'Joindre une image', 'aria-label': 'Joindre une image' }, icone('image'));
    return zone;
  }

  function vueProjet(p) {
    const fil = el('ol', { class: 'fil', 'aria-live': 'polite', 'aria-label': 'Messages' });
    const zoneAction = el('div', { class: 'zone-action' });
    const entete = el('div', { class: 'projet-entete' });
    const erreur = el('p', { class: 'field-error', role: 'alert' });

    const pj = pieceJointe();
    const texte = el('textarea', { rows: 1, placeholder: 'Votre message…', 'aria-label': 'Votre message', maxlength: 2000 });
    const envoyer = el('button', { type: 'submit', class: 'icon-btn envoyer', 'aria-label': 'Envoyer' }, icone('send'));
    const saisie = el('form', { class: 'saisie' }, pj.apercu, el('div', { class: 'saisie-ligne' }, pj.bouton, pj.input, texte, envoyer), erreur);

    const rendre = (q) => {
      p = q;
      etat.signature = q.messages.length + q.etape;
      sous.textContent = ETAPES[q.etape];
      entete.replaceChildren(progression(q.etape));
      const enBas = corps.scrollHeight - corps.scrollTop - corps.clientHeight < 80;
      fil.replaceChildren(...q.messages.map((m) => bulle(q, m)));
      zoneAction.replaceChildren(...[action(q, rendre)].filter(Boolean));
      if (enBas || !fil.dataset.pret) requestAnimationFrame(() => { corps.scrollTop = corps.scrollHeight; });
      fil.dataset.pret = '1';
      saisie.hidden = q.etape === 'annule';
    };

    const ajuster = () => { texte.style.height = 'auto'; texte.style.height = Math.min(texte.scrollHeight, 140) + 'px'; };
    texte.addEventListener('input', ajuster);
    texte.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); saisie.requestSubmit(); }
    });
    saisie.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!texte.value.trim() && !pj.image) return;
      envoyer.disabled = true;
      erreur.textContent = '';
      try {
        const q = await api('POST', `/api/projets/${p.id}/messages`, { texte: texte.value, image: pj.image });
        texte.value = '';
        pj.vider();
        ajuster();
        fil.dataset.pret = '';
        rendre(q);
      } catch (err) {
        erreur.textContent = err.message;
      } finally {
        envoyer.disabled = false;
        texte.focus();
      }
    });

    afficher([el('div', { class: 'conversation' }, entete, fil, zoneAction), saisie],
      { titre: p.titre, sousTitre: ETAPES[p.etape], retour: retourListe });
    corps.classList.add('mode-conversation');
    rendre(p);

    // La conversation se met à jour toute seule tant qu'elle est ouverte.
    etat.minuterie = setInterval(async () => {
      if (document.hidden || chat.hidden) return;
      try {
        const q = await api('GET', '/api/projets/' + p.id);
        if (q.messages.length + q.etape !== etat.signature) rendre(q);
      } catch { /* réseau momentanément indisponible : on réessaie au prochain tour */ }
    }, 5000);
  }

  function arreterSuivi() {
    clearInterval(etat.minuterie);
    etat.minuterie = null;
    corps.classList.remove('mode-conversation');
  }

  return { ouvrir, fermer };
})();
