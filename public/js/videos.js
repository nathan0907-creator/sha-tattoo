'use strict';
// Les vidéos : un clic sur la vignette lance la lecture.
//   [data-video]  : la vidéo est sur le site (MP4) : elle se lit sur place, avec le son et les commandes ;
//   [data-tiktok] : à défaut de fichier, le lecteur officiel de TikTok se charge, au même format.
// Une seule vidéo joue à la fois.
(() => {
  const toutes = () => document.querySelectorAll('[data-video] video');

  document.addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-video-play]');
    if (!bouton) return;
    const cadre = bouton.closest('[data-video], [data-tiktok]');
    if (!cadre) return;

    const video = cadre.querySelector('video');
    if (video) {
      for (const autre of toutes()) if (autre !== video) autre.pause();
      video.controls = true;
      cadre.classList.add('is-playing');
      bouton.remove();
      video.play().catch(() => {});
      video.focus();
      return;
    }

    const id = cadre.dataset.tiktok;
    if (!/^\d{8,25}$/.test(id || '')) return;
    const lecteur = document.createElement('iframe');
    lecteur.src = `https://www.tiktok.com/player/v1/${id}?autoplay=1&description=0&music_info=0&rel=0&native_context_menu=0&closed_caption=0`;
    lecteur.title = bouton.getAttribute('aria-label') || 'Vidéo';
    lecteur.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    lecteur.referrerPolicy = 'strict-origin-when-cross-origin';
    cadre.classList.add('is-playing');
    bouton.replaceWith(lecteur);
    lecteur.focus();
  });

  // Une vidéo qui démarre met les autres en pause.
  document.addEventListener('play', (e) => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    for (const autre of toutes()) if (autre !== e.target) autre.pause();
  }, true);
})();
