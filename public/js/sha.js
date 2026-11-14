'use strict';
/* Espace salon (« la rédaction ») : demandes (messages, devis, créneau, acompte), agenda,
   photos et flashs, réglages (coordonnées, horaires, photo de profil, acompte). */

(() => {
  const { api, el, icone, bouton, ETAPES, avis } = Sha;
  const app = document.getElementById('app');
  const etat = { onglet: 'demandes', projets: [], projetId: null, filtre: 'a-traiter', minuteries: [] };

  const A_TRAITER = (p) => p.nonLus > 0 || ['discussion', 'devis_accepte', 'acompte_declare'].includes(p.etape);
  const JOURS = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']];

  function stopper() {
    etat.minuteries.forEach(clearInterval);
    etat.minuteries = [];
  }
  function toutes(ms, fn) {
    etat.minuteries.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
  }

  function gererErreur(e) {
    if (e.status === 401) return vueConnexion();
    avis(e.message);
  }

  /** Un champ de formulaire, dans le style « coupon » du journal. */
  function champ(libelle, attrs, aide) {
    const idc = attrs.id || 'f-' + attrs.name;
    const { valeur = '', ...reste } = attrs;
    const saisie = attrs.rows
      ? el('textarea', { id: idc, ...reste }, valeur)
      : el('input', { id: idc, value: valeur, ...reste });
    return el('div', { class: 'field' }, el('label', { for: idc }, libelle), saisie, aide ? el('p', { class: 'field-hint' }, aide) : null);
  }

  async function demarrer() {
    try {
      etat.projets = await api('GET', '/api/sha/projets');
      coquille();
    } catch (e) {
      if (e.status === 401) vueConnexion();
      else app.replaceChildren(el('p', { class: 'notice notice--error' }, e.message));
    }
  }

  /* ---------- Connexion (et première configuration de l'accès) ---------- */
  async function vueConnexion() {
    stopper();
    let configure = true;
    try { configure = (await api('GET', '/api/sha/etat')).configure; } catch { /* on propose la connexion */ }
    const erreur = el('p', { class: 'field-error', role: 'alert' });
    const nom = document.title.split(' · ').at(-1);
    const form = configure
      ? el('form', { class: 'connexion formulaire' },
          el('a', { href: '/', class: 'brand' }, nom),
          el('h1', { class: 'connexion-titre' }, 'La rédaction'),
          champ('Identifiant', { name: 'identifiant', id: 'c-id', required: true, autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' }),
          champ('Mot de passe', { name: 'motDePasse', id: 'c-mdp', type: 'password', required: true, autocomplete: 'current-password' }),
          erreur,
          bouton('Entrer', { type: 'submit', class: 'btn--accent btn-plein' }, 'arrow-right'))
      : el('form', { class: 'connexion formulaire' },
          el('a', { href: '/', class: 'brand' }, nom),
          el('h1', { class: 'connexion-titre' }, 'Première connexion'),
          el('p', { class: 'field-hint' }, 'Choisissez l’identifiant et le mot de passe qui protégeront votre espace. Le code de configuration se trouve dans le fichier data/CODE-DE-CONFIGURATION.txt du site.'),
          champ('Code de configuration', { name: 'code', id: 'c-code', required: true, inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '0000-0000' }),
          champ('Identifiant', { name: 'identifiant', id: 'c-id', required: true, autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', minlength: 3, maxlength: 40 }, 'Lettres, chiffres, point ou tiret.'),
          champ('Mot de passe', { name: 'motDePasse', id: 'c-mdp', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' }, '10 caractères minimum.'),
          champ('Le même mot de passe', { name: 'confirmation', id: 'c-mdp2', type: 'password', required: true, autocomplete: 'new-password' }),
          erreur,
          bouton('Protéger mon espace', { type: 'submit', class: 'btn--accent btn-plein' }, 'lock'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erreur.textContent = '';
      const d = Object.fromEntries(new FormData(form));
      if (!configure && d.motDePasse !== d.confirmation) { erreur.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
      const envoi = form.querySelector('[type=submit]');
      envoi.classList.add('occupe');
      try {
        await api('POST', configure ? '/api/sha/connexion' : '/api/sha/configurer', d);
        demarrer();
      } catch (err) {
        erreur.textContent = err.message;
        envoi.classList.remove('occupe');
      }
    });
    app.replaceChildren(el('div', { class: 'connexion-fond' }, form));
    form.querySelector('input').focus();
  }

  /* ---------- Coquille ---------- */
  const ONGLETS = [['demandes', 'Demandes', 'chat'], ['agenda', 'Agenda', 'calendar'], ['fermetures', 'Fermetures', 'ban'], ['galerie', 'Photos & flashs', 'image'], ['reglages', 'Réglages', 'pen']];

  function coquille() {
    const nonLus = etat.projets.reduce((n, p) => n + p.nonLus, 0);
    const nav = el('nav', { class: 'onglets-espace', 'aria-label': 'Rubriques' },
      ONGLETS.map(([k, nom, ic]) => el('button', { type: 'button', 'aria-current': etat.onglet === k ? 'page' : null, onclick: () => { etat.onglet = k; etat.projetId = null; coquille(); } },
        icone(ic), el('span', {}, nom), k === 'demandes' && nonLus ? el('b', { class: 'pastille-inline' }, String(nonLus)) : null)));
    const barre = el('header', { class: 'barre' },
      el('a', { href: '/', class: 'brand', title: 'Voir le site' }, document.title.split(' · ').at(-1)),
      nav,
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Se déconnecter', title: 'Se déconnecter', onclick: async () => { await api('POST', '/api/sha/deconnexion').catch(() => {}); vueConnexion(); } }, icone('logout')));
    const zone = el('div', { class: 'zone' });
    app.replaceChildren(barre, zone);
    stopper();
    ({ demandes: vueDemandes, agenda: vueAgenda, fermetures: vueFermetures, galerie: vueGalerie, reglages: vueReglages })[etat.onglet](zone);
  }

  async function rafraichirListe() {
    try {
      etat.projets = await api('GET', '/api/sha/projets');
    } catch (e) {
      if (e.status === 401) vueConnexion();
    }
  }

  /* ---------- Demandes ---------- */
  function vueDemandes(zone) {
    const liste = el('div', { class: 'liste' });
    const detail = el('section', { class: 'detail', 'aria-label': 'Conversation' });
    zone.append(el('div', { class: 'demandes' + (etat.projetId ? ' avec-detail' : '') }, liste, detail));

    const rendreListe = () => {
      const visibles = etat.filtre === 'a-traiter' ? etat.projets.filter(A_TRAITER) : etat.projets;
      const nb = etat.projets.filter(A_TRAITER).length;
      liste.replaceChildren(
        el('div', { class: 'filtres', role: 'group', 'aria-label': 'Filtrer les demandes' },
          el('button', { type: 'button', 'aria-pressed': String(etat.filtre === 'a-traiter'), onclick: () => { etat.filtre = 'a-traiter'; rendreListe(); } }, `À traiter (${nb})`),
          el('button', { type: 'button', 'aria-pressed': String(etat.filtre === 'tous'), onclick: () => { etat.filtre = 'tous'; rendreListe(); } }, `Toutes (${etat.projets.length})`)),
        visibles.length
          ? el('ul', { class: 'projets' }, visibles.map((p) => el('li', {},
              el('button', { type: 'button', class: 'projet-ligne' + (p.id === etat.projetId ? ' actif' : ''), onclick: () => { etat.projetId = p.id; coquille(); } },
                el('span', { class: 'projet-titre' }, p.client || 'Client'),
                el('span', { class: 'projet-sujet' }, p.titre),
                p.apercu ? el('span', { class: 'projet-apercu' }, p.apercu) : null,
                el('span', { class: 'badge badge-' + p.etape }, ETAPES[p.etape]),
                p.nonLus ? el('span', { class: 'pastille' }, String(p.nonLus)) : null))))
          : el('p', { class: 'vide-espace' }, etat.filtre === 'a-traiter' ? 'Rien à traiter pour le moment.' : 'Aucune demande pour l’instant.'));
    };
    rendreListe();
    toutes(10000, async () => { await rafraichirListe(); rendreListe(); });

    if (etat.projetId) ouvrirProjet(detail);
    else detail.append(el('div', { class: 'vide-detail' }, icone('chat'), el('p', {}, 'Choisissez une demande pour lire les messages, envoyer le devis et fixer le créneau.')));
  }

  async function ouvrirProjet(detail) {
    let p;
    try {
      p = await api('GET', '/api/sha/projets/' + etat.projetId);
    } catch (e) {
      return gererErreur(e);
    }
    const lu = etat.projets.find((x) => x.id === p.id);
    if (lu) lu.nonLus = 0;

    const fil = el('ol', { class: 'fil', 'aria-live': 'polite' });
    const panneau = el('div', { class: 'panneau' });
    const tete = el('div', { class: 'detail-tete' });
    const defile = el('div', { class: 'detail-defile' }, fil);
    let signature = '';

    const rendre = (q) => {
      p = q;
      signature = q.messages.length + q.etape;
      tete.replaceChildren(
        el('button', { type: 'button', class: 'icon-btn retour-mobile', 'aria-label': 'Retour à la liste', onclick: () => { etat.projetId = null; coquille(); } }, icone('arrow-left')),
        el('div', {}, el('p', { class: 'detail-titre' }, q.titre), el('span', { class: 'badge badge-' + q.etape }, ETAPES[q.etape])));
      const enBas = defile.scrollHeight - defile.scrollTop - defile.clientHeight < 80;
      fil.replaceChildren(...q.messages.map((m) => bulle(q, m)));
      if (enBas || !fil.dataset.pret) requestAnimationFrame(() => { defile.scrollTop = defile.scrollHeight; });
      fil.dataset.pret = '1';
      panneau.replaceChildren(...outils(q, rendre));
    };

    // Saisie d'une réponse
    const texte = el('textarea', { rows: 1, placeholder: 'Répondre…', 'aria-label': 'Votre réponse', maxlength: 2000 });
    const fichier = el('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'pj-salon' });
    const apercu = el('div', { class: 'pj-apercu', hidden: true });
    let image = null;
    const viderImage = () => { image = null; apercu.hidden = true; apercu.replaceChildren(); fichier.value = ''; };
    fichier.addEventListener('change', async () => {
      if (!fichier.files[0]) return;
      try {
        image = await Sha.preparerImage(fichier.files[0]);
        apercu.replaceChildren(el('img', { src: image, alt: 'Image jointe' }), el('button', { type: 'button', class: 'icon-btn pj-retirer', 'aria-label': 'Retirer l’image', onclick: viderImage }, icone('close')));
        apercu.hidden = false;
      } catch (e) { avis(e.message); viderImage(); }
    });
    const ajuster = () => { texte.style.height = 'auto'; texte.style.height = Math.min(texte.scrollHeight, 160) + 'px'; };
    texte.addEventListener('input', ajuster);
    const saisie = el('form', { class: 'saisie' }, apercu,
      el('div', { class: 'saisie-ligne' },
        el('label', { class: 'icon-btn', for: 'pj-salon', title: 'Joindre une image', 'aria-label': 'Joindre une image' }, icone('image')), fichier,
        texte,
        el('button', { type: 'submit', class: 'icon-btn envoyer', 'aria-label': 'Envoyer' }, icone('send'))));
    texte.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); saisie.requestSubmit(); } });
    saisie.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!texte.value.trim() && !image) return;
      try {
        const q = await api('POST', `/api/sha/projets/${p.id}/messages`, { texte: texte.value, image });
        texte.value = '';
        viderImage();
        ajuster();
        fil.dataset.pret = '';
        rendre(q);
      } catch (err) { gererErreur(err); }
      texte.focus();
    });

    detail.replaceChildren(el('div', { class: 'detail-conv' }, tete, defile, saisie), panneau);
    rendre(p);

    toutes(5000, async () => {
      try {
        const q = await api('GET', '/api/sha/projets/' + p.id);
        if (q.messages.length + q.etape !== signature) rendre(q);
      } catch { /* on réessaie au prochain tour */ }
    });
  }

  function bulle(p, m) {
    if (m.de === 'systeme') return el('li', { class: 'msg msg-systeme' }, el('p', {}, m.texte));
    const src = `/api/projets/${p.id}/images/${m.image}`;
    return el('li', { class: 'msg ' + (m.de === 'sha' ? 'msg-moi' : 'msg-elle') },
      m.image ? el('button', { type: 'button', class: 'msg-image', 'aria-label': 'Agrandir l’image', onclick: () => Sha.visionneuse(src, m.texte) }, el('img', { src, alt: m.texte || 'Image jointe', loading: 'lazy' })) : null,
      m.texte ? el('p', {}, m.texte) : null,
      el('time', { datetime: new Date(m.at).toISOString() }, Sha.quand(m.at)));
  }

  function maintenantLocal() {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }

  function selectDuree(nom, valeur, idc) {
    const s = el('select', { name: nom, id: idc });
    for (let m = 30; m <= 600; m += 30) s.append(el('option', { value: m, selected: m === valeur }, Sha.duree(m)));
    return s;
  }

  const RAISONS = {
    devis: 'déjà proposé à une autre personne · devis pas encore accepté',
    creneau: 'déjà proposé à une autre personne · acompte toujours pas payé',
    acompte_declare: 'déjà proposé · acompte en vérification',
    confirme: 'déjà réservé',
  };

  /**
   * Le choix du créneau : une date, puis une heure dans une liste (tous les quarts d'heure).
   * Les heures qui chevauchent un autre rendez-vous sont grisées, avec la raison.
   * (Le champ « date et heure » du navigateur refusait certaines heures valides.)
   */
  function choixCreneau(p, { debut = '', selectDuree: duree, requis = false, prefixe = 'f' }) {
    const cache = el('input', { type: 'hidden', name: 'debut', value: debut });
    const jour = el('input', { type: 'date', id: prefixe + '-jour', min: maintenantLocal().slice(0, 10), value: debut.slice(0, 10), required: requis });
    const heure = el('select', { id: prefixe + '-heure', required: requis });
    const note = el('p', { class: 'field-hint creneau-note' });
    const autres = etat.projets.filter((x) => x.id !== p.id && x.creneau && x.etape !== 'annule');
    const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

    function remplir() {
      const d = jour.value;
      const longueur = Number(duree.value) || 60;
      const choisie = heure.value || debut.slice(11, 16);
      heure.replaceChildren(el('option', { value: '' }, d ? 'Choisir l’heure' : 'Choisir d’abord la date'));
      const pris = autres.filter((x) => x.creneau.debut.slice(0, 10) === d);
      for (let m = 8 * 60; m <= 20 * 60; m += 15) {
        const hh = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const conflit = pris.find((x) => { const s = minutes(x.creneau.debut.slice(11)); return s < m + longueur && m < s + x.creneau.duree; });
        heure.append(el('option', { value: hh, disabled: Boolean(conflit), selected: hh === choisie && !conflit },
          hh.replace(':', 'h') + (conflit ? ` — ${RAISONS[conflit.etape] || 'déjà pris'} (${conflit.client})` : '')));
      }
      heure.disabled = !d;
      note.textContent = pris.length ? `Ce jour-là : ${pris.map((x) => `${x.creneau.debut.slice(11).replace(':', 'h')} ${x.client} (${RAISONS[x.etape] || 'pris'})`).join(' · ')}` : (d ? 'Aucun autre rendez-vous ce jour-là.' : '');
      majCache();
    }
    function majCache() { cache.value = jour.value && heure.value ? `${jour.value}T${heure.value}` : ''; }
    jour.addEventListener('change', remplir);
    duree.addEventListener('change', remplir);
    heure.addEventListener('change', majCache);
    remplir();

    return el('div', { class: 'deux' },
      el('div', { class: 'field' }, el('label', { for: prefixe + '-jour' }, requis ? 'Date' : 'Date (facultatif)'), jour),
      el('div', { class: 'field' }, el('label', { for: prefixe + '-heure' }, 'Heure'), heure, cache),
      note);
  }

  function outils(p, rendre) {
    const c = p.client || {};
    const blocs = [];
    const action = (url, corps, confirmation) => async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (confirmation && !confirm(confirmation)) return;
      const form = e && e.currentTarget && e.currentTarget.tagName === 'FORM' ? e.currentTarget : null;
      const donnees = form ? Object.fromEntries(new FormData(form)) : corps;
      try {
        rendre(await api('POST', `/api/sha/projets/${p.id}/${url}`, donnees));
        rafraichirListe();
      } catch (err) { gererErreur(err); }
    };

    // Le projet : ce que le client a donné avant d'envoyer sa demande
    if (p.infos && p.infos.evenement) {
      const ev = p.infos.evenement;
      const [a, m, j] = ev.date.split('-');
      blocs.push(el('section', { class: 'outil' },
        el('p', { class: 'box-title' }, 'L’événement'),
        el('dl', { class: 'projet-infos' },
          el('dt', {}, 'Type'), el('dd', {}, ev.type),
          el('dt', {}, 'Date'), el('dd', {}, `${j}/${m}/${a}`),
          el('dt', {}, 'Lieu'), el('dd', {}, ev.lieu),
          ev.invites ? [el('dt', {}, 'Invités'), el('dd', {}, ev.invites)] : null,
          ev.duree ? [el('dt', {}, 'Durée'), el('dd', {}, ev.duree)] : null)));
    } else if (p.infos) {
      const ref = p.infos.reference ? `/api/projets/${p.id}/images/${p.infos.reference}` : (p.flash ? p.flash.src : '');
      blocs.push(el('section', { class: 'outil' },
        el('p', { class: 'box-title' }, 'Le projet'),
        el('dl', { class: 'projet-infos' },
          el('dt', {}, 'Endroit'), el('dd', {}, p.infos.emplacement),
          el('dt', {}, 'Taille'), el('dd', {}, p.infos.taille)),
        ref ? el('button', { type: 'button', class: 'msg-image', 'aria-label': 'Agrandir la référence', onclick: () => Sha.visionneuse(ref, 'Référence') },
          el('img', { src: ref, alt: p.infos.reference ? 'Photo de référence' : 'Flash choisi' })) : null));
    }

    // Le client
    blocs.push(el('section', { class: 'outil' },
      el('p', { class: 'box-title' }, 'Client'),
      el('p', { class: 'client-nom' }, `${c.prenom || ''} ${c.nom || ''}`),
      c.compte
        ? el('p', { class: 'field-hint' }, `${c.age} ans · né·e le ${c.naissance ? c.naissance.split('-').reverse().join('/') : '?'}`)
        : el('p', { class: 'field-hint' }, 'Sans compte : rendez-vous noté par le salon.'),
      c.telephone ? el('a', { class: 'contact link', href: 'tel:' + c.telephone }, icone('phone'), c.telephone) : null,
      c.email ? el('a', { class: 'contact link', href: 'mailto:' + c.email }, icone('mail'), c.email) : null,
      p.flash ? el('div', { class: 'flash-choisi' }, el('img', { src: p.flash.src, alt: '' }), el('p', {}, el('strong', {}, 'Flash demandé'), p.flash.titre ? ' · ' + p.flash.titre : '')) : null));

    if (p.etape === 'annule') {
      blocs.push(el('section', { class: 'outil' }, el('p', {}, 'Demande clôturée.')));
      return blocs;
    }

    // Le devis, avec le créneau choisi en même temps
    if (['discussion', 'devis'].includes(p.etape)) {
      const d = p.devis || {};
      const duree = selectDuree('duree', d.duree || 120, 'f-duree');
      const form = el('form', { class: 'outil formulaire' },
        el('p', { class: 'box-title' }, p.devis ? 'Devis envoyé · le modifier' : 'Envoyer le devis'),
        el('div', { class: 'deux' },
          champ('Prix (€)', { name: 'prix', id: 'f-prix', type: 'number', min: 1, step: 1, required: true, valeur: d.prix ?? (p.flash && p.flash.prix) ?? '', inputmode: 'numeric' }),
          champ('Acompte (€)', { name: 'acompte', id: 'f-acompte', type: 'number', min: 1, step: 1, required: true, valeur: d.acompte ?? '', inputmode: 'numeric' })),
        el('div', { class: 'field' }, el('label', { for: 'f-duree' }, 'Durée de la séance'), duree),
        el('p', { class: 'box-title box-title--sous' }, 'Le créneau'),
        choixCreneau(p, { debut: p.creneau ? p.creneau.debut : '', selectDuree: duree, prefixe: 'f' }),
        champ('Détails (facultatif)', { name: 'details', id: 'f-details', rows: 3, maxlength: 1000, valeur: d.details || '' }),
        bouton(p.devis ? 'Renvoyer le devis' : 'Envoyer le devis', { type: 'submit', class: 'btn-plein' }, 'send'));
      const prix = form.querySelector('#f-prix');
      const acompte = form.querySelector('#f-acompte');
      // L'acompte se propose à 30 % du prix tant qu'il n'a pas été saisi à la main.
      prix.addEventListener('input', () => { if (!acompte.dataset.touche && prix.value) acompte.value = Math.max(1, Math.round(prix.value * 0.3)); });
      acompte.addEventListener('input', () => { acompte.dataset.touche = '1'; });
      if (d.acompte) acompte.dataset.touche = '1';
      form.addEventListener('submit', action('devis'));
      blocs.push(form);
    }

    // Le créneau, une fois le devis accepté : le fixer s'il ne l'était pas, ou le déplacer.
    if (p.devis && !['discussion', 'devis'].includes(p.etape)) {
      const duree = selectDuree('duree', (p.creneau || p.devis).duree, 'f-duree-c');
      const form = el('form', { class: 'outil formulaire' },
        el('p', { class: 'box-title' }, p.creneau ? 'Créneau · le déplacer' : 'Choisir le créneau'),
        p.creneau ? el('p', { class: 'creneau-date' }, icone('calendar'), Sha.creneau(p.creneau.debut)) : el('p', { class: 'field-hint' }, 'Le devis est accepté : choisissez la date.'),
        el('div', { class: 'field' }, el('label', { for: 'f-duree-c' }, 'Durée'), duree),
        choixCreneau(p, { debut: p.creneau ? p.creneau.debut : '', selectDuree: duree, requis: true, prefixe: 'c' }),
        bouton(p.creneau ? 'Déplacer le rendez-vous' : 'Proposer ce créneau', { type: 'submit', class: 'btn-plein' }, 'calendar'));
      form.addEventListener('submit', (e) => {
        if (!form.querySelector('[name=debut]').value) { e.preventDefault(); avis('Choisissez la date et l’heure.'); return; }
        action('creneau')(e);
      });
      blocs.push(form);
    }

    // L'acompte
    if (['creneau', 'acompte_declare'].includes(p.etape)) {
      const declare = p.acompte && p.acompte.declare;
      blocs.push(el('section', { class: 'outil' + (declare ? ' outil-alerte' : '') },
        el('p', { class: 'box-title' }, 'Acompte : ' + p.devis.acompte + ' €'),
        el('p', {}, declare
          ? (p.acompte.mode === 'salon' ? 'Le client vient déposer l’acompte au salon.' : `Le client indique avoir payé par ${p.acompte.mode === 'paypal' ? 'PayPal' : 'Wero'}. Vérifiez la réception (référence SHA-${p.id.slice(0, 6).toUpperCase()}).`)
          : 'En attente du paiement du client.'),
        bouton('Acompte reçu : confirmer', { class: 'btn--accent btn-plein', onclick: action('acompte-recu', {}, `Confirmer avoir reçu ${p.devis.acompte} € ? Le rendez-vous sera confirmé.`) }, 'check')));
    }

    if (p.etape === 'confirme') {
      blocs.push(el('section', { class: 'outil outil-ok' }, el('p', { class: 'box-title' }, 'Rendez-vous confirmé'),
        el('p', {}, `Acompte de ${p.devis.acompte} € reçu. Reste ${p.devis.prix - p.devis.acompte} € le jour du rendez-vous.`)));
    }

    // Un autre rendez-vous pour ce client : retouche, suite de la séance…
    if (p.etape === 'confirme' || p.etape === 'annule' || p.creneau) {
      blocs.push(bouton('Nouveau rendez-vous pour ce client', { class: 'btn--outline btn-plein', onclick: () => ouvrirNouveauRdv({ depuis: p }) }, 'plus'));
    }

    blocs.push(el('button', { type: 'button', class: 'lien-discret', onclick: action('annuler', {}, 'Clôturer cette demande ? Le client en sera informé dans la conversation.') }, 'Clôturer cette demande'));
    return blocs;
  }

  /* ---------- Un rendez-vous fixé par le salon (retouche, suite, petit créneau) ---------- */

  function selectDureeFine(nom, valeur, idc) {
    const s = el('select', { name: nom, id: idc });
    for (let m = 15; m <= 600; m += 15) s.append(el('option', { value: m, selected: m === valeur }, Sha.duree(m)));
    return s;
  }

  /**
   * Le formulaire, dans une fenêtre : pour qui (un compte client, ou une personne sans compte),
   * l'objet, la date, la durée choisie librement et, si besoin, un acompte.
   */
  async function ouvrirNouveauRdv({ depuis = null } = {}) {
    let clients = [];
    if (!depuis) {
      try { clients = await api('GET', '/api/sha/clients'); } catch (e) { return gererErreur(e); }
    }
    const fond = el('div', { class: 'modale-fond' });
    const erreur = el('p', { class: 'field-error', role: 'alert' });
    const choixClient = el('select', { name: 'client', id: 'n-client' },
      el('option', { value: '' }, 'Personne sans compte'),
      clients.map((c) => el('option', { value: c.id }, `${c.prenom} ${c.nom}${c.telephone ? ' · ' + c.telephone : ''}`)));
    const sansCompte = el('div', { class: 'deux' },
      champ('Nom', { name: 'nom', id: 'n-nom', maxlength: 80 }),
      champ('Téléphone (facultatif)', { name: 'telephone', id: 'n-tel', type: 'tel', inputmode: 'tel' }));
    choixClient.addEventListener('change', () => { sansCompte.hidden = Boolean(choixClient.value); });

    const dureeRdv = selectDureeFine('duree', 60, 'n-duree');
    const form = el('form', { class: 'modale formulaire', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'n-titre' },
      el('div', { class: 'modale-tete' },
        el('h2', { class: 'box-title', id: 'n-titre' }, depuis ? 'Nouveau rendez-vous · ' + (depuis.client ? `${depuis.client.prenom} ${depuis.client.nom}`.trim() : '') : 'Ajouter un rendez-vous'),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', onclick: () => fond.remove() }, icone('close'))),
      depuis ? null : el('div', { class: 'field' }, el('label', { for: 'n-client' }, 'Client'), choixClient),
      depuis ? null : sansCompte,
      champ('Objet', { name: 'titre', id: 'n-objet', required: true, maxlength: 80, valeur: depuis ? 'Retouche · ' + depuis.titre.replace(/^Retouche · /, '') : '', placeholder: 'Retouche, suite de la séance, petit tatouage…' }),
      el('div', { class: 'field' }, el('label', { for: 'n-duree' }, 'Durée'), dureeRdv),
      choixCreneau({ id: null }, { selectDuree: dureeRdv, requis: true, prefixe: 'n' }),
      el('div', { class: 'deux' },
        champ('Prix (€, facultatif)', { name: 'prix', id: 'n-prix', type: 'number', min: 0, inputmode: 'numeric' }),
        champ('Acompte (€, facultatif)', { name: 'acompte', id: 'n-acompte', type: 'number', min: 0, inputmode: 'numeric' }, 'Sans acompte, le rendez-vous est confirmé tout de suite.')),
      erreur,
      bouton('Fixer le rendez-vous', { type: 'submit', class: 'btn--accent btn-plein' }, 'calendar'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erreur.textContent = '';
      const d = Object.fromEntries(new FormData(form));
      if (depuis) d.depuis = depuis.id;
      if (!depuis && !d.client && !String(d.nom || '').trim()) { erreur.textContent = 'Choisissez un client ou indiquez un nom.'; return; }
      if (!d.debut) { erreur.textContent = 'Choisissez la date et l’heure.'; return; }
      const envoi = form.querySelector('[type=submit]');
      envoi.classList.add('occupe');
      try {
        const q = await api('POST', '/api/sha/rendez-vous', d);
        fond.remove();
        avis('Rendez-vous fixé.', 'info');
        await rafraichirListe();
        etat.onglet = 'demandes';
        etat.filtre = 'tous';
        etat.projetId = q.id;
        coquille();
      } catch (err) {
        erreur.textContent = err.message;
        envoi.classList.remove('occupe');
      }
    });
    fond.addEventListener('click', (e) => { if (e.target === fond) fond.remove(); });
    fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') fond.remove(); });
    fond.append(form);
    document.body.append(fond);
    form.querySelector('select, input').focus();
  }

  /* ---------- Fermetures : exceptions et jours fériés ---------- */
  async function vueFermetures(zone) {
    let cal;
    try { cal = await api('GET', '/api/sha/calendrier'); } catch (e) { return gererErreur(e); }
    const fmt = (iso) => { const [a, m, j] = iso.split('-').map(Number); return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(a, m - 1, j)); };
    const erreur = el('p', { class: 'field-error', role: 'alert' });
    const type = el('select', { name: 'type', id: 'x-type' },
      el('option', { value: 'fermeture' }, 'Fermeture (congés, absence…)'),
      el('option', { value: 'ouverture' }, 'Ouverture exceptionnelle'),
      el('option', { value: 'horaires' }, 'Horaires modifiés'));
    const champHoraires = champ('Horaires de ces jours-là', { name: 'horaires', id: 'x-horaires', placeholder: '10h-16h', maxlength: 80 }, 'Par exemple « 10h-12h30 / 14h-18h ».');
    champHoraires.hidden = true;
    type.addEventListener('change', () => { champHoraires.hidden = type.value === 'fermeture'; });
    const du = el('input', { type: 'date', name: 'du', id: 'x-du', required: true, min: maintenantLocal().slice(0, 10) });
    const au = el('input', { type: 'date', name: 'au', id: 'x-au', min: maintenantLocal().slice(0, 10) });
    du.addEventListener('change', () => { au.min = du.value; if (!au.value || au.value < du.value) au.value = du.value; });

    const form = el('form', { class: 'outil formulaire' },
      el('h2', { class: 'box-title' }, 'Ajouter'),
      el('div', { class: 'field' }, el('label', { for: 'x-type' }, 'Type'), type),
      el('div', { class: 'deux' },
        el('div', { class: 'field' }, el('label', { for: 'x-du' }, 'Du'), du),
        el('div', { class: 'field' }, el('label', { for: 'x-au' }, 'Au (inclus)'), au)),
      champHoraires,
      champ('Motif (facultatif, affiché sur le site)', { name: 'motif', id: 'x-motif', maxlength: 80, placeholder: 'Congés, salon du tatouage…' }),
      erreur,
      bouton('Enregistrer', { type: 'submit', class: 'btn--accent btn-plein' }, 'check'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erreur.textContent = '';
      try {
        await api('POST', '/api/sha/exceptions', Object.fromEntries(new FormData(form)));
        avis('Enregistré : le site est à jour.', 'info');
        zone.replaceChildren();
        vueFermetures(zone);
      } catch (err) { erreur.textContent = err.message; }
    });

    const NOMS = { fermeture: 'Fermeture', ouverture: 'Ouverture exceptionnelle', horaires: 'Horaires modifiés' };
    const liste = cal.exceptions.length
      ? el('ul', { class: 'exceptions' }, cal.exceptions.map((x) => el('li', { class: 'exception exception--' + x.type },
          el('div', {},
            el('p', { class: 'exception-type' }, NOMS[x.type]),
            el('p', { class: 'exception-dates' }, x.du === x.au ? fmt(x.du) : `Du ${fmt(x.du)} au ${fmt(x.au)}`),
            x.horaires ? el('p', {}, x.horaires) : null,
            x.motif ? el('p', { class: 'field-hint' }, x.motif) : null),
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer', title: 'Supprimer', onclick: async () => {
            if (!confirm('Supprimer cette exception ?')) return;
            try { await api('DELETE', '/api/sha/exceptions/' + x.id); zone.replaceChildren(); vueFermetures(zone); } catch (err) { gererErreur(err); }
          } }, icone('trash')))))
      : el('p', { class: 'vide-espace' }, 'Aucune exception à venir.');

    const autoCase = el('input', { type: 'checkbox', checked: cal.feries.auto });
    autoCase.addEventListener('change', async () => {
      try { await api('POST', '/api/sha/feries', { auto: autoCase.checked }); zone.replaceChildren(); vueFermetures(zone); } catch (err) { gererErreur(err); }
    });
    const feries = el('section', { class: 'outil' },
      el('h2', { class: 'box-title' }, 'Jours fériés'),
      el('label', { class: 'case' }, autoCase, el('span', {}, 'Fermer automatiquement les jours fériés')),
      el('ul', { class: 'feries' }, cal.feries.prochains.map((f) => {
        const ouvert = el('input', { type: 'checkbox', checked: f.ouvert, disabled: !cal.feries.auto });
        ouvert.addEventListener('change', async () => {
          try { await api('POST', '/api/sha/feries', { date: f.date, ouvert: ouvert.checked }); avis(ouvert.checked ? 'Jour ouvert.' : 'Jour fermé.', 'info'); }
          catch (err) { ouvert.checked = !ouvert.checked; gererErreur(err); }
        });
        return el('li', {}, el('label', { class: 'case' }, ouvert, el('span', {}, el('strong', {}, f.nom), ' · ', f.jour, el('em', {}, ' — ouvert ce jour'))));
      })),
      el('p', { class: 'field-hint' }, 'Cochez un jour pour travailler ce jour-là. Seuls les jours fériés qui tombent un jour d’ouverture sont listés.'));

    zone.append(el('div', { class: 'page page-large' },
      el('h1', { class: 'page-titre' }, 'Fermetures'),
      el('p', { class: 'deck' }, 'Congés, ouvertures et horaires exceptionnels : ils s’affichent sur le site (bandeau, « En bref », page Pratique) et dans le badge « Ouvert / Fermé ».'),
      el('div', { class: 'fermetures-mise' },
        form,
        el('div', { class: 'fermetures-col' }, el('section', { class: 'outil' }, el('h2', { class: 'box-title' }, 'À venir'), liste), feries))));
  }

  /* ---------- Agenda ---------- */
  function vueAgenda(zone) {
    const auj = maintenantLocal().slice(0, 10);
    const rdv = etat.projets
      .filter((p) => p.creneau && p.etape !== 'annule' && p.creneau.debut.slice(0, 10) >= auj)
      .sort((a, b) => a.creneau.debut.localeCompare(b.creneau.debut));
    const jours = new Map();
    for (const p of rdv) {
      const j = p.creneau.debut.slice(0, 10);
      if (!jours.has(j)) jours.set(j, []);
      jours.get(j).push(p);
    }
    const fmtJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    zone.append(el('div', { class: 'page' },
      el('h1', { class: 'page-titre' }, 'Agenda'),
      el('p', { class: 'deck' }, 'Les rendez-vous à venir. Ceux qui attendent leur acompte ne sont pas encore confirmés.'),
      el('p', { class: 'actions agenda-actions' }, bouton('Ajouter un rendez-vous', { class: 'btn--accent', onclick: () => ouvrirNouveauRdv() }, 'plus')),
      rdv.length
        ? el('div', { class: 'agenda' }, [...jours].map(([j, ps]) => {
            const [a, m, d] = j.split('-').map(Number);
            return el('section', { class: 'jour' },
              el('h2', {}, fmtJour.format(new Date(a, m - 1, d))),
              el('ul', {}, ps.map((p) => el('li', {},
                el('button', { type: 'button', class: 'rdv', onclick: () => { etat.onglet = 'demandes'; etat.filtre = 'tous'; etat.projetId = p.id; coquille(); } },
                  el('span', { class: 'rdv-heure' }, p.creneau.debut.slice(11).replace(':', 'h')),
                  el('span', { class: 'rdv-qui' }, el('strong', {}, p.client), el('span', {}, p.titre + ' · ' + Sha.duree(p.creneau.duree))),
                  el('span', { class: 'badge badge-' + p.etape }, ETAPES[p.etape]))))));
          }))
        : el('p', { class: 'vide-espace' }, 'Aucun rendez-vous à venir.')));
  }

  /* ---------- Photos & flashs ---------- */
  async function vueGalerie(zone) {
    const grille = el('div', { class: 'galerie-admin' });
    const erreur = el('p', { class: 'field-error', role: 'alert' });
    const apercu = el('div', { class: 'depot-apercu' });
    const fichier = el('input', { type: 'file', accept: 'image/*', id: 'g-fichier', class: 'sr-only', multiple: true });
    const etiquette = el('span', {}, 'Choisir des images');
    let images = [];
    fichier.addEventListener('change', async () => {
      erreur.textContent = '';
      images = [];
      apercu.replaceChildren();
      for (const f of [...fichier.files].slice(0, 12)) {
        try {
          const image = await Sha.preparerImageDetail(f, 2000);
          images.push(image);
          apercu.append(el('img', { src: image.url, alt: '' }));
        } catch (e) { erreur.textContent = e.message; }
      }
      etiquette.textContent = images.length ? `${images.length} image${images.length > 1 ? 's' : ''} prête${images.length > 1 ? 's' : ''}` : 'Choisir des images';
    });

    const typeRadio = (v, libelle) => el('label', { class: 'choix' }, el('input', { type: 'radio', name: 'type', value: v, checked: v === 'photo' }), el('span', {}, libelle));
    const champPrix = champ('Prix indicatif (€, facultatif)', { name: 'prix', id: 'g-prix', type: 'number', min: 1, inputmode: 'numeric' });
    champPrix.hidden = true;
    const depot = el('form', { class: 'depot formulaire' },
      el('h2', { class: 'box-title' }, 'Ajouter'),
      el('div', { class: 'choix-groupe', role: 'radiogroup', 'aria-label': 'Type d’image' }, typeRadio('photo', 'Réalisation'), typeRadio('flash', 'Flash')),
      el('label', { class: 'depot-zone', for: 'g-fichier' }, icone('upload'), etiquette, el('small', {}, 'Jusqu’à 12 à la fois. Les photos du téléphone sont allégées toutes seules.')),
      fichier,
      apercu,
      champ('Titre (facultatif)', { name: 'titre', id: 'g-titre', maxlength: 80, placeholder: 'Ex. : Pivoines, avant-bras' }),
      champPrix,
      erreur,
      bouton('Publier sur le site', { type: 'submit', class: 'btn--accent btn-plein' }, 'plus'));
    depot.addEventListener('change', (e) => { if (e.target.name === 'type') champPrix.hidden = e.target.value !== 'flash'; });
    depot.addEventListener('submit', async (e) => {
      e.preventDefault();
      erreur.textContent = '';
      const d = Object.fromEntries(new FormData(depot));
      if (!images.length) { erreur.textContent = 'Choisissez au moins une image.'; return; }
      const envoi = depot.querySelector('[type=submit]');
      envoi.disabled = true;
      envoi.classList.add('occupe');
      try {
        for (const [i, image] of images.entries()) {
          const titre = images.length > 1 && d.titre ? `${d.titre} (${i + 1})` : d.titre;
          await api('POST', '/api/sha/galerie', { type: d.type, titre, prix: d.type === 'flash' ? d.prix : '', image: image.url, largeur: image.largeur, hauteur: image.hauteur });
        }
        avis(`${images.length} image${images.length > 1 ? 's publiées' : ' publiée'} sur le site.`, 'info');
        recharger();
      } catch (err) {
        erreur.textContent = err.message;
        envoi.disabled = false;
        envoi.classList.remove('occupe');
      }
    });

    const recharger = () => { zone.replaceChildren(); vueGalerie(zone); };

    zone.append(el('div', { class: 'page page-large' }, el('h1', { class: 'page-titre' }, 'Photos & flashs'),
      el('p', { class: 'deck' }, 'Ce que vous ajoutez ici paraît tout de suite sur le site.'),
      el('div', { class: 'galerie-mise' }, depot, grille)));

    let items;
    try { items = await api('GET', '/api/sha/galerie'); } catch (e) { return gererErreur(e); }
    const carte = (g) => {
      const titre = el('input', { value: g.titre || '', 'aria-label': 'Titre', maxlength: 80, placeholder: 'Sans titre' });
      const prix = g.type === 'flash' ? el('input', { type: 'number', value: g.prix ?? '', 'aria-label': 'Prix en euros', placeholder: 'Prix €', min: 1, class: 'mini' }) : null;
      const enregistrer = async () => {
        try {
          await api('POST', '/api/sha/galerie/' + g.id, prix ? { titre: titre.value, prix: prix.value } : { titre: titre.value });
          avis('Enregistré.', 'info');
        } catch (e) { gererErreur(e); }
      };
      titre.addEventListener('change', enregistrer);
      if (prix) prix.addEventListener('change', enregistrer);
      return el('article', { class: 'g-carte' + (g.type === 'flash' && !g.dispo ? ' g-pris' : '') },
        el('button', { type: 'button', class: 'g-image', onclick: () => Sha.visionneuse(g.src, g.titre), 'aria-label': 'Agrandir' }, el('img', { src: g.src, alt: g.titre || '', loading: 'lazy' })),
        el('span', { class: 'g-type' }, g.type === 'flash' ? 'Flash' : 'Réalisation'),
        el('div', { class: 'g-champs' }, titre, prix),
        el('div', { class: 'g-actions' },
          g.type === 'flash'
            ? el('label', { class: 'case' }, el('input', { type: 'checkbox', checked: !g.dispo, onchange: async (e) => {
                const case_ = e.target;
                try { await api('POST', '/api/sha/galerie/' + g.id, { dispo: !case_.checked }); case_.closest('.g-carte').classList.toggle('g-pris', case_.checked); }
                catch (err) { case_.checked = !case_.checked; gererErreur(err); }
              } }), el('span', {}, 'Déjà tatoué'))
            : el('span'),
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retirer du site', title: 'Retirer du site', onclick: async () => {
            if (!confirm('Retirer cette image du site ?')) return;
            try { await api('DELETE', '/api/sha/galerie/' + g.id); recharger(); } catch (e) { gererErreur(e); }
          } }, icone('trash'))));
    };
    grille.replaceChildren(...(items.length ? items.map(carte) : [el('p', { class: 'vide-espace' }, 'Aucune image pour l’instant. Ajoutez vos réalisations et vos planches de flashs.')]));
  }

  /* ---------- Réglages ---------- */

  /** Une photo de profil carrée, cadrée au centre. */
  async function photoCarree(fichier, cote = 480) {
    if (!/^image\//.test(fichier.type)) throw new Error('Choisissez une image.');
    const bmp = await createImageBitmap(fichier).catch(() => { throw new Error('Cette image ne peut pas être lue. Essayez en JPEG.'); });
    const c = Math.min(bmp.width, bmp.height);
    const canevas = document.createElement('canvas');
    canevas.width = canevas.height = Math.min(cote, c);
    canevas.getContext('2d').drawImage(bmp, (bmp.width - c) / 2, (bmp.height - c) / 2, c, c, 0, 0, canevas.width, canevas.height);
    return Sha.exporter(canevas, 0.9);
  }

  async function vueReglages(zone) {
    let r;
    try { r = await api('GET', '/api/sha/reglages'); } catch (e) { return gererErreur(e); }
    const ok = el('p', { class: 'notice notice--ok', role: 'status', hidden: true }, 'Enregistré. Le site est à jour.');
    const erreur = el('p', { class: 'field-error', role: 'alert' });
    const ch = (nom, libelle, attrs = {}, aide) => champ(libelle, { name: nom, id: 'r-' + nom, valeur: r[nom] || '', ...attrs }, aide);

    // Photo de profil : enregistrée dès qu'elle est choisie
    const medaillon = el('div', { class: 'profil-apercu' });
    const dessinerProfil = () => medaillon.replaceChildren(r.profil
      ? el('img', { class: 'brand-avatar', src: r.profil, alt: 'Photo de profil actuelle' })
      : el('span', { class: 'brand-avatar avatar-lettre', 'aria-hidden': 'true' }, (r.nom || 'S').charAt(0)));
    const choixProfil = el('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'r-profil' });
    const retirer = el('button', { type: 'button', class: 'lien-discret', hidden: !r.profil, onclick: async () => {
      try { r = await api('DELETE', '/api/sha/profil'); dessinerProfil(); retirer.hidden = true; avis('Photo de profil retirée.', 'info'); } catch (e) { gererErreur(e); }
    } }, 'Retirer la photo');
    choixProfil.addEventListener('change', async () => {
      if (!choixProfil.files[0]) return;
      try {
        r = await api('POST', '/api/sha/profil', { image: await photoCarree(choixProfil.files[0]) });
        dessinerProfil();
        retirer.hidden = false;
        avis('Photo de profil enregistrée.', 'info');
      } catch (e) { gererErreur(e); }
      choixProfil.value = '';
    });
    dessinerProfil();

    const form = el('form', { class: 'formulaire reglages' },
      el('fieldset', {}, el('legend', {}, 'Photo de profil'),
        el('div', { class: 'profil' }, medaillon,
          el('div', { class: 'profil-actions' },
            el('label', { class: 'btn btn--small', for: 'r-profil' }, el('span', {}, 'Choisir une photo'), icone('image')), choixProfil, retirer,
            el('p', { class: 'field-hint' }, 'Elle s’affiche en médaillon rond, cerclée de violet, à côté du nom du salon.')))),
      el('fieldset', {}, el('legend', {}, 'La une'),
        ch('nom', 'Nom du salon', { required: true, maxlength: 60 }),
        ch('titreUne', 'Gros titre', { maxlength: 80 }, 'Une barre oblique sépare les lignes ; des mots entre tirets bas s’écrivent en italique violet : Votre tatouage, / _sur mesure_'),
        ch('presentation', 'Article de la une', { rows: 6, maxlength: 1500 }, 'Un paragraphe par ligne.'),
        ch('specialites', 'La carte : vos spécialités', { rows: 5, maxlength: 800 }, 'Une spécialité par ligne.')),
      el('fieldset', {}, el('legend', {}, 'Adresse et contact'),
        ch('adresse', 'Adresse', { maxlength: 120, autocomplete: 'street-address' }),
        el('div', { class: 'deux' }, ch('codePostal', 'Code postal', { maxlength: 10, inputmode: 'numeric' }), ch('ville', 'Ville', { maxlength: 80 })),
        el('div', { class: 'deux' }, ch('telephone', 'Téléphone', { type: 'tel', maxlength: 30 }), ch('email', 'E-mail', { type: 'email', maxlength: 120 })),
        ch('instagram', 'Instagram', { maxlength: 120, placeholder: '@sha_tatt00' }),
        ch('tiktok', 'TikTok', { maxlength: 120, placeholder: '@sha22.10' }),
        ch('facebook', 'Facebook', { maxlength: 160, placeholder: 'Adresse de la page' })),
      el('fieldset', {}, el('legend', {}, 'Vidéos TikTok'),
        ch('videos', 'Liens des vidéos', { rows: 5, maxlength: 2000, placeholder: 'https://www.tiktok.com/@sha22.10/video/…', spellcheck: 'false' },
          'Un lien par ligne, 8 au plus. La première s’affiche à la une, en grand ; les autres plus bas. Sur TikTok : « Partager » puis « Copier le lien ».')),
      el('fieldset', {}, el('legend', {}, 'Horaires'),
        el('p', { class: 'field-hint' }, 'Écrivez par exemple « 9h-12h30 / 13h30-17h ». Laissez vide pour « fermé ».'),
        el('div', { class: 'horaires' }, JOURS.map(([j, nom]) => el('div', { class: 'horaire' },
          el('label', { for: 'r-h' + j }, nom),
          el('input', { id: 'r-h' + j, name: 'h' + j, value: (r['h' + j] || '').replace(/:00\b/g, 'h').replace(/:(\d\d)/g, 'h$1').replace(/\b0(\d)h/g, '$1h'), placeholder: 'Fermé', maxlength: 80 }))))),
      el('fieldset', {}, el('legend', {}, 'Acompte'),
        ch('paypal', 'Lien PayPal.me', { maxlength: 120, placeholder: 'paypal.me/votrenom' }, 'Avec un devis, le client arrive sur PayPal avec le montant exact de l’acompte ; le lien est aussi en bas de chaque page. Vide : PayPal n’est pas proposé.'),
        ch('wero', 'Numéro Wero', { maxlength: 40, placeholder: '06 12 34 56 78' }, 'Montré seulement aux clients qui ont un acompte à régler. Vide : Wero n’est pas proposé.'),
        ch('conditionsAcompte', 'Conditions de l’acompte', { rows: 3, maxlength: 600 })),
      el('fieldset', {}, el('legend', {}, 'Accès à votre espace'),
        ch('identifiant', 'Identifiant', { maxlength: 40, autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' }),
        champ('Nouveau mot de passe (facultatif)', { name: 'nouveauMotDePasse', id: 'r-mdp', type: 'password', autocomplete: 'new-password', minlength: 10 }, '10 caractères minimum. Laissez vide pour ne rien changer.'),
        champ('Mot de passe actuel', { name: 'motDePasseActuel', id: 'r-mdp-actuel', type: 'password', autocomplete: 'current-password' }, 'Demandé seulement pour changer l’identifiant ou le mot de passe.')),
      erreur, ok,
      bouton('Enregistrer', { type: 'submit', class: 'btn--accent' }, 'check'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ok.hidden = true;
      erreur.textContent = '';
      const envoi = form.querySelector('[type=submit]');
      envoi.classList.add('occupe');
      try {
        r = await api('POST', '/api/sha/reglages', Object.fromEntries(new FormData(form)));
        form.querySelector('#r-mdp').value = '';
        form.querySelector('#r-mdp-actuel').value = '';
        ok.hidden = false;
      } catch (err) {
        erreur.textContent = err.message;
        erreur.scrollIntoView({ block: 'center' });
      }
      envoi.classList.remove('occupe');
    });
    zone.append(el('div', { class: 'page' }, el('h1', { class: 'page-titre' }, 'Réglages'), form));
  }

  demarrer();
})();
