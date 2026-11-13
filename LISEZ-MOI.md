# Sha Tattoo — le site

Le site de Sha Tattoo reprend la gazette de L'atelier de Cyrille (mêmes pages, même mise en page,
mêmes polices), avec la palette de la carte cadeau du salon et ce qui est propre au tatouage :

- **pas de réservation en ligne** : « Les rendez-vous se prennent par message » ;
- **la messagerie** : un assistant demande une photo de l'emplacement, l'image de référence et une
  description, puis envoie la demande. Le compte (téléphone, nom, prénom, date de naissance, e-mail
  facultatif) est demandé au moment d'envoyer ;
- **le devis, puis le créneau** choisi par la tatoueuse, puis **l'acompte** (PayPal, Wero ou au salon) :
  le rendez-vous est confirmé quand elle a reçu l'acompte ;
- **photos et flashs** publiés par la tatoueuse depuis son espace.

## Lancer le site

Double-cliquer sur **Ouvrir le site.bat** (ou `npm start`). Le site s'ouvre sur http://localhost:3100.
Garder la fenêtre noire ouverte : la fermer arrête le site. Ne pas la lancer deux fois.

## L'espace de la tatoueuse

Adresse du site + `/salon`. À la première connexion, saisir le code noté dans
`data/CODE-DE-CONFIGURATION.txt`, puis choisir son identifiant et son mot de passe (10 caractères
minimum). Ensuite, on se connecte avec eux. Pour les changer : onglet Réglages (mot de passe actuel
demandé). En cas d'oubli : site arrêté, `npm run reinitialiser-acces`, puis relancer le site.

- **Demandes** : les messages, le devis, le créneau, l'acompte reçu ; « Nouveau rendez-vous pour ce
  client » pour une retouche ou une suite.
- **Agenda** : les rendez-vous à venir ; « Ajouter un rendez-vous » pour un petit créneau, avec ou
  sans compte client, durée choisie librement, acompte facultatif.
- **Fermetures** : congés, ouvertures et horaires exceptionnels ; jours fériés fermés d'office, à
  ouvrir un par un si besoin. Tout s'annonce sur le site.
- **Photos & flashs** : jusqu'à 12 images à la fois ; elles paraissent tout de suite sur le site.
- **Réglages** : photo de profil (le médaillon cerclé de violet), gros titre et article de la une,
  spécialités, adresse et contact, horaires, PayPal et Wero, mot de passe.

## Où sont les choses

- `salon.config.js` : les informations de départ du salon (adresse, téléphone, horaires, spécialités).
  Ce qui est modifié dans l'onglet Réglages passe avant.
- `src/views/` : les pages (reprises de Cyrille). `public/css/base.css` et `pages.css` : la gazette ;
  `messages.css` : la messagerie, les flashs, la photo de profil ; `sha.css` : l'espace salon.
- `data/` : les comptes, les demandes et les images (jamais envoyé sur GitHub).
- `npm test` : vérifie le parcours complet et les pages.

## Avant la mise en ligne

- Compléter les mentions légales dans `salon.config.js` (statut, SIRET, responsable, hébergeur).
- Le site écrit dans des fichiers (`data/`) : il faudra l'adapter pour un hébergement comme celui de
  Cyrille (Cloudflare), où rien ne s'écrit sur disque.
