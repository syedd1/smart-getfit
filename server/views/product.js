// Product page (design board 1d) and category / all-products listing pages.
import { html } from '../lib/html.js';
import { page } from './layout.js';
import { icon, img, external, catalogueCard, relatedCard, productSheet } from './parts.js';
import { cantFind } from './home.js';

const crumbs = (items) => html`<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([label, href], i) => html`${i ? html`<li aria-hidden="true">/</li>` : ''}<li${href ? '' : html` aria-current="page"`}>${href ? html`<a href="${href}">${label}</a>` : label}</li>`)}</ol></nav>`;

export function productPage(ctx, p) {
  const { site, catalogue } = ctx;
  const others = catalogue.products.filter((x) => x.id !== p.id);
  const related = others.filter((x) => x.category === p.category).concat(others.filter((x) => x.category !== p.category)).slice(0, 4);
  const cta = !p.available
    ? html`<a class="btn btn-secondary btn-cta" ${external(p.waAvailability)}>Check Availability<span aria-hidden="true">→</span></a>`
    : html`<a class="btn btn-primary btn-cta" ${external(p.priceText ? p.waAbout : p.waPrice)}>${p.priceText ? 'Ask on WhatsApp' : 'Ask for Price'}<span aria-hidden="true">→</span></a>`;

  return page(ctx, {
    title: `${p.brand} ${p.name} ${p.size} | Smart GetFit Nutrition ${site.address.city}`,
    description: `${p.brand} ${p.name} (${p.variant}) at ${site.name}, ${site.address.area}, ${site.address.city}. Retail and wholesale — ${p.priceText ? `${p.priceText}.` : 'ask for the price on WhatsApp.'}`,
    current: 'products',
    head: html`<link rel="preload" href="${p.image}" as="image" fetchpriority="high">`,
    beforeMain: crumbs([['Products', '/products'], [p.categoryName, `/products/${p.category}`], [p.name, null]]),
    main: html`<main id="main">
<article class="pd${p.available ? '' : ' is-unavailable'}" aria-labelledby="pd-title">
<div class="pd__media">${img(ctx, p.image, p.alt, { cls: 'pcard__img', lazy: false, priority: true })}</div>
<div class="pd__info">
<span class="pcard__brand">${p.brand}</span>
<h1 id="pd-title">${p.name}</h1>
<dl class="specs"><dt>Brand</dt><dd>${p.brand}</dd><dt>Category</dt><dd><a href="/products/${p.category}">${p.categoryName}</a></dd><dt>Size</dt><dd>${p.variant}</dd>${p.priceText ? html`<dt>Price</dt><dd>${p.priceText}</dd>` : ''}<dt>Availability</dt><dd class="avail${p.available ? '' : ' avail--no'}"><span class="avail__dot"></span>${p.available ? 'In stock at the store' : 'Currently Unavailable'}</dd></dl>
<p class="pd__desc">${p.description}</p>
<div class="pd__ctas">
${cta}
<a class="btn btn-wa" ${external(p.waAbout)}>${icon('wa', 'i--22')}<span class="lbl">WhatsApp Us</span></a>
</div>
</div>
</article>
${related.length ? html`<section class="related" aria-labelledby="related-title">
<h2 id="related-title">More from ${p.categoryName}</h2>
<div class="related__grid">
${related.map((r) => relatedCard(ctx, r))}
</div>
</section>` : ''}
</main>`,
  });
}

// category = null renders /products (every product).
export function listingPage(ctx, category) {
  const { site, catalogue } = ctx;
  const products = category ? category.products : catalogue.products;
  const heading = category ? `${category.name} in ${site.address.city}` : `All Products in ${site.address.city}`;
  const navChip = (href, label, current) => html`<a class="chip" href="${href}"${current ? html` aria-current="page"` : ''}>${label}</a>`;

  return page(ctx, {
    title: `${heading} | ${site.name}`,
    description: category
      ? `${category.name} at ${site.name}, ${site.address.area}, ${site.address.city}. ${products.length} product${products.length === 1 ? '' : 's'} in store — retail and wholesale, ask for prices on WhatsApp.`
      : `Every product at ${site.name}, ${site.address.area}, ${site.address.city}: protein, pre-workout, BCAAs, creatine, multivitamins and snacks. Ask for prices on WhatsApp.`,
    current: 'products',
    scripts: ['catalogue'],
    beforeMain: crumbs(category ? [['Products', '/products'], [category.name, null]] : [['Products', null]]),
    main: html`<main id="main">
<section class="catalogue catalogue--page" aria-labelledby="listing-title">
<div class="catalogue__head"><h1 class="h2" id="listing-title">${heading}</h1><span class="catalogue__count">${products.length} product${products.length === 1 ? '' : 's'}</span></div>
<nav class="chips chips--nav" aria-label="Categories">${navChip('/products', 'All', !category)}${catalogue.categories.map((c) => navChip(c.url, c.name, category && c.id === category.id))}</nav>
${products.length
    ? html`<div class="catalogue__track catalogue__track--grid" id="catalogue-track">${products.map((p, i) => catalogueCard(ctx, p, i))}</div>`
    : html`<div class="empty"><span>Nothing listed in ${category.name} yet.</span><a ${external(site.wa.missingProduct)}>Ask us on WhatsApp →</a></div>`}
</section>
${cantFind(ctx)}
</main>`,
    afterPage: productSheet(products),
  });
}
