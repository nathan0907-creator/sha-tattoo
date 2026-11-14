'use strict';

/**
 * Toutes les informations du salon sont ici. Ce que Shannon règle depuis son espace
 * (/salon, onglet Réglages) passe avant ces valeurs.
 *
 * ⚠ Les valeurs marquées « À COMPLÉTER » sont à renseigner avant la mise en ligne.
 */

module.exports = {
  name: 'Sha Tattoo',
  tagline: 'Tatoueuse',
  description:
    'Sha Tattoo, tatoueuse à Loison-sous-Lens, près de Lens : tatouages en traits fins, noir et blanc, floraux, lettrages et flashs. Uniquement sur rendez-vous, après devis.',

  // Le gros titre de la une, ligne par ligne. Un mot entre _tirets bas_ est écrit en cursive.
  headline: ['Votre tatouage,', '_sur mesure_'],

  // Adresse publique du site, une fois en ligne (laisser vide en attendant).
  siteUrl: '',

  seo: { nearby: ['Lens', 'Harnes', 'Noyelles-sous-Lens'] },

  // Coordonnées. Laissez vide ('') ce que le salon n'utilise pas : la ligne disparaît du site.
  contact: {
    phone: '06 50 81 15 32',
    email: '',
    instagram: 'https://www.instagram.com/sha_tatt00',
    facebook: 'https://www.facebook.com/share/1Hx7oW4nBN/',
    tiktok: 'https://www.tiktok.com/@sha22.10',
    // Lien PayPal.me : l'acompte (avec le montant exact) et le bouton « Payer par PayPal » du site.
    paypal: 'https://www.paypal.me/ShannonLouis641',
  },

  // Les vidéos TikTok du site, dans l'ordre d'affichage : la première est à la une (la plus likée
  // au 14 novembre 2026 : 323 j'aime), les autres plus bas. Shannon les change dans Réglages.
  videos: [
    { id: '7707336491780934944', titre: 'De la PMA au tattoo personnalisé' },
    { id: '7626117253783751958', titre: 'Joli dos floral' },
    { id: '7696216766401334561', titre: 'Une jolie lionne' },
    { id: '7686918937346460960', titre: 'Des fleurs et surtout de la fineline' },
  ].map((v) => ({ ...v, auteur: 'sha22.10', vignette: `/img/videos/${v.id}.jpg`, fichier: `/videos/${v.id}.mp4` })),

  // Animations tatouage à l'extérieur (page « Événements »). Uniquement ce que Shannon a dit :
  // rien n'est ajouté ici sans elle.
  evenements: {
    pour: ['Mariages', 'Anniversaires', 'Autres événements privés'],
    tarif: 'Devis à partir de 400 à 500 € minimum',
    // Le même tarif, découpé pour l'afficher en grand.
    prix: { avant: 'Devis à partir de', montant: '400 à 500 €', apres: 'minimum' },
    // Premier message de Shannon : « tarification sur devis, à l'heure ».
    facturation: 'Sur devis, à l’heure.',
    tarifDetail: 'Tarif variable selon le déplacement et le nombre d’heures.',
    rythme: 'Maximum de 4 tatouages par heure',
    fonctionnement: [
      'Possibilité de créer des planches de flash personnalisées pour l’événement.',
      'Les invités ne paient rien individuellement.',
      'Chaque invité doit simplement remplir un formulaire de consentement le jour de l’événement.',
    ],
  },

  // Même bâtiment que L'atelier de Cyrille.
  address: {
    street: '9 Route de Lille',
    postalCode: '62218',
    city: 'Loison-sous-Lens',
  },

  // La photo de profil (médaillon rond cerclé de violet, à côté du nom du salon).
  avatar: '/img/profil.webp',

  // Tant que Shannon n'a publié aucune réalisation, des images « exemple » tiennent la place :
  // la grande photo de la une, et quelques réalisations. Sa première photo publiée les remplace.
  photoUne: { src: '/img/exemples/une.svg', alt: 'Exemple : photo de la une, à changer', ratio: '3/4', width: 600, height: 800 },
  photosExemple: [1, 2, 3, 4, 5, 6].map((i) => ({
    src: `/img/exemples/realisation-${i}.svg`,
    alt: `Exemple : réalisation ${i}, à changer`,
    ratio: i % 3 === 1 ? '4/5' : i % 3 === 2 ? '1/1' : '3/4',
    width: i % 3 === 1 ? 640 : i % 3 === 2 ? 700 : 600,
    height: i % 3 === 2 ? 700 : 800,
  })),
  // Les planches de flashs de Shannon (dossier « photo », 14 novembre 2026), dans public/img/flashs.
  // Ajoutées une seule fois à la galerie : Shannon les renomme, les marque « déjà tatoué » ou les
  // retire ensuite depuis son espace, comme celles qu'elle publie elle-même.
  flashsDepart: [
    ['flash-01.jpg', 'Fleurs de naissance, juillet à décembre', 452, 640],
    ['flash-02.jpg', 'Bouquet fleuri', 226, 320],
    ['flash-03.jpg', 'Léopard et fleurs', 226, 320],
    ['flash-04.jpg', 'Super-héros', 339, 480],
    ['flash-05.jpg', 'Lys en traits fins', 452, 640],
    ['flash-06.jpg', 'Personnages de dessins animés', 339, 480],
    ['flash-07.jpg', 'Joker', 339, 480],
    ['flash-08.jpg', 'Fées', 452, 640],
    ['flash-09.jpg', 'Ornements fins', 452, 640],
    ['flash-10.jpg', 'Ornements et lettrages', 339, 480],
    ['flash-11.jpg', 'Petits motifs', 339, 480],
    ['flash-12.jpg', 'Fleurs de naissance, janvier à juin', 452, 640],
    ['flash-13.jpg', 'Ornements', 339, 480],
    ['flash-14.jpg', 'Fleurs et océan', 226, 320],
    ['flash-15.jpg', 'Mandala', 339, 480],
    ['flash-16.jpg', 'Branche ornementale', 339, 480],
    ['flash-17.jpg', 'Branche fine', 566, 800],
    ['flash-18.jpg', 'Petits motifs et lettrages', 339, 480],
    ['flash-19.jpg', 'Ornement solaire', 452, 640],
    ['flash-20.jpg', 'Venom', 226, 320],
  ].map(([fichier, titre, largeur, hauteur]) => ({ src: `/img/flashs/${fichier}`, titre, largeur, hauteur })),

  // Même chose pour la page des flashs : des planches « exemple » tant qu'aucune n'est publiée.
  flashsExemple: [1, 2, 3].map((i) => ({
    src: `/img/exemples/planche-${i}.svg`,
    alt: `Exemple : planche de flashs ${i}, à changer`,
    title: '',
    ratio: '3/4',
    width: 600,
    height: 800,
    exemple: true,
  })),

  timezone: 'Europe/Paris',

  // Horaires. 0 = dimanche, 1 = lundi … 6 = samedi.
  // Une journée peut avoir plusieurs plages (pause déjeuner). Tableau vide = fermé.
  hours: {
    1: [],
    2: [['09:00', '12:30'], ['13:30', '17:00']],
    3: [['13:30', '18:00']],
    4: [['09:00', '12:30'], ['13:30', '17:00']],
    5: [['09:00', '12:30'], ['13:00', '17:00']],
    6: [['10:00', '12:30'], ['13:30', '17:00']],
    0: [],
  },

  booking: {
    appointmentOnly: 'Uniquement sur rendez-vous',
    rule: 'Un acompte est demandé pour chaque rendez-vous.',
  },

  // La carte : les spécialités du salon, telles que Shannon les a données (les prix sont dans le devis).
  // Elle peut changer la liste elle-même (espace salon, Réglages → La carte).
  specialties: [
    'Tatouage en traits fins (fineline)',
    'Noir et blanc, ombrages',
    'Projets personnalisés, floraux et lettrages',
    'Strass dentaires et blanchiment',
  ],

  // Texte de présentation de la une, un paragraphe par ligne (modifiable depuis l'espace salon).
  about: {
    paragraphs: [
      "Traits fins, noir et blanc, ombrages, motifs floraux et lettrages : chaque tatouage commence par une conversation. Vous racontez votre idée, l'emplacement, la taille ; la pièce est dessinée pour vous.",
      "Les flashs, eux, sont dessinés de A à Z au salon. Ils peuvent être modifiés et placés sur la zone de votre choix, et chaque pièce n'est réalisée qu'une seule fois.",
    ],
  },

  // Mentions légales — À COMPLÉTER avant la mise en ligne.
  legal: {
    company: 'Sha Tattoo',
    status: '',
    siret: '',
    publisher: '',
    host: '',
  },
};
