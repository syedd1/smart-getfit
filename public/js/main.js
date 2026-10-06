// Site-wide behaviour: mobile menu, dialog close buttons, scroll reveals,
// parallax and mouse drag-to-scroll on rails. No inline handlers (strict CSP).
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileLayout = window.matchMedia('(max-width: 1023px)');

  // Any [data-close] button closes the <dialog> it sits in.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-close]');
    if (btn) btn.closest('dialog')?.close();
  });

  // ── Mobile menu ──────────────────────────────────────────────────────
  const menu = document.getElementById('menu');
  const menuBtn = document.querySelector('[data-open-menu]');
  if (menu && menuBtn) {
    menuBtn.addEventListener('click', () => {
      menu.showModal();
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    menu.addEventListener('close', () => menuBtn.setAttribute('aria-expanded', 'false'));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) menu.close(); });
    mobileLayout.addEventListener('change', (e) => { if (!e.matches && menu.open) menu.close(); });
  }

  // ── Scroll reveals (mobile layout, as in the design) ─────────────────
  // Only elements still below the fold are hidden, so nothing visible ever flashes.
  if (mobileLayout.matches && !reduceMotion.matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        entry.target.classList.remove('is-pending');
        io.unobserve(entry.target);
      }
    }, { threshold: 0.12 });
    // Measure everything first, then change classes: interleaving the two would force a
    // full layout recalculation per element.
    const below = [...document.querySelectorAll('[data-reveal]')]
      .filter((el) => el.getBoundingClientRect().top > window.innerHeight);
    for (const el of below) {
      el.classList.add('is-pending');
      io.observe(el);
    }
  }

  // ── Parallax on mobile hero and snacks banner ────────────────────────
  const layers = [...document.querySelectorAll('[data-parallax]')];
  if (layers.length && !reduceMotion.matches) {
    let queued = false;
    const update = () => {
      queued = false;
      if (!mobileLayout.matches) {
        for (const layer of layers) layer.style.transform = '';
        return;
      }
      // All reads, then all writes (see above).
      const tops = layers.map((layer) => layer.parentElement.getBoundingClientRect().top);
      layers.forEach((layer, i) => {
        const shift = Math.max(-36, Math.min(36, -tops[i] * 0.14));
        layer.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
      });
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', queue, { passive: true });
    mobileLayout.addEventListener('change', queue);
    update();
  }

  // ── Mouse drag-to-scroll on horizontal rails ─────────────────────────
  for (const rail of document.querySelectorAll('.rail')) {
    rail.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (rail.scrollWidth <= rail.clientWidth + 4) return;
      const startX = e.clientX;
      const startLeft = rail.scrollLeft;
      let moved = false;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) > 5) { moved = true; rail.classList.add('is-dragging'); }
        if (moved) rail.scrollLeft = startLeft - dx;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        rail.classList.remove('is-dragging');
        if (moved) {
          // Swallow the click that ends a drag so cards don't open.
          const kill = (c) => { c.stopPropagation(); c.preventDefault(); };
          rail.addEventListener('click', kill, { capture: true, once: true });
          setTimeout(() => rail.removeEventListener('click', kill, { capture: true }), 50);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // ── Slider arrow buttons ([data-scroll] + aria-controls) ─────────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scroll]');
    if (!btn) return;
    const track = document.getElementById(btn.getAttribute('aria-controls'));
    if (!track) return;
    track.scrollBy({
      left: Number(btn.dataset.scroll) * track.clientWidth * 0.75,
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
    });
  });
})();
