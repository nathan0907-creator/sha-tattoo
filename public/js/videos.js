'use strict';
// Vidéos TikTok : rien n'est chargé depuis TikTok avant le clic. Le bouton lecture remplace la
// vignette par le lecteur officiel de TikTok, au même format (vertical).
(() => {
  document.addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-tiktok-play]');
    if (!bouton) return;
    const cadre = bouton.closest('[data-tiktok]');
    const id = cadre && cadre.dataset.tiktok;
    if (!/^\d{8,25}$/.test(id || '')) return;
    const lecteur = document.createElement('iframe');
    lecteur.src = `https://www.tiktok.com/player/v1/${id}?autoplay=1&description=0&music_info=0&rel=0&native_context_menu=0&closed_caption=0`;
    lecteur.title = bouton.getAttribute('aria-label') || 'Vidéo TikTok';
    lecteur.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    lecteur.referrerPolicy = 'strict-origin-when-cross-origin';
    cadre.classList.add('is-playing');
    bouton.replaceWith(lecteur);
    lecteur.focus();
  });
})();
