// Catalogue: category + brand filtering, counts, empty state, and the mobile product sheet.
// Product cards are already in the HTML; this script only shows/hides them.
(() => {
  'use strict';

  const track = document.getElementById('catalogue-track');
  if (!track) return;

  const cards = [...track.querySelectorAll('.pcard')];
  const chips = [...document.querySelectorAll('.chips [data-filter]')];
  const tiles = [...document.querySelectorAll('.ctile[data-filter]')];
  const brandSelect = document.querySelector('[data-brand-filter]');
  const countD = document.querySelector('[data-count]');
  const countM = document.querySelector('[data-count-m]');
  const empty = document.querySelector('[data-empty]');
  const mobileLayout = window.matchMedia('(max-width: 1023px)');

  const labelFor = (slug) => chips.find((c) => c.dataset.filter === slug)?.textContent.trim() || slug;
  const state = { cat: 'all', brand: '' };

  function apply() {
    let shown = 0;
    for (const card of cards) {
      const visible = (state.cat === 'all' || card.dataset.cat === state.cat)
        && (!state.brand || card.dataset.brand === state.brand);
      card.hidden = !visible;
      if (visible) {
        shown += 1;
        const num = card.querySelector('.pcard__num');
        if (num) num.textContent = String(shown).padStart(2, '0');
      }
    }
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.cat));
    for (const tile of tiles) {
      if (tile.dataset.filter === state.cat) tile.setAttribute('aria-current', 'true');
      else tile.removeAttribute('aria-current');
    }
    if (brandSelect) brandSelect.value = state.brand;

    let label = `${shown} product${shown === 1 ? '' : 's'}`;
    if (state.cat !== 'all') label += ` in ${labelFor(state.cat)}`;
    if (state.brand) label += ` · ${state.brand}`;
    if (countD) countD.textContent = label;
    if (countM) countM.textContent = `${shown} item${shown === 1 ? '' : 's'}`;
    if (empty) empty.hidden = shown > 0;
    track.scrollLeft = 0;
  }

  function setCategory(cat, resetBrand) {
    state.cat = cat;
    if (resetBrand) state.brand = '';
    apply();
  }

  for (const chip of chips) chip.addEventListener('click', () => setCategory(chip.dataset.filter, false));

  // Category tiles and "Explore Snacks" are links to #products: filter, then let the link scroll.
  for (const link of document.querySelectorAll('a[data-filter]')) {
    link.addEventListener('click', () => setCategory(link.dataset.filter, true));
  }

  brandSelect?.addEventListener('change', () => { state.brand = brandSelect.value; apply(); });

  // ── Mobile product sheet ─────────────────────────────────────────────
  const dialog = document.querySelector('[data-product-dialog]');
  const dataEl = document.getElementById('catalogue-data');
  let catalogue = {};
  try { catalogue = JSON.parse(dataEl?.textContent || '{}'); } catch { catalogue = {}; }

  function openSheet(id) {
    const p = catalogue[id];
    if (!dialog || !p) return false;
    const field = (name) => dialog.querySelector(`[data-pd="${name}"]`);
    const image = field('img');
    image.src = p.img;
    image.alt = p.alt;
    field('brand').textContent = p.brand;
    field('name').textContent = p.name;
    field('cat').textContent = p.cat;
    field('size').textContent = p.size;
    field('availLabel').textContent = p.avail ? 'In stock at the store' : 'Currently Unavailable';
    field('avail').classList.toggle('avail--no', !p.avail);
    field('desc').textContent = p.desc;
    field('wa').href = p.wa;
    field('waAbout').href = p.waAbout;
    dialog.showModal();
    dialog.querySelector('.pdialog__scroll').scrollTop = 0;
    return true;
  }

  // On the mobile layout "+" / image / "Know More" open the sheet; on desktop they navigate.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-detail]');
    if (!link || !mobileLayout.matches || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (openSheet(link.dataset.detail)) e.preventDefault();
  });
})();
