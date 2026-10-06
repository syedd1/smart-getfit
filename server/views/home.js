// Homepage (design boards 1b desktop + 1c mobile).
import { html, jsonScript } from '../lib/html.js';
import { page } from './layout.js';
import { icon, img, external, featuredCard, catalogueCard, snackCard, productSheet } from './parts.js';

// Built-in store photos. In Phase 5 these become the fallback when the admin
// has not uploaded hero / banner / gallery media.
const DEFAULT_MEDIA = {
  hero: { src: '/assets/store/exterior.webp', alt: 'The Smart GetFit Nutrition storefront in Gulshan-e-Maymar, Karachi' },
  story: { src: '/assets/store/counter.webp', alt: 'Entrance of The Smart GetFit Nutrition store' },
  about: { src: '/assets/store/interior.webp', alt: 'Seating and counter inside The Smart GetFit Nutrition store' },
  snacksBanner: { src: '/assets/store/snacks.webp', alt: 'nibl protein and granola bars on the shelf' },
  gallery: [
    { kind: 'video', src: '/assets/store/tour-poster.webp', video: '/assets/video/store-tour.mp4', label: 'Take a look inside' },
    { kind: 'image', src: '/assets/store/shelves.webp', label: 'Our supplement wall', pairAlt: 'Product wall at The Smart GetFit Nutrition' },
    { kind: 'image', src: '/assets/store/interior.webp', label: 'Have a seat inside', pairAlt: 'Seating and counter inside the store' },
    { kind: 'image', src: '/assets/store/exterior.webp', label: 'Find us here' },
    { kind: 'image', src: '/assets/store/snacks.webp', label: 'Protein bars' },
    { kind: 'image', src: '/assets/store/counter.webp', label: 'Walk right in' },
    { kind: 'image', src: '/assets/store/closeup.webp', label: 'Original products only' },
    { kind: 'image', src: '/assets/products/big-ramy-labs-red-rex-big-whey.webp', label: 'Ready at the counter' },
  ],
};

function storeJsonLd(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: site.name,
    description: 'Sports nutrition and supplement store offering retail and wholesale.',
    foundingDate: String(site.foundingYear),
    logo: '/assets/logo-sm.webp',
    image: ['/assets/store/exterior.webp', '/assets/store/interior.webp', '/assets/store/shelves.webp'],
    telephone: site.phone.international,
    address: {
      '@type': 'PostalAddress',
      streetAddress: `${site.address.street}, ${site.address.area}`,
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      addressCountry: site.address.country,
    },
    areaServed: site.deliveryAreas.map((name) => ({ '@type': 'Place', name: name === 'All Karachi' ? 'Karachi' : `${name}, Karachi` })),
  };
}

