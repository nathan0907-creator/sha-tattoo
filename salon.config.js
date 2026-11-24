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
    'Sha Tattoo, tatoueuse à Loison-sous-Lens, près de Lens : spécialiste fineline, floral, ornemental, black & grey, et flashs. Uniquement sur rendez-vous, après devis.',

  // Le gros titre de la une, ligne par ligne. Un mot entre _tirets bas_ est écrit en cursive.
  headline: ['Votre tatouage,', '_sur mesure_'],

  // Adresse publique du site : le nom de domaine de Shannon (15 novembre 2026 ; « routes » dans
  // wrangler.jsonc). L'ancienne adresse sha-tattoo.plantefevenathan.workers.dev, « www. » et la
  // démonstration GitHub Pages renvoient ici.
  siteUrl: 'https://shatattoo.com',

  // L'expéditeur des e-mails (rappels de la veille) : une adresse du nom de domaine. Les réponses
  // vont à l'adresse de Shannon (Réglages → Rappels). Envoi : voir src/email.js et le README.
  emailExpediteur: 'Sha Tattoo <rappel@shatattoo.com>',

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
  // Ce sont les valeurs de départ : Shannon les change toutes dans son espace (Réglages → Événements).
  evenements: {
    chapeau: 'Une animation tatouage le jour de votre événement privé : une expérience originale et personnalisée, que vos invités gardent pour toujours.',
    pour: ['Mariages', 'Anniversaires', 'Autres événements privés'],
    // Le tarif, découpé pour l'afficher en grand : « Devis à partir de | 400 à 500 € | minimum ».
    prix: { avant: 'Devis à partir de', montant: '400 à 500 €', apres: 'minimum' },
    // Sous le tarif, une ligne chacun. (Premier message de Shannon : « tarification sur devis, à l'heure ».)
    reperes: [
      'Sur devis, à l’heure.',
      'Tarif variable selon le déplacement et le nombre d’heures.',
      'Maximum de 4 tatouages par heure.',
    ],
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
  // Le 15 novembre 2026, agrandies et rendues plus nettes (elles faisaient 226 à 566 pixels de large),
  // puis refaites par IA (Real-ESRGAN, modèle « dessin », choix de l’utilisateur) : suffixe -ia.
  // Ajoutées une seule fois à la galerie : Shannon les renomme, les marque « déjà tatoué » ou les
  // retire ensuite depuis son espace, comme celles qu'elle publie elle-même.
  flashsDepart: [
    ['flash-01-ia.webp', 'Fleurs de naissance, juillet à décembre', 1130, 1600],
    ['flash-02-ia.webp', 'Bouquet fleuri', 1130, 1600],
    ['flash-03-ia.webp', 'Léopard et fleurs', 1130, 1600],
    ['flash-04-ia.webp', 'Super-héros', 1130, 1600],
    ['flash-05-ia.webp', 'Lys en traits fins', 1130, 1600],
    ['flash-06-ia.webp', 'Personnages de dessins animés', 1130, 1600],
    ['flash-07-ia.webp', 'Joker', 1130, 1600],
    ['flash-08-ia.webp', 'Fées', 1130, 1600],
    ['flash-09-ia.webp', 'Ornements fins', 1130, 1600],
    ['flash-10-ia.webp', 'Ornements et lettrages', 1130, 1600],
    ['flash-11-ia.webp', 'Petits motifs', 1130, 1600],
    ['flash-12-ia.webp', 'Fleurs de naissance, janvier à juin', 1130, 1600],
    ['flash-13-ia.webp', 'Ornements', 1130, 1600],
    ['flash-14-ia.webp', 'Fleurs et océan', 1130, 1600],
    ['flash-15-ia.webp', 'Mandala', 1130, 1600],
    ['flash-16-ia.webp', 'Branche ornementale', 1130, 1600],
    ['flash-17-ia.webp', 'Branche fine', 1132, 1600],
    ['flash-18-ia.webp', 'Petits motifs et lettrages', 1130, 1600],
    ['flash-19-ia.webp', 'Ornement solaire', 1130, 1600],
    ['flash-20-ia.webp', 'Venom', 1130, 1600],
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
  // Message de Shannon (14 novembre 2026) : ouverte du lundi au samedi ; fermée seulement le mercredi
  // matin (hors vacances scolaires) et le samedi après 15 h (en général). Le lundi reprend les
  // horaires du mardi (heures à confirmer par Shannon).
  // 15 novembre 2026 : 9 h 30 au lieu de 9 h (et de 10 h le samedi) — lundi, mardi, jeudi, vendredi, samedi.
  hours: {
    1: [['09:30', '12:30'], ['13:30', '17:00']],
    2: [['09:30', '12:30'], ['13:30', '17:00']],
    3: [['13:30', '18:00']],
    4: [['09:30', '12:30'], ['13:30', '17:00']],
    5: [['09:30', '12:30'], ['13:00', '17:00']],
    6: [['09:30', '12:30'], ['13:30', '15:00']],
    0: [],
  },
  // Sous le tableau des horaires, une phrase par ligne. Les mots « l’agenda » deviennent un lien vers l'agenda.
  hoursNote: [
    'Horaires pouvant varier, car c’est uniquement sur rendez-vous : pensez à regarder l’agenda pour voir quand je suis au salon.',
    'Mercredi matin : ouvert pendant les vacances scolaires. Samedi : en général jusqu’à 15 h.',
  ],

  // Fermetures et horaires exceptionnels donnés par Shannon : ajoutés une fois au calendrier (elle
  // les modifie ensuite dans son espace, onglet Fermetures). « cle » : pour ne jamais les ajouter deux fois.
  fermetures: [
    { cle: 'noel-2026-a', type: 'horaires', du: '2026-12-24', horaires: '9h30-12h30', motif: 'fêtes de fin d’année, fermé à partir de 13 h 30' },
    { cle: 'noel-2026-b', type: 'fermeture', du: '2026-12-25', au: '2026-12-29', motif: 'fêtes de fin d’année' },
    { cle: 'noel-2026-c', type: 'horaires', du: '2026-12-30', horaires: '13h-18h', motif: 'réouverture à 13 h' },
    { cle: 'noel-2026-d', type: 'horaires', du: '2026-12-31', horaires: '9h30-12h30 / 13h30-14h15', motif: 'fermé à partir de 14 h 15' },
    // « jusqu'au 06/12 après-midi » : compris comme le 6 janvier 2027 (mercredi : réouverture l'après-midi).
    { cle: 'noel-2026-e', type: 'fermeture', du: '2027-01-01', au: '2027-01-05', motif: 'fêtes de fin d’année' },
  ],

  booking: {
    appointmentOnly: 'Uniquement sur rendez-vous',
    rule: 'Un acompte est demandé pour chaque rendez-vous.',
  },

  // La carte : les spécialités du salon, telles que Shannon les a données (les prix sont dans le devis).
  // Elle peut changer la liste elle-même (espace salon, Réglages → La carte).
  // Message de Shannon (14 novembre 2026) : « Spécialiste fineline, floral, ornemental, black & grey ».
  specialties: ['Fineline', 'Floral', 'Ornemental', 'Black & grey'],
  // La ligne sous le nom du salon, sur la une.
  style: 'Spécialiste fineline · floral · ornemental · black & grey',

  // La présentation des flashs (page Les flashs et La carte).
  flashIntro: 'Des projets dessinés de A à Z au salon. Ils ne sont pas faits à la demande, mais peuvent être modifiés et placés sur la zone de votre choix. Chaque pièce n’est réalisée qu’une seule fois.',

  // Texte de présentation de la une, un paragraphe par ligne (modifiable depuis l'espace salon).
  about: {
    paragraphs: [
      "Traits fins, noir et blanc, ombrages, motifs floraux et lettrages : chaque tatouage commence par une conversation. Vous racontez votre idée, l'emplacement, la taille ; la pièce est dessinée pour vous.",
      "Les flashs, eux, sont dessinés de A à Z au salon. Ils peuvent être modifiés et placés sur la zone de votre choix, et chaque pièce n'est réalisée qu'une seule fois.",
    ],
  },

  // Mentions légales : Shannon complète le statut, le SIRET et le responsable dans son espace
  // (Réglages → Mentions légales). L'hébergeur est connu : le site est en ligne chez Cloudflare.
  legal: {
    status: '',
    // Donné le 15 novembre 2026 (clé de contrôle vérifiée).
    siret: '924 357 742 00015',
    publisher: '',
    host: 'Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis (cloudflare.com)',
  },
};
