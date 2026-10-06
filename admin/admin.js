// Media admin. Talks only to /api/admin (session cookie + CSRF header) and the public
// /api/products list. All text from the server is inserted with textContent — never
// as HTML — so an alt text or product name can't inject markup.
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
    products: [],
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
    await loadProducts();
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
  async function loadProducts() {
    if (state.products.length) return;
    const res = await fetch('/api/products', { cache: 'no-store' });
    state.products = (await res.json()).products;
    const select = $('[data-product-select]');
    const byCategory = new Map();
    for (const p of state.products) {
      if (!byCategory.has(p.categoryName)) byCategory.set(p.categoryName, []);
      byCategory.get(p.categoryName).push(p);
    }
    for (const [category, items] of byCategory) {
      select.append(h('optgroup', { label: category }, items.map((p) => h('option', { value: p.id }, productLabel(p)))));
    }
  }

  const productLabel = (p) => `${p.brand} ${p.name}${p.size ? ` (${p.size}${p.flavour ? `, ${p.flavour}` : ''})` : ''}`;
  const productById = (id) => state.products.find((p) => p.id === id);

  async function loadMedia() {
    try {
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
      if (!product) warn = 'This product is no longer in products.json, so these photos are not shown anywhere. Move them or delete them.';
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
