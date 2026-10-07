// Admin: photos and added products. Talks only to /api/admin (session cookie + CSRF
// header). All text from the server is inserted with textContent — never as HTML — so
// an alt text or product name can't inject markup.
(() => {
  'use strict';

  const SECTION_LABELS = {
    hero: ['Homepage hero', 'Big photo at the top of the homepage. The first one is used.'],
    banner: ['Healthy Snacks banner', 'Banner above the snacks on phones. The first one is used.'],
    gallery: ['Inside the Store gallery', 'All of these are shown, in this order (after the store video).'],
  };
  const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

  const state = {
    csrf: null,
    limits: { maxFileBytes: 8 * 1024 * 1024, maxFilesPerUpload: 10, uploadsPerHour: 30 },
    media: [],
    products: [], // built-in and added, from /api/admin/products
    categories: [],
    editing: null, // id of the added product open in the form, or null when adding
    pending: [], // { file, url, error }
    filter: 'all',
  };

  const $ = (selector) => document.querySelector(selector);
  const views = { login: $('[data-view="login"]'), app: $('[data-view="app"]') };

  // Small DOM builder: h('button', { class: 'btn', onclick: fn }, 'Text')
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  // ── Feedback ────────────────────────────────────────────────────────
  let toastTimer;
  function toast(message, isError = false) {
    const el = $('[data-toast]');
    el.textContent = message;
    el.classList.toggle('is-error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 3500);
  }
  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;

  // ── API ─────────────────────────────────────────────────────────────
  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.message) || 'Something went wrong. Please try again.');
      this.status = status;
      this.code = body && body.error;
      this.body = body;
    }
  }

  async function api(method, path, { json, form, retried = false } = {}) {
    const headers = {};
    if (method !== 'GET') headers['x-csrf-token'] = state.csrf || '';
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    let res;
    try {
      res = await fetch(`/api/admin${path}`, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      throw new ApiError(0, { message: 'Could not reach the server. Check your connection and try again.' });
    }
    let data = null;
    if (res.status !== 204) {
      try { data = await res.json(); } catch { data = null; }
    }
    if (res.status === 401 && path !== '/login') {
      showLogin('Your session has ended. Please log in again.');
      throw new ApiError(401, data);
    }
    // An old tab can hold a stale CSRF token: refresh it once and retry.
    if (res.status === 403 && data && data.error === 'csrf_failed' && !retried) {
      await refreshSession();
      return api(method, path, { json, form, retried: true });
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  // Uploads use XHR for a progress bar (fetch can't report upload progress).
  function sendUpload(path, form, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/admin${path}`);
      xhr.setRequestHeader('x-csrf-token', state.csrf || '');
      xhr.responseType = 'json';
      xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); });
      xhr.addEventListener('load', () => {
        if (xhr.status === 401) {
          showLogin('Your session has ended. Please log in again.');
          reject(new ApiError(401, xhr.response));
        } else if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(new ApiError(xhr.status, xhr.response));
        }
      });
      xhr.addEventListener('error', () => reject(new ApiError(0, { message: 'The upload was interrupted. Check your connection and try again.' })));
      xhr.send(form);
    });
  }

  async function refreshSession() {
    const info = await api('GET', '/session');
    applySession(info);
    return info;
  }

  function applySession(info) {
    state.csrf = info.csrfToken;
    if (info.limits) state.limits = info.limits;
    $('[data-limits]').textContent = `JPEG, PNG or WebP · up to ${mb(state.limits.maxFileBytes)} each · ${state.limits.uploadsPerHour} photos per hour`;
  }

  // ── Views ───────────────────────────────────────────────────────────
  function showLogin(message) {
    state.csrf = null;
    $('[data-boot]').hidden = true;
    views.app.hidden = true;
    views.login.hidden = false;
    $('[data-logout]').hidden = true;
    const msg = $('[data-login-message]');
    msg.textContent = message || '';
    msg.hidden = !message;
    const form = $('[data-login-form]');
    form.elements.password.value = '';
    (form.elements.username.value ? form.elements.password : form.elements.username).focus();
  }

  async function showApp() {
    $('[data-boot]').hidden = true;
    views.login.hidden = true;
    views.app.hidden = false;
    $('[data-logout]').hidden = false;
    await loadMedia();
  }

  // ── Login / logout ──────────────────────────────────────────────────
  $('[data-login-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username || !password) {
      showLogin('Enter your username and password.');
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      applySession(await api('POST', '/login', { json: { username, password } }));
      form.elements.password.value = '';
      await showApp();
    } catch (err) {
      showLogin(err.status === 429 ? 'Too many attempts. Please wait 15 minutes and try again.' : err.message);
    } finally {
      button.disabled = false;
    }
  });

  $('[data-logout]').addEventListener('click', async () => {
    try {
      await api('POST', '/logout');
    } catch { /* the session is gone either way */ }
    showLogin('You have logged out.');
  });

  // ── Data ────────────────────────────────────────────────────────────
  // Includes added products that are not on the site yet, so they can be given a photo.
  async function loadProducts() {
    const data = await api('GET', '/products');
    state.products = data.products;
    state.categories = data.categories;
    const select = $('[data-product-select]');
    const chosen = select.value;
    const byCategory = new Map();
    for (const p of state.products) {
      if (!byCategory.has(p.categoryName)) byCategory.set(p.categoryName, []);
      byCategory.get(p.categoryName).push(p);
    }
    select.replaceChildren(h('option', { value: '' }, 'Choose a product…'));
    for (const [category, items] of byCategory) {
      select.append(h('optgroup', { label: category }, items.map((p) => h('option', { value: p.id }, productLabel(p) + (p.status === 'needs-photo' ? ' — needs a photo' : '')))));
    }
    select.value = state.products.some((p) => p.id === chosen) ? chosen : '';
    updateUploadButton();
    renderProducts();
  }

  const productLabel = (p) => `${p.brand} ${p.name}${p.size ? ` (${p.size}${p.flavour ? `, ${p.flavour}` : ''})` : ''}`;
  // An added product may share its id with a built-in one (see the server); photos belong to the built-in one.
  const productById = (id) => state.products.find((p) => p.id === id && p.builtIn) || state.products.find((p) => p.id === id);

  // Photos change which added products are on the site, so the product list is refreshed too.
  async function loadMedia() {
    try {
      await loadProducts();
      state.media = (await api('GET', '/media')).media;
      renderLibrary();
    } catch (err) {
      if (err.status !== 401) toast(err.message, true);
    }
  }

  // ── Upload form ─────────────────────────────────────────────────────
  const sectionSelect = $('[data-section-select]');
  const productField = $('[data-product-field]');
  const productSelect = $('[data-product-select]');
  sectionSelect.addEventListener('change', () => {
    productField.hidden = sectionSelect.value !== 'product';
    updateUploadButton();
  });
  productSelect.addEventListener('change', updateUploadButton);

  function addFiles(fileList) {
    for (const file of fileList) {
      let error = null;
      if (!ACCEPTED.includes(file.type)) error = 'Not a JPEG, PNG or WebP image';
      else if (file.size > state.limits.maxFileBytes) error = `Larger than ${mb(state.limits.maxFileBytes)}`;
      state.pending.push({ file, error, url: error ? null : URL.createObjectURL(file) });
    }
    renderPending();
  }

  function removePending(index) {
    const [item] = state.pending.splice(index, 1);
    if (item && item.url) URL.revokeObjectURL(item.url);
    renderPending();
  }

  function clearPending() {
    for (const item of state.pending) if (item.url) URL.revokeObjectURL(item.url);
    state.pending = [];
    renderPending();
  }

  function renderPending() {
    const list = $('[data-previews]');
    list.replaceChildren(...state.pending.map((item, i) => h('li', { class: `preview${item.error ? ' is-invalid' : ''}` },
      item.url ? h('img', { src: item.url, alt: '' }) : null,
      h('div', { class: 'preview__name' }, item.file.name),
      item.error ? h('div', { class: 'preview__error' }, item.error) : null,
      h('button', { class: 'preview__remove', type: 'button', 'aria-label': `Remove ${item.file.name}`, onclick: () => removePending(i) }, '×'))));
    $('[data-clear]').hidden = state.pending.length === 0;
    updateUploadButton();
  }

  function updateUploadButton() {
    const valid = state.pending.filter((p) => !p.error).length;
    const needsProduct = sectionSelect.value === 'product' && !productSelect.value;
    const button = $('[data-upload-button]');
    button.disabled = valid === 0 || needsProduct;
    button.textContent = valid > 1 ? `Upload ${valid} photos` : 'Upload';
  }

  const drop = $('[data-drop]');
  const fileInput = $('[data-file-input]');
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('is-over'); });
  }
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  // Stop a photo dropped next to the box from replacing the whole page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  $('[data-clear]').addEventListener('click', clearPending);

  $('[data-upload-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget; // e.currentTarget is null after the first await
    const files = state.pending.filter((p) => !p.error).map((p) => p.file);
    if (!files.length) return;
    const section = sectionSelect.value;
    const alt = form.elements.alt.value.trim();
    const button = $('[data-upload-button]');
    const progress = $('[data-progress]');
    button.disabled = true;
    progress.hidden = false;
    progress.value = 0;

    // Send in batches the server accepts; progress spans all batches.
    const size = state.limits.maxFilesPerUpload;
    const batches = [];
    for (let i = 0; i < files.length; i += size) batches.push(files.slice(i, i + size));
    let created = 0;
    const failed = [];
    try {
      for (const [b, batch] of batches.entries()) {
        const body = new FormData();
        body.append('section', section);
        if (section === 'product') body.append('productId', productSelect.value);
        body.append('alt', alt);
        for (const file of batch) body.append('files', file, file.name);
        try {
          const result = await sendUpload('/media', body, (fraction) => { progress.value = ((b + fraction) / batches.length) * 100; });
          created += result.created.length;
          failed.push(...result.failed);
        } catch (err) {
          if (err.status === 401) return;
          if (err.body && err.body.failed) failed.push(...err.body.failed);
          else throw err;
        }
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      progress.hidden = true;
      button.disabled = false;
    }

    if (created) {
      clearPending();
      form.elements.alt.value = '';
    }
    if (failed.length) {
      toast(`${created ? `${created} uploaded. ` : ''}Not uploaded: ${failed.map((f) => `${f.name} (${f.message})`).join('; ')}`, true);
    } else if (created) {
      toast(created === 1 ? 'Photo uploaded — it is live on the site.' : `${created} photos uploaded — they are live on the site.`);
    }
    await loadMedia();
  });

  // ── Library ─────────────────────────────────────────────────────────
  $('[data-filter]').addEventListener('change', (e) => {
    state.filter = e.target.value;
    renderLibrary();
  });

  function groupsFromMedia() {
    const groups = new Map();
    const order = ['hero', 'banner', 'gallery'];
    for (const m of state.media) {
      const key = m.section === 'product' ? `product:${m.productId}` : m.section;
      if (!groups.has(key)) groups.set(key, { key, section: m.section, productId: m.productId, items: [] });
      groups.get(key).items.push(m);
    }
    const productIndex = (id) => {
      const i = state.products.findIndex((p) => p.id === id);
      return i === -1 ? Infinity : i;
    };
    return [...groups.values()]
      .filter((g) => state.filter === 'all' || g.section === state.filter)
      .sort((a, b) => {
        const sa = order.indexOf(a.section);
        const sb = order.indexOf(b.section);
        if (sa !== sb) return (sa === -1 ? 9 : sa) - (sb === -1 ? 9 : sb);
        return productIndex(a.productId) - productIndex(b.productId);
      })
      .map((g) => ({ ...g, items: g.items.sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id) }));
  }

  function renderLibrary() {
    const root = $('[data-library]');
    const groups = groupsFromMedia();
    if (!groups.length) {
      root.replaceChildren(h('p', { class: 'empty' }, state.media.length
        ? 'Nothing in this section yet.'
        : 'No photos uploaded yet. The site is using its built-in photos.'));
      return;
    }
    root.replaceChildren(...groups.map(renderGroup));
  }

  function renderGroup(group) {
    let title;
    let note;
    let warn = null;
    if (group.section === 'product') {
      const product = productById(group.productId);
      title = product ? productLabel(product) : `Unknown product "${group.productId}"`;
      note = product ? `${product.categoryName} · the first photo is shown on the site` : null;
      if (!product) warn = 'This product no longer exists, so these photos are not shown anywhere. Move them or delete them.';
    } else {
      [title, note] = SECTION_LABELS[group.section];
    }
    return h('section', { class: 'group' },
      h('div', { class: 'group__head' },
        h('h2', {}, title),
        note ? h('p', { class: 'group__note' }, note) : null,
        warn ? h('p', { class: 'group__warn' }, warn) : null),
      h('ul', { class: 'cards' }, group.items.map((m, i) => renderCard(m, group, i))));
  }

  function renderCard(m, group, index) {
    const isFirst = index === 0;
    const altInput = h('input', { value: m.alt, maxlength: '200', placeholder: 'Describe the photo', 'aria-label': 'Alt text' });
    const saveAlt = h('button', { class: 'btn btn--ghost btn--small', type: 'button', disabled: true }, 'Save');
    altInput.addEventListener('input', () => { saveAlt.disabled = altInput.value.trim() === m.alt; });
    const card = h('li', { class: `card${isFirst && group.section !== 'gallery' ? ' is-first' : ''}` });

    const busy = async (work, successMessage) => {
      card.classList.add('is-busy');
      try {
        await work();
        if (successMessage) toast(successMessage);
        await loadMedia();
      } catch (err) {
        card.classList.remove('is-busy');
        if (err.status !== 401) toast(err.message, true);
        if (err.status === 404 || err.status === 409) await loadMedia();
      }
    };

    saveAlt.addEventListener('click', () => busy(() => api('PUT', `/media/${m.id}`, { json: { alt: altInput.value.trim() } }), 'Description saved.'));

    const move = (direction) => {
      const ids = group.items.map((x) => x.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + direction, 0, moved);
      return busy(() => api('PUT', '/media/reorder', { json: { section: group.section, productId: group.productId, ids } }));
    };

    const replaceInput = h('input', { type: 'file', accept: ACCEPTED.join(','), hidden: true });
    replaceInput.addEventListener('change', () => {
      const [file] = replaceInput.files;
      replaceInput.value = '';
      if (!file) return;
      if (!ACCEPTED.includes(file.type)) return toast('Choose a JPEG, PNG or WebP image.', true);
      if (file.size > state.limits.maxFileBytes) return toast(`That image is larger than ${mb(state.limits.maxFileBytes)}.`, true);
      const form = new FormData();
      form.append('file', file, file.name);
      return busy(() => sendUpload(`/media/${m.id}/replace`, form, () => {}), 'Photo replaced.');
    });

    // Move to another section / product
    const sectionPick = h('select', { 'aria-label': 'Section' },
      ['product', 'hero', 'banner', 'gallery'].map((s) => h('option', { value: s, selected: s === m.section }, s === 'product' ? 'A product' : SECTION_LABELS[s][0])));
    const productPick = h('select', { 'aria-label': 'Product' }, h('option', { value: '' }, 'Choose a product…'),
      state.products.map((p) => h('option', { value: p.id, selected: p.id === m.productId }, productLabel(p))));
    productPick.hidden = m.section !== 'product';
    sectionPick.addEventListener('change', () => { productPick.hidden = sectionPick.value !== 'product'; });
    const moveButton = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Move');
    moveButton.addEventListener('click', () => {
      const section = sectionPick.value;
      const productId = section === 'product' ? productPick.value : null;
      if (section === 'product' && !productId) return toast('Choose a product first.', true);
      if (section === m.section && productId === m.productId) return undefined;
      return busy(() => api('PUT', `/media/${m.id}`, { json: { section, productId } }), 'Photo moved.');
    });

    const removeButton = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Delete');
    removeButton.addEventListener('click', async () => {
      if (await confirmDelete(m)) busy(() => api('DELETE', `/media/${m.id}`), 'Photo deleted.');
    });

    card.append(
      h('div', { class: 'card__img' },
        h('img', { src: m.src, alt: m.alt || '', width: m.width, height: m.height, loading: 'lazy' }),
        isFirst && group.section !== 'gallery' ? h('span', { class: 'card__badge' }, 'Shown on site') : null),
      h('div', { class: 'card__body' },
        h('p', { class: 'card__meta' }, `${m.width} × ${m.height} px`),
        h('label', {}, 'Description (alt text)', h('div', { class: 'card__row' }, altInput, saveAlt)),
        h('div', { class: 'card__row' },
          h('button', { class: 'btn btn--ghost btn--small', type: 'button', disabled: index === 0, 'aria-label': 'Move earlier', onclick: () => move(-1) }, '↑ Earlier'),
          h('button', { class: 'btn btn--ghost btn--small', type: 'button', disabled: index === group.items.length - 1, 'aria-label': 'Move later', onclick: () => move(1) }, '↓ Later'),
          h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => replaceInput.click() }, 'Replace'),
          removeButton,
          replaceInput),
        h('details', {},
          h('summary', {}, 'Move to another place'),
          h('div', { class: 'card__move' }, sectionPick, productPick, moveButton))));
    return card;
  }

  // Resolves true when the admin confirms.
  function confirmDelete(m) {
    const dialog = $('[data-confirm]');
    $('[data-confirm-img]').src = m.src;
    // An added product without photos is taken off the site.
    const product = m.section === 'product' ? productById(m.productId) : null;
    const lastPhoto = product && !product.builtIn
      && state.media.filter((x) => x.section === 'product' && x.productId === m.productId).length === 1;
    const warn = $('[data-confirm-warn]');
    warn.textContent = lastPhoto ? `This is the only photo of ${product.brand} ${product.name}: the product will be hidden from the site until it has a photo again. To swap the photo, use Replace instead.` : '';
    warn.hidden = !lastPhoto;
    return new Promise((resolve) => {
      const done = (answer) => {
        dialog.close();
        resolve(answer);
      };
      $('[data-confirm-ok]').onclick = () => done(true);
      $('[data-confirm-cancel]').onclick = () => done(false);
      dialog.addEventListener('cancel', () => resolve(false), { once: true });
      dialog.showModal();
      $('[data-confirm-cancel]').focus();
    });
  }

  // ── Tabs ────────────────────────────────────────────────────────────
  const tabs = [...document.querySelectorAll('[data-tab]')];
  function showTab(name) {
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
    for (const panel of document.querySelectorAll('[data-tab-panel]')) panel.hidden = panel.dataset.tabPanel !== name;
  }
  for (const tab of tabs) tab.addEventListener('click', () => showTab(tab.dataset.tab));

  // Opens the upload form with an added product already chosen.
  function addPhotoFor(productId) {
    showTab('photos');
    sectionSelect.value = 'product';
    productField.hidden = false;
    productSelect.value = productId;
    updateUploadButton();
    productSelect.focus({ preventScroll: true });
    $('#upload-title').closest('.panel').scrollIntoView({ block: 'start' });
  }

  // ── Products ────────────────────────────────────────────────────────
  const STATUS = {
    'built-in': ['Built-in', 'Edit in data/products.json'],
    live: ['On the site', null],
    'needs-photo': ['Needs a photo', 'Add a photo to put it on the site.'],
    'id-taken': ['Hidden', 'A built-in product now uses this web address. Delete this one.'],
    'no-category': ['Hidden', 'Its category was removed from products.json. Edit it and choose another category.'],
  };
  const productForm = $('[data-product-form]');
  const productError = $('[data-product-error]');
  const categorySelect = $('[data-product-category]');
  let idEdited = false; // stop filling in the web address once the admin types their own

  // Photo chosen in the product form; uploaded right after the product is saved.
  const photoInput = $('[data-product-photo]');
  let photoUrl = null;
  function setPhoto(file) {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    if (file && !ACCEPTED.includes(file.type)) {
      toast('Choose a JPEG, PNG or WebP image.', true);
      file = null;
    } else if (file && file.size > state.limits.maxFileBytes) {
      toast(`That image is larger than ${mb(state.limits.maxFileBytes)}.`, true);
      file = null;
    }
    if (!file) photoInput.value = '';
    else photoUrl = URL.createObjectURL(file);
    $('[data-product-photo-pick]').hidden = !file;
    $('[data-product-photo-preview]').src = photoUrl || '';
    $('[data-product-photo-name]').textContent = file ? file.name : '';
  }
  photoInput.addEventListener('change', () => setPhoto(photoInput.files[0]));
  $('[data-product-photo-clear]').addEventListener('click', () => setPhoto(null));

  // Uploads the photo for a product; when it already has photos, the new one becomes
  // the one shown on the site.
  async function uploadProductPhoto(productId, file) {
    const before = state.media.filter((m) => m.section === 'product' && m.productId === productId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((m) => m.id);
    const body = new FormData();
    body.append('section', 'product');
    body.append('productId', productId);
    body.append('alt', '');
    body.append('files', file, file.name);
    let result;
    try {
      result = await sendUpload('/media', body, () => {});
    } catch (err) {
      if (err.body && err.body.failed && err.body.failed[0]) throw new ApiError(err.status, { message: err.body.failed[0].message });
      throw err;
    }
    if (before.length && result.created[0]) {
      await api('PUT', '/media/reorder', { json: { section: 'product', productId, ids: [result.created[0].id, ...before] } });
    }
  }

  // "Optimum Nutrition Gold Standard 5 lb" → "optimum-nutrition-gold-standard-5-lb"
  const slugify = (text) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

  const priceText = (p) => (p.price ? `Rs ${p.price.toLocaleString('en-PK')}` : 'Ask for Price');

  function renderProducts() {
    const root = $('[data-product-list]');
    const known = new Set(state.categories.map((c) => c.id));
    const groups = state.categories.map((c) => ({ name: c.name, items: state.products.filter((p) => p.category === c.id) }));
    const other = state.products.filter((p) => !known.has(p.category));
    if (other.length) groups.push({ name: 'Category removed', items: other });
    root.replaceChildren(...groups.filter((g) => g.items.length).map((g) => h('section', { class: 'group' },
      h('div', { class: 'group__head' }, h('h2', {}, g.name), h('p', { class: 'group__note' }, `${g.items.length} product${g.items.length === 1 ? '' : 's'}`)),
      h('ul', { class: 'plist' }, g.items.map(renderProductRow)))));
  }

  function renderProductRow(p) {
    const [badge, note] = STATUS[p.status] || [p.status, null];
    const details = [p.size, p.flavour, priceText(p), p.available ? null : 'Out of stock', p.featured ? 'Featured' : null].filter(Boolean).join(' · ');
    const row = h('li', { class: `prow${p.builtIn ? ' prow--builtin' : ''}` },
      h('div', { class: 'prow__main' },
        h('strong', {}, `${p.brand} ${p.name}`),
        h('span', { class: 'prow__meta' }, details),
        note ? h('span', { class: `prow__note${p.builtIn ? '' : ' is-warn'}` }, note) : null),
      h('span', { class: `badge badge--${p.status}` }, badge));
    if (p.builtIn) return row;

    const actions = h('div', { class: 'prow__actions' });
    if (p.status === 'live') actions.append(h('a', { class: 'btn btn--ghost btn--small', href: `/products/${p.id}`, target: '_blank', rel: 'noopener' }, 'View ↗'));
    if (p.status !== 'id-taken') actions.append(h('button', { class: `btn btn--small ${p.status === 'needs-photo' ? 'btn--primary' : 'btn--ghost'}`, type: 'button', onclick: () => addPhotoFor(p.id) }, 'Add photo'));
    actions.append(
      h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => openProductForm(p) }, 'Edit'),
      h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => deleteProduct(p, row) }, 'Delete'));
    row.append(actions);
    return row;
  }

  // p = an added product to edit, or undefined to add a new one.
  function openProductForm(p) {
    state.editing = p ? p.id : null;
    const f = productForm.elements;
    categorySelect.replaceChildren(h('option', { value: '' }, 'Choose a category…'),
      ...state.categories.map((c) => h('option', { value: c.id }, c.name)));
    productForm.reset();
    f.brand.value = p ? p.brand : '';
    f.name.value = p ? p.name : '';
    categorySelect.value = p && state.categories.some((c) => c.id === p.category) ? p.category : '';
    f.size.value = p ? p.size : '';
    f.flavour.value = p && p.flavour ? p.flavour : '';
    f.description.value = p ? p.description : '';
    f.id.value = p ? p.id : '';
    f.id.readOnly = Boolean(p);
    f.available.checked = p ? p.available : true;
    f.featured.checked = p ? p.featured : false;
    setPhoto(null);
    $('[data-product-photo-label]').textContent = !p || p.status === 'needs-photo'
      ? 'Photo — the product goes on the site once it has one'
      : 'New photo — optional; replaces the photo shown on the site';
    idEdited = Boolean(p);
    $('[data-product-form-title]').textContent = p ? `Edit ${p.brand} ${p.name}` : 'Add product';
    productError.hidden = true;
    productForm.hidden = false;
    f.brand.focus({ preventScroll: true });
    productForm.scrollIntoView({ block: 'start' });
  }

  function closeProductForm() {
    productForm.hidden = true;
    state.editing = null;
    setPhoto(null);
  }

  // Fill in the web address from brand, name and size until the admin edits it.
  for (const name of ['brand', 'name', 'size']) {
    productForm.elements[name].addEventListener('input', () => {
      if (!idEdited && !state.editing) {
        const f = productForm.elements;
        f.id.value = slugify(`${f.brand.value} ${f.name.value} ${f.size.value}`);
      }
    });
  }
  productForm.elements.id.addEventListener('input', () => { idEdited = productForm.elements.id.value !== ''; });

  $('[data-product-add]').addEventListener('click', () => openProductForm());
  $('[data-product-cancel]').addEventListener('click', closeProductForm);

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = productForm.elements;
    const showError = (message) => {
      productError.textContent = message;
      productError.hidden = false;
      productError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    const required = [['brand', 'Brand'], ['name', 'Product name'], ['category', 'Category'], ['size', 'Size'], ['description', 'Description'], ['id', 'Web address']];
    const empty = required.find(([name]) => !f[name].value.trim());
    if (empty) return showError(`${empty[1]} is required.`);

    // The form has no price: products added here show "Ask for Price". When editing,
    // any price the product already has is kept.
    const current = state.editing ? state.products.find((p) => p.id === state.editing && !p.builtIn) : null;
    const body = {
      brand: f.brand.value,
      name: f.name.value,
      category: f.category.value,
      size: f.size.value,
      flavour: f.flavour.value,
      description: f.description.value,
      price: current && current.price ? current.price : null,
      available: f.available.checked,
      featured: f.featured.checked,
    };
    const editing = state.editing;
    if (!editing) body.id = f.id.value.trim();
    const photo = photoInput.files[0] || null;

    const button = $('[data-product-save]');
    button.disabled = true;
    button.textContent = photo ? 'Saving and uploading…' : 'Saving…';
    try {
      const { product } = editing
        ? await api('PUT', `/products/${encodeURIComponent(editing)}`, { json: body })
        : await api('POST', '/products', { json: body });
      // The product is saved now; a failed photo upload must not lose that.
      let photoError = null;
      if (photo) {
        try {
          await uploadProductPhoto(product.id, photo);
        } catch (err) {
          if (err.status === 401) return undefined;
          photoError = err.message;
        }
      }
      closeProductForm();
      await loadMedia();
      const saved = productById(product.id) || product;
      if (photoError) {
        toast(`Product saved, but the photo was not uploaded: ${photoError} Use "Add photo" to try again.`, true);
      } else if (saved.status === 'needs-photo') {
        toast('Product saved. Now add a photo — it goes on the site as soon as it has one.');
        if (!editing) addPhotoFor(product.id);
      } else {
        toast(saved.status === 'live' ? 'Product saved — it is on the site.' : 'Product saved.');
      }
    } catch (err) {
      if (err.status === 401) return undefined;
      showError(err.message);
      if (err.status === 404) await loadMedia();
    } finally {
      button.disabled = false;
      button.textContent = 'Save product';
    }
    return undefined;
  });

  async function deleteProduct(p, row) {
    const dialog = $('[data-product-confirm]');
    $('[data-product-confirm-name]').textContent = `${p.brand} ${p.name}`;
    const confirmed = await new Promise((resolve) => {
      const done = (answer) => {
        dialog.close();
        resolve(answer);
      };
      $('[data-product-confirm-ok]').onclick = () => done(true);
      $('[data-product-confirm-cancel]').onclick = () => done(false);
      dialog.addEventListener('cancel', () => resolve(false), { once: true });
      dialog.showModal();
      $('[data-product-confirm-cancel]').focus();
    });
    if (!confirmed) return;
    row.classList.add('is-busy');
    try {
      await api('DELETE', `/products/${encodeURIComponent(p.id)}`);
      if (state.editing === p.id) closeProductForm();
      toast('Product deleted.');
    } catch (err) {
      row.classList.remove('is-busy');
      if (err.status === 401) return;
      toast(err.message, true);
    }
    await loadMedia();
  }

  // ── Start ───────────────────────────────────────────────────────────
  (async () => {
    try {
      const res = await fetch('/api/admin/session', { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 503) {
        $('[data-boot]').textContent = 'The admin panel is not configured on this server. Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and SESSION_SECRET in .env and restart.';
        $('[data-boot]').classList.add('notice--error');
        return;
      }
      if (!res.ok) {
        showLogin();
        return;
      }
      applySession(await res.json());
      await showApp();
    } catch {
      $('[data-boot]').textContent = 'Could not reach the server. Reload the page to try again.';
      $('[data-boot]').classList.add('notice--error');
    }
  })();
})();