export function homePage(ctx) {
  const { site, catalogue } = ctx;
  const { categories, products, featured, brands } = catalogue;
  const media = DEFAULT_MEDIA;
  const snacks = catalogue.categoryById.get('healthy-snacks');
  const allTileImage = categories.find((c) => c.products.length)?.image;
  const pair = media.gallery.filter((g) => g.pairAlt).reverse();

  const tile = (c) => html`<a class="ctile${c.all ? ' only-m' : ''}" href="${c.url}" data-filter="${c.id}"${c.all ? html` aria-current="true"` : ''}>
<span class="ctile__img">${c.image ? img(ctx, c.image, '') : ''}</span>
<span class="ctile__label"><span class="ctile__num">${c.number}</span><span class="ctile__name">${c.name}<span class="ctile__arrow" aria-hidden="true">→</span></span></span>
</a>`;

  // Mobile chips skip empty categories (as the design does for Beverages / Coffee).
  const chip = (c) => html`<button class="chip${c.all || c.products.length ? '' : ' only-d'}" type="button" aria-pressed="${c.all ? 'true' : 'false'}" data-filter="${c.id}" data-label="${c.name}">${c.all ? 'All'
    : c.shortName ? html`<span class="only-m">${c.shortName}</span><span class="only-d">${c.name}</span>` : c.name}</button>`;

  const allCategory = { all: true, id: 'all', name: 'All products', number: '00', url: '/products', image: allTileImage, products };

  const galleryItem = (g, i) => html`<figure class="gitem${g.pairAlt ? ' gitem--paired' : ''}" data-kind="${g.kind}" data-label="${g.label}" data-full="${g.src}"${g.video ? html` data-video="${g.video}"` : ''}>
${img(ctx, g.src, g.kind === 'video' ? '' : `${g.label} at ${site.name}, ${site.address.area}`, { cls: 'gitem__img' })}
${g.kind === 'video' ? html`<video class="gitem__video" muted loop playsinline preload="none" poster="${g.src}" data-src="${g.video}" aria-label="Video tour of ${site.name}"></video>` : ''}
<figcaption>${g.label}</figcaption>
<button class="gitem__open" type="button" aria-label="Open ${g.label}" data-lb="${i}">${icon('expand', 'i--12')}</button>
</figure>`;

  const main = html`<main id="main">

<section class="hero" id="home" aria-labelledby="hero-title">
<img class="hero__mark" src="/assets/logo-sm.webp" width="480" height="480" alt="">
<span class="hero__badge only-m">${icon('pin-bold', 'i--12')}${site.address.area}, ${site.address.city}</span>
<div class="hero__body">
<span class="hero__bar only-m"></span>
<h1 class="hero__title" id="hero-title"><span class="eyebrow">${site.name}<span class="only-d"> · ${site.address.area}, ${site.address.city}</span></span><span class="hero__head">Fuel Your <span class="hero__accent">Fitness.</span></span></h1>
<p class="hero__lead">Explore our selection of sports nutrition, supplements, shakes, beverages, snacks and coffee.</p>
<div class="hero__ctas">
<a class="btn btn-primary btn-cta" href="#products">Explore Products<span class="only-d" aria-hidden="true">→</span><span class="only-m" aria-hidden="true">↓</span></a>
<a class="btn btn-wa hero__wa" ${external(site.wa.general)} aria-label="WhatsApp Us">${icon('wa', 'i--22')}<span class="lbl">WhatsApp Us</span></a>
</div>
</div>
<div class="hero__media">
<div class="hero__photo" data-parallax>${img(ctx, media.hero.src, media.hero.alt, { lazy: false, priority: true })}</div>
<div class="hero__shade only-m"></div>
<div class="hero__thumbs">${featured.slice(0, 3).map((p) => html`<div>${img(ctx, p.image, p.alt)}</div>`)}</div>
</div>
</section>

<section class="highlights only-d" aria-label="Store highlights">
<div class="highlight">${icon('cal', 'i--30')}<strong>Since ${site.foundingYear}</strong><span>Serving customers in ${site.address.city}</span></div>
<div class="highlight">${icon('dumbbell', 'i--30')}<strong>Sports Nutrition</strong><span>Supplements, shakes, snacks, coffee</span></div>
<div class="highlight highlight--accent">${icon('box', 'i--30')}<strong>Wholesale Available</strong><span>Retail and wholesale supply</span></div>
<div class="highlight">${icon('pin', 'i--30')}<strong>${site.address.area}</strong><span>${site.address.city} — visit the store</span></div>
</section>
<div class="stats only-m">
<div class="stat">${icon('cal')}<strong>${site.foundingYear}</strong><span>Serving since</span></div>
<div class="stat stat--accent">${icon('box')}<strong>Wholesale</strong><span>Available</span></div>
<div class="stat">${icon('pin')}<strong>Retail</strong><span>Walk-in store</span></div>
</div>

${featured.length ? html`<section class="featured only-d" aria-labelledby="featured-title">
<div class="sec-head">
<h2 class="h2" id="featured-title">Featured Products</h2>
<div class="sec-head__tools"><a class="link-rule" href="#products">View all products</a><div class="arrows"><button class="arrow" type="button" aria-label="Previous products" aria-controls="featured-track" data-scroll="-1">←</button><button class="arrow" type="button" aria-label="Next products" aria-controls="featured-track" data-scroll="1">→</button></div></div>
</div>
<div class="featured__track rail" id="featured-track">
${featured.map((p) => featuredCard(ctx, p))}
</div>
</section>` : ''}

<section class="cats" id="categories" aria-labelledby="categories-title">
<h2 class="h2" id="categories-title" data-reveal>Browse by<br class="only-m"> Category</h2>
<div class="cats__grid rail">
${[allCategory, ...categories].map(tile)}
</div>
</section>

<section class="catalogue" id="products" aria-labelledby="products-title">
<div class="catalogue__head"><h2 class="h2" id="products-title">Explore<br class="only-m"> Our Products</h2><span class="catalogue__mcount only-m"><span role="status" data-count-m>${products.length} items</span> · swipe →</span></div>
<div class="filters">
<div class="filters__group"><span class="label" id="cat-label">Category</span>
<div class="chips" role="group" aria-labelledby="cat-label">${[allCategory, ...categories].map(chip)}</div></div>
<label class="filters__brand"><span class="label">Brand</span><select class="select" data-brand-filter><option value="">All brands</option>${brands.map((b) => html`<option>${b}</option>`)}</select></label>
</div>
<div class="catalogue__bar only-d"><span role="status" data-count>${products.length} products</span><div class="arrows"><button class="arrow" type="button" aria-label="Previous in catalogue" aria-controls="catalogue-track" data-scroll="-1">←</button><button class="arrow" type="button" aria-label="Next in catalogue" aria-controls="catalogue-track" data-scroll="1">→</button></div></div>
<div class="catalogue__track rail" id="catalogue-track">
${products.map((p, i) => catalogueCard(ctx, p, i))}
</div>
<div class="empty" data-empty${products.length ? html` hidden` : ''}><span>Nothing listed for this filter yet.</span><a ${external(site.wa.missingProduct)}>Ask us on WhatsApp →</a></div>
</section>

<section class="gallery" id="gallery" aria-labelledby="gallery-title">
<div class="sec-head">
<h2 class="h2 h2--xl" id="gallery-title" data-reveal>Inside<br class="only-m"> the Store</h2>
<div class="gtabs only-d" role="group" aria-label="Filter gallery"><button class="chip" type="button" aria-pressed="true" data-gtab="all">All</button><button class="chip" type="button" aria-pressed="false" data-gtab="image">Photos</button><button class="chip" type="button" aria-pressed="false" data-gtab="video">Videos</button></div>
</div>
<div class="gallery__pair only-m">
${pair.map((g) => html`<figure data-reveal>${img(ctx, g.src, g.pairAlt)}</figure>`)}
<span class="gallery__note">Real photos from our store</span>
</div>
<div class="gallery__grid rail" data-gallery>
${media.gallery.map(galleryItem)}
</div>
<dialog class="lightbox" aria-label="Gallery" data-lightbox>
<div class="lightbox__bar"><span class="lightbox__title"><span class="lightbox__kind" data-lb-kind>Photo</span> <span data-lb-label></span></span>
<div class="lightbox__nav"><button type="button" aria-label="Previous" data-lb-step="-1">←</button><button type="button" aria-label="Next" data-lb-step="1">→</button><button class="lightbox__close" type="button" data-close>Close ×</button></div></div>
<div class="lightbox__stage"><img alt="" data-lb-img hidden><video controls playsinline data-lb-video hidden></video></div>
</dialog>
</section>

${snacks && snacks.products.length ? html`<section class="snacks only-m" aria-labelledby="snacks-title">
<div class="snacks__hero">
<div class="snacks__photo" data-parallax>${img(ctx, media.snacksBanner.src, media.snacksBanner.alt)}</div>
<div class="snacks__shade"></div>
<div class="snacks__title" data-reveal><span class="eyebrow">Category ${snacks.number}</span><h2 class="h2" id="snacks-title">${snacks.name.split(' ').map((w, i) => (i ? html`<br>${w}` : w))}</h2></div>
</div>
<div class="snacks__rail rail">
${snacks.products.map((p) => snackCard(ctx, p))}
</div>
<div class="snacks__foot">
<details class="snacks__info"><summary>About our snacks<span class="snacks__plus" aria-hidden="true">+</span></summary><div class="snacks__panel"><strong>IN STORE</strong><span>Stock changes often. Ask on WhatsApp which snacks are available today, and for wholesale.</span></div></details>
<a class="btn btn-primary btn-cta" href="${snacks.url}" data-filter="${snacks.id}">Explore Snacks<span aria-hidden="true">→</span></a>
</div>
</section>` : ''}

${cantFind(ctx)}

<section class="story" id="story" aria-labelledby="story-title">
<div class="story__text" data-reveal>
<h2 class="h2 h2--xl" id="story-title">Our Story</h2>
<p class="story__sub">In ${site.address.area}, ${site.address.city}, since ${site.foundingYear}.</p>
<p class="story__quote">Since 2015, we've grown from home deliveries into Karachi's trusted supplement store, with a shop in Gulshan-e-Maymar and our own warehouse for bulk orders. Original products, honest advice, delivered across Karachi.</p>
<a class="btn btn-secondary btn-cta only-m" ${external(site.wa.wholesale)}>Ask About Wholesale</a>
</div>
<div class="story__media" data-reveal>${img(ctx, media.story.src, media.story.alt)}</div>
</section>

<section class="about only-d" id="about" aria-labelledby="about-title">
<div class="about__text">
<h2 class="h2 h2--md" id="about-title">${site.name}</h2>
<p>Smart GetFit Nutrition provides sports nutrition, supplements, fitness beverages, snacks, coffee and related products to customers in Karachi.</p>
<p>Since 2015 we have supplied sports nutrition at wholesale as well as retail, so bulk orders come from the same shelves our walk-in customers shop.</p>
</div>
<div class="about__media">${img(ctx, media.about.src, media.about.alt)}<img class="about__logo" src="/assets/logo-sm.webp" width="480" height="480" alt="${site.name} logo" loading="lazy"></div>
<div class="band">
<div class="band__cell band__cell--accent">${icon('box', 'i--34')}<h3>Wholesale</h3><span class="band__big">Since ${site.foundingYear}</span><span>Wholesale and retail from one store in ${site.address.area}</span></div>
<div class="band__cell"><h3>Warehouse</h3><span>Our own warehouse for bulk orders, delivered across ${site.address.city}.</span></div>
<div class="band__cell"><h3>Wholesale enquiries</h3><span>Ask about bulk availability on WhatsApp.</span><a class="btn btn-primary btn-cta" ${external(site.wa.wholesale)}>Ask About Wholesale<span aria-hidden="true">→</span></a></div>
</div>
</section>

${site.reviews.items.length ? html`<section class="reviews" id="reviews" aria-labelledby="reviews-title">
<div class="reviews__head" data-reveal>
<h2 class="h2" id="reviews-title">What Customers Say</h2>
<p class="rating">${site.reviews.rating.toFixed(1)} <span class="stars" aria-hidden="true">★★★★★</span><span class="visually-hidden">out of 5 stars from</span> <span class="rating__count">${site.reviews.count} Google review${site.reviews.count === 1 ? '' : 's'}</span></p>
</div>
<a class="btn btn-secondary btn-cta reviews__link" ${external(site.reviews.url)}>See Us on Google</a>
<div class="reviews__list rail">
${site.reviews.items.map((r) => html`<article class="review"><span class="stars" aria-label="5 out of 5 stars">★★★★★</span><p>${r.text}</p><div class="review__who"><span class="review__avatar" aria-hidden="true">${[...r.name][0]}</span><div><h3>${r.name}</h3><span>Google review</span></div></div></article>`)}
</div>
</section>` : ''}

<section class="visit" id="location" aria-labelledby="location-title">
<div class="visit__body" data-reveal>
<h2 class="h2" id="location-title">Visit Smart GetFit Nutrition</h2>
<dl class="visit__list">
<div class="visit__row visit__row--addr"><dt>Address</dt><dd><address>${icon('pin')}<span>${site.address.display}</span></address></dd></div>
<div class="visit__row"><dt>Phone</dt><dd><a href="${site.phoneHref}">${site.phone.display}</a></dd></div>
<div class="visit__row only-d"><dt>WhatsApp</dt><dd>${site.whatsapp.display}</dd></div>
<div class="visit__row"><dt>Hours</dt><dd>${site.hours.display}</dd></div>
<div class="visit__row visit__row--areas"><dt>We deliver to</dt><dd><ul class="areas">${site.deliveryAreas.map((a) => html`<li>${a}</li>`)}</ul></dd></div>
</dl>
<div class="visit__ctas">
<a class="btn btn-primary btn-cta" ${external(site.maps.url)}><span class="only-d">Get Directions</span><span class="only-m">Directions</span><span aria-hidden="true">↗</span></a>
<a class="btn btn-wa only-d" ${external(site.wa.general)}>${icon('wa', 'i--22')}<span class="lbl">WhatsApp Us</span></a>
<a class="btn btn-secondary btn-cta only-m" href="${site.phoneHref}">Call</a>
</div>
</div>
<div class="visit__map"><iframe title="Map: ${site.name}" src="${site.maps.embedUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>
</section>

</main>`;

  return page(ctx, {
    title: `${site.name} | Sports Nutrition & Supplements in ${site.address.area}, ${site.address.city}`,
    description: `Sports nutrition and supplement store in ${site.address.area}, ${site.address.city} since ${site.foundingYear}. Protein, pre-workout, BCAAs, multivitamins, shakes, snacks and coffee. Retail and wholesale. Ask for prices on WhatsApp.`,
    current: 'home',
    head: html`<link rel="preload" href="${media.hero.src}" as="image" fetchpriority="high">
<meta property="og:type" content="website">
<meta property="og:title" content="${site.name} — ${site.address.area}, ${site.address.city}">
<meta property="og:description" content="Sports nutrition and supplements since ${site.foundingYear}. Retail and wholesale. Visit the store or ask on WhatsApp.">
<meta property="og:image" content="${media.hero.src}">
<meta property="og:locale" content="en_PK">
<script type="application/ld+json">${jsonScript(storeJsonLd(site))}</script>`,
    scripts: ['catalogue', 'gallery'],
    main,
    afterPage: productSheet(products),
  });
}

export function cantFind({ site }) {
  return html`<section class="cant" aria-labelledby="cant-title">
<div class="cant__box">
<div class="cant__text"><h2 class="h2" id="cant-title" data-reveal>Can't Find What You're Looking For?</h2><p>Message us and ask about product availability.</p></div>
<a class="btn btn-cta cant__cta" ${external(site.wa.missingProduct)}>Ask on WhatsApp<span class="only-d" aria-hidden="true">→</span><span class="only-m">${icon('wa', 'i--22')}</span></a>
</div>
</section>`;
}
