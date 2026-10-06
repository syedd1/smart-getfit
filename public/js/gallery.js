// Gallery: Photos/Videos filter, lightbox dialog, and play-when-visible video tiles.
(() => {
  'use strict';

  const grid = document.querySelector('[data-gallery]');
  if (!grid) return;

  const items = [...grid.querySelectorAll('.gitem')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection?.saveData === true;

  // ── Filter (All / Photos / Videos) ───────────────────────────────────
  const tabs = [...document.querySelectorAll('[data-gtab]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const kind = tab.dataset.gtab;
      for (const t of tabs) t.setAttribute('aria-pressed', String(t === tab));
      grid.classList.toggle('is-filtered', kind !== 'all');
      for (const item of items) item.hidden = kind !== 'all' && item.dataset.kind !== kind;
    });
  }

  // ── Video tiles: load and play only while on screen ──────────────────
  const videos = [...grid.querySelectorAll('video[data-src]')];
  if (reduceMotion || saveData || !('IntersectionObserver' in window)) {
    // No autoplay: give the visitor controls and load nothing until they press play.
    for (const v of videos) { v.controls = true; v.src = v.dataset.src; }
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const { target: v, isIntersecting } of entries) {
        if (isIntersecting) {
          if (!v.src) v.src = v.dataset.src;
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      }
    }, { threshold: 0.25 });
    for (const v of videos) io.observe(v);
  }

  // ── Lightbox ─────────────────────────────────────────────────────────
  const box = document.querySelector('[data-lightbox]');
  if (!box) return;
  const boxImg = box.querySelector('[data-lb-img]');
  const boxVideo = box.querySelector('[data-lb-video]');
  const boxLabel = box.querySelector('[data-lb-label]');
  const boxKind = box.querySelector('[data-lb-kind]');
  let index = 0;

  function show(i) {
    index = (i + items.length) % items.length;
    const item = items[index];
    const isVideo = item.dataset.kind === 'video';
    boxLabel.textContent = item.dataset.label;
    boxKind.textContent = isVideo ? 'Video' : 'Photo';
    box.setAttribute('aria-label', item.dataset.label);
    boxVideo.pause();
    boxImg.hidden = isVideo;
    boxVideo.hidden = !isVideo;
    if (isVideo) {
      boxVideo.poster = item.dataset.full;
      if (boxVideo.getAttribute('src') !== item.dataset.video) boxVideo.src = item.dataset.video;
      if (!reduceMotion) boxVideo.play().catch(() => {});
    } else {
      boxImg.src = item.dataset.full;
      boxImg.alt = item.querySelector('img')?.alt || '';
    }
  }

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lb]');
    if (!btn) return;
    show(Number(btn.dataset.lb));
    box.showModal();
  });
  box.addEventListener('click', (e) => {
    const step = e.target.closest('[data-lb-step]');
    if (step) show(index + Number(step.dataset.lbStep));
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
  box.addEventListener('close', () => boxVideo.pause());
})();
