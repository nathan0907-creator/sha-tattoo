# Sha Tattoo

Le site de Sha Tattoo, tatoueuse à Loison-sous-Lens : la une, la carte, les flashs, les photos,
les animations tatouage (événements), la prise de rendez-vous par message (devis, créneau,
acompte) et l'espace de la tatoueuse (`/salon`).

Le site s'installe comme une application (téléphone, tablette, ordinateur) et prévient par
notification : la tatoueuse à chaque message d'un client, le client à chaque réponse.

## Sur l'ordinateur

```
npm start          # http://localhost:3100  (espace salon : /salon)
npm test           # les tests
```

Node.js 22 ou plus, aucune dépendance. Les données sont dans `data/` (jamais publié sur GitHub).
À la première ouverture de `/salon`, le code de configuration est dans
`data/CODE-DE-CONFIGURATION.txt`.

## Mettre le site en ligne (GitHub → Cloudflare)

Le site tourne sur Cloudflare (Worker + base SQLite d'un « Durable Object »), comme celui de
L'atelier de Cyrille. Une fois branché, **chaque envoi sur la branche `main` de GitHub met le site
à jour tout seul**. La formule gratuite de Cloudflare suffit.

1. **Le compte Cloudflare** — de préférence au nom de Shannon (c'est elle qui paiera le nom de
   domaine, si elle en prend un). Elle peut inviter quelqu'un pour s'en occuper :
   *Manage Account → Members → Invite*.
2. **Brancher GitHub** — dans Cloudflare : *Workers & Pages → Create → Import a repository →
   GitHub*. Autoriser Cloudflare à lire le dépôt `sha-tattoo`, puis :
   - nom du projet : `sha-tattoo` ;
   - branche de production : `main` ;
   - commande de build : laisser vide ; commande de déploiement : `npx wrangler deploy`.
   La configuration est lue dans `wrangler.jsonc`.
3. **Le code de première connexion** — dans le Worker *sha-tattoo* : *Settings → Variables and
   Secrets → Add*, type **Secret**, nom `SETUP_CODE`, valeur au choix (par exemple 8 chiffres :
   `2741-5093`). Puis *Deployments → Redeploy*. Ne jamais l'écrire dans le dépôt.
4. **Première connexion** — ouvrir `https://sha-tattoo.<compte>.workers.dev/salon`, saisir le
   code, choisir l'identifiant et le mot de passe. Le code ne sert plus ensuite.
5. **Les notifications** — sur le téléphone de Shannon, ouvrir `/salon`, toucher la cloche,
   *Activer les notifications*, puis *Envoyer un essai*.
   Sur iPhone : d'abord *Partager → Sur l'écran d'accueil*, ouvrir l'application ainsi
   installée, puis activer les notifications (Apple ne les permet que dans ce cas).
6. **Un nom de domaine** (facultatif) — l'acheter dans Cloudflare (*Domain Registration*), puis
   décommenter `routes` dans `wrangler.jsonc` et remplir `siteUrl` dans `salon.config.js`.

Les données en ligne (comptes, messages, photos déposées) sont séparées de celles de
l'ordinateur. Le journal des erreurs est visible dans Cloudflare (*Workers → sha-tattoo → Logs*).

### Essayer la version Cloudflare sur l'ordinateur

```
npx wrangler dev
```

avec un fichier `.dev.vars` (jamais publié) contenant `SETUP_CODE=1234-5678`.

## La démonstration

Une copie fixe des pages publiques est publiée sur GitHub Pages à chaque envoi
(`.github/workflows/demo.yml`) : https://nathan0907-creator.github.io/sha-tattoo/
