// Shared view fragments: icons, images, product cards, the mobile product sheet.
import { html, raw, escapeHtml, jsonScript } from '../lib/html.js';

export const icon = (id, cls = '') => html`<svg class="${cls ? `i ${cls}` : 'i'}" aria-hidden="true" focusable="false"><use href="#i-${id}"/></svg>`;

// Attributes for links that leave the site (WhatsApp, Maps, social).
export const external = (href) => raw(`href="${escapeHtml(href)}" target="_blank" rel="noopener"`);

// An image is either a built-in path ("/assets/…webp") or an uploaded media item
// ({ src, srcset, width, height, alt }). alt = null uses the media item's own alt.
export function img(ctx, image, alt, { cls = '', lazy = true, priority = false, sizes = '' } = {}) {
  const item = typeof image === 'string' ? staticImage(ctx, image) : image;
  const attrs = [
    cls && ` class="${escapeHtml(cls)}"`,
    ` src="${escapeHtml(item.src)}"`,
    item.srcset && ` srcset="${escapeHtml(item.srcset)}" sizes="${escapeHtml(sizes || '100vw')}"`,
    item.width && ` width="${item.width}" height="${item.height}"`,
    ` alt="${escapeHtml(alt ?? item.alt ?? '')}"`,
    lazy && ' loading="lazy"',
    priority && ' fetchpriority="high"',
  ].filter(Boolean).join('');
  return raw(`<img${attrs} decoding="async">`);
}

// A built-in photo with its smaller copies (see `npm run optimize-images`) as srcset,
// and version-stamped URLs so it can be cached long-term.
export function staticImage(ctx, src, alt = '') {
  const size = ctx.assets.size(src);
  const variants = ctx.assets.variants(src);
  const display = variants.filter((v) => v.width <= 800).at(-1) ?? variants.at(-1);
  return {
    src: display ? display.url : ctx.assets.url(src),
    srcset: variants.length > 1 ? variants.map((v) => `${v.url} ${v.width}w`).join(', ') : '',
    width: size?.[0],
    height: size?.[1],
    alt,
    full: ctx.assets.url(src),
  };
}

const LOGO = '/assets/logo-sm.webp';
export const logo = (ctx, { px, cls = '', alt = '', lazy = false }) => img(ctx, staticImage(ctx, LOGO, alt), alt, { cls, lazy, sizes: `${px}px` });

// A product's photo: the first one uploaded in the admin panel, else the built-in image.
export function productImage(ctx, p) {
  const uploaded = ctx.media.product.get(p.id)?.[0];
  if (uploaded) return { ...uploaded, alt: uploaded.alt || p.alt };
  return staticImage(ctx, p.image, p.alt);
}

// Preload hint for the main image of a page (the LCP element).
export function preloadImage(image, sizes) {
  return image.srcset
    ? html`<link rel="preload" as="image" href="${image.src}" imagesrcset="${image.srcset}" imagesizes="${sizes}" fetchpriority="high">`
    : html`<link rel="preload" as="image" href="${image.src}" fetchpriority="high">`;
}

export const SIZES = {
  featured: '340px',
  card: '(min-width: 1024px) 24vw, 236px',
  gridCard: '(min-width: 1024px) 25vw, 50vw',
  snack: '176px',
  productMain: '(min-width: 1024px) 58vw, 100vw',
  hero: '(min-width: 1024px) 58vw, 100vw',
  heroThumb: '20vw',
  tile: '(min-width: 1024px) 168px, 150px',
  gallery: '(min-width: 1024px) 50vw, 200px',
};

export const SPRITE = raw(`<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
<symbol id="i-wa" viewBox="0 0 24 24"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.23-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.44 9.43zm8.03-17.46A11.3 11.3 0 0 0 12.05.7C5.79.7.7 5.79.7 12.04c0 2 .52 3.95 1.52 5.67L.6 23.3l5.74-1.5a11.3 11.3 0 0 0 5.7 1.45h.01c6.25 0 11.34-5.09 11.34-11.34 0-3.03-1.18-5.88-3.32-8.02z"/></symbol>
<symbol id="i-gpin" viewBox="0 0 24 24"><path d="M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 5.4 6.3 12.2 6.9 12.9a.8.8 0 0 0 1.2 0c.6-.7 6.9-7.5 6.9-12.9A7.5 7.5 0 0 0 12 1.5z" fill="#EA4335"/><circle cx="12" cy="9" r="3" fill="#fff"/></symbol>
<symbol id="i-cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></symbol>
<symbol id="i-dumbbell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/></symbol>
<symbol id="i-box" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></symbol>
<symbol id="i-pin-bold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></symbol>
<symbol id="i-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
</svg>`);

// ── Product cards ─────────────────────────────────────────────────────────
// Primary CTA: "Ask for Price" when no price is listed; otherwise the price is shown
// on the card and the button opens a general enquiry about the product.
function primaryCta(p, cls) {
  if (!p.available) {
    return html`<a class="btn btn-secondary ${cls}" ${external(p.waAvailability)}><span class="only-d">Check Availability</span><span class="only-m">Check Stock</span></a>`;
  }
  return p.priceText
    ? html`<a class="btn btn-primary ${cls}" ${external(p.waAbout)} aria-label="Ask about ${p.title} on WhatsApp">Ask on WhatsApp<span aria-hidden="true">→</span></a>`
    : html`<a class="btn btn-primary ${cls}" ${external(p.waPrice)} aria-label="Ask for price of ${p.title} on WhatsApp">Ask for Price<span aria-hidden="true">→</span></a>`;
}

