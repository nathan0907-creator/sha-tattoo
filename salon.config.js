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
    instagram: 'https://www.instagram.com/sha_tatt00/',
    facebook: 'https://www.facebook.com/p/Sha-tattoo-61550087068470/',
  },

  // Même bâtiment que L'atelier de Cyrille.
  address: {
    street: '9 Route de Lille',
    postalCode: '62218',
    city: 'Loison-sous-Lens',
  },

  // La photo de profil (médaillon rond cerclé de violet, à côté du nom du salon).
  avatar: '/img/profil.webp',

  // La grande photo de la une (sinon, la dernière réalisation publiée).
  photoUne: { src: '/img/une.webp', alt: 'Jambe : pivoines, cœur, roses et lettrage en traits fins', ratio: '3/4', width: 337, height: 547 },

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

  // La carte : les spécialités du salon (les prix sont donnés dans le devis).
  // Shannon complète la liste elle-même (espace salon, Réglages → La carte).
  specialties: ['Trait fin'],

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
