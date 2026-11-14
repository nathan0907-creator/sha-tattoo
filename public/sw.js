// Le « service worker » de l'application Sha Tattoo : il reçoit les notifications de messages et
// les affiche, même quand le site est fermé sur l'appareil. Il ne met rien en cache : le site se
// charge toujours depuis le serveur, à jour.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Les adresses se lisent depuis le dossier du site : il peut être servi ailleurs qu'à la racine.
const dansLeSite = (chemin) => new URL(chemin.replace(/^\//, ''), self.registration.scope).href;

self.addEventListener('push', (event) => {
  let m = {};
  try {
    m = event.data.json();
  } catch { /* message illisible : notification sans détail */ }
  event.waitUntil(Promise.all([
    self.registration.showNotification(m.title || 'Sha Tattoo', {
      body: m.body || 'Nouveau message',
      icon: dansLeSite('img/icones/icone-192.png'),
      badge: dansLeSite('img/icones/pastille.png'),
      tag: m.tag || 'message',
      renotify: true,
      lang: 'fr',
      data: { url: m.url || '/' },
    }),
    // La pastille sur l'icône de l'application : le nombre de messages non lus.
    typeof m.badge === 'number' && self.navigator.setAppBadge
      ? (m.badge > 0 ? self.navigator.setAppBadge(m.badge) : self.navigator.clearAppBadge()).catch(() => {})
      : null,
  ]));
});

// Un appui sur la notification ouvre la conversation (ou la demande, dans l'espace salon).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const cible = dansLeSite((event.notification.data && event.notification.data.url) || '/');
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const salon = new URL(cible).pathname.startsWith(new URL(dansLeSite('salon')).pathname);
    // Une fenêtre du site déjà ouverte (du même côté : site ou espace salon) est réutilisée.
    const ouverte = fenetres.find((f) => new URL(f.url).pathname.startsWith(new URL(dansLeSite('salon')).pathname) === salon);
    if (ouverte) {
      await ouverte.focus();
      return ouverte.navigate ? ouverte.navigate(cible).catch(() => self.clients.openWindow(cible)) : null;
    }
    return self.clients.openWindow(cible);
  })());
});