const price = (p) => (p.priceText ? html`<p class="price">${p.priceText}</p>` : '');

export const featuredCard = (ctx, p) => html`<article class="fcard${p.available ? '' : ' is-unavailable'}">
<div class="fcard__media">${img(ctx, productImage(ctx, p), null, { cls: 'pcard__img', sizes: SIZES.featured })}</div>
<div class="fcard__body">
<span class="pcard__brand">${p.brand}</span>
<h3 class="fcard__name">${p.name}</h3>
<p class="fcard__meta">${p.categoryName} · ${p.variant}</p>
<p class="fcard__desc">${p.description}</p>
${price(p)}
<div class="card-actions">
${primaryCta(p, 'btn-ask')}
<a class="btn btn-ghost btn-more" href="${p.url}" aria-label="View details: ${p.title}">View Details →</a>
</div>
</div>
</article>`;

export const catalogueCard = (ctx, p, i, sizes = SIZES.card) => html`<article class="pcard${p.available ? '' : ' is-unavailable'}" data-id="${p.id}" data-cat="${p.category}" data-brand="${p.brand}">
<a class="pcard__media" href="${p.url}" tabindex="-1" aria-hidden="true" data-detail="${p.id}">
<span class="pcard__num only-m">${String(i + 1).padStart(2, '0')}</span>
${img(ctx, productImage(ctx, p), null, { cls: 'pcard__img', sizes })}
<span class="pcard__tag only-m">${p.available ? p.categoryName : 'Unavailable'}</span>
${p.available ? '' : html`<span class="pcard__badge only-d">Currently Unavailable</span>`}
</a>
<div class="pcard__body">
<span class="pcard__brand">${p.brand}</span>
<h3 class="pcard__name">${p.name}</h3>
<p class="pcard__meta"><span class="only-d">${p.categoryName} · </span>${p.variant}</p>
${price(p)}
<div class="pcard__actions">
${primaryCta(p, 'btn-ask')}
<a class="pcard__more" href="${p.url}" data-detail="${p.id}" aria-label="View details: ${p.title}"><span class="only-d">View Details →</span><span class="only-m" aria-hidden="true">+</span></a>
</div>
</div>
</article>`;

export const snackCard = (ctx, p) => html`<article class="scard">
<a class="scard__media" href="${p.url}" tabindex="-1" aria-hidden="true" data-detail="${p.id}">${img(ctx, productImage(ctx, p), null, { cls: 'pcard__img', sizes: SIZES.snack })}</a>
<div class="scard__body">
<span class="pcard__brand">${p.brand}</span>
<h3 class="scard__name">${p.name}</h3>
<a class="scard__more" href="${p.url}" data-detail="${p.id}" aria-label="Know more: ${p.title}">Know More<span aria-hidden="true">+</span></a>
</div>
</article>`;

export const relatedCard = (ctx, p) => html`<div class="rcard">
<div class="rcard__media">${img(ctx, productImage(ctx, p), null, { cls: 'pcard__img', sizes: SIZES.gridCard })}</div>
<div class="rcard__body">
<span class="pcard__brand">${p.brand}</span>
<h3>${p.name}</h3>
<span class="rcard__meta">${p.categoryName} · ${p.variant}</span>
<a class="btn btn-ghost btn-more" href="${p.url}" aria-label="View details: ${p.title}">View Details →</a>
</div>
</div>`;

// ── Mobile product sheet + the data it reads ──────────────────────────────
export function productSheet(ctx, products) {
  const data = Object.fromEntries(products.map((p) => [p.id, {
    brand: p.brand, name: p.name, cat: p.categoryName, size: p.variant, desc: p.description,
    img: productImage(ctx, p).src, alt: productImage(ctx, p).alt, avail: p.available, price: p.priceText,
    wa: p.available ? (p.priceText ? p.waAbout : p.waPrice) : p.waAvailability,
    cta: p.available ? (p.priceText ? 'Ask on WhatsApp' : 'Ask for Price') : 'Check Availability',
    waAbout: p.waAbout,
  }]));
  return html`<dialog class="pdialog" id="product-dialog" aria-labelledby="pd-title" data-product-dialog>
<div class="pdialog__bar"><button class="pdialog__back" type="button" data-close>← Products</button></div>
<div class="pdialog__scroll">
<div class="pdialog__media"><img class="pcard__img" alt="" width="1200" height="1200" data-pd="img"></div>
<div class="pdialog__body">
<span class="pcard__brand" data-pd="brand"></span>
<h2 id="pd-title" data-pd="name"></h2>
<p class="price" data-pd="price" hidden></p>
<dl class="specs"><dt>Category</dt><dd data-pd="cat"></dd><dt>Size</dt><dd data-pd="size"></dd><dt>Availability</dt><dd class="avail" data-pd="avail"><span class="avail__dot"></span><span data-pd="availLabel"></span></dd></dl>
<p class="pdialog__desc" data-pd="desc"></p>
</div>
</div>
<div class="pdialog__actions"><a class="btn btn-primary btn-cta" href="#" target="_blank" rel="noopener" data-pd="wa"><span data-pd="cta">Ask for Price</span><span aria-hidden="true">→</span></a><a class="btn btn-wa" href="#" target="_blank" rel="noopener" data-pd="waAbout">${icon('wa', 'i--22')}<span class="lbl">WhatsApp Us</span></a></div>
</dialog>
<script type="application/json" id="catalogue-data">${jsonScript(data)}</script>`;
}
