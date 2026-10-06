// Page shell: <head> (SEO + social metadata), marquee + header, mobile menu, footer,
// floating WhatsApp.
import { html, jsonScript } from '../lib/html.js';
import { SPRITE, icon, external, logo } from './parts.js';

const NAV = [
  ['Home', '#home'], ['Products', '#products'], ['Categories', '#categories'],
  ['About', '#about'], ['Reviews', '#reviews'], ['Location', '#location'],
];

// Search results show about 160 characters of a description: trim at a word boundary.
export function clip(text, max = 160) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[s,.;:—–-]+$/, '')}…`;
}

// Absolute URL on the canonical domain (SITE_URL), for canonical, Open Graph, JSON-LD.
export const absolute = (ctx, path) => `${ctx.siteUrl}${path}`;

// current: 'home' | 'products' | null — controls the active nav item and link base.
function masthead(ctx, current) {
  const { site } = ctx;
  const base = current === 'home' ? '' : '/';
  const ticker = `${site.marquee.join('          •          ')}          •          `;
  const half = html`<span>${ticker.repeat(3)}</span>`;
  const navLink = ([label, hash]) => {
    const active = (current === 'home' && label === 'Home') || (current === 'products' && label === 'Products');
    return html`<a href="${base}${hash}"${active ? html` aria-current="page"` : ''}>${label}</a>`;
  };
  const menuLink = ([label, hash]) => html`<a href="${base}${label === 'About' ? '#story' : hash}"${current === 'home' && label === 'Home' ? html` aria-current="page"` : ''}>${label}<span aria-hidden="true">→</span></a>`;
  return html`<div class="masthead">
<a class="topbar" href="${site.phoneHref}"><span class="visually-hidden">Call the store: ${site.phone.display}</span><span class="topbar__track" aria-hidden="true">${half}${half}</span></a>
<header class="header">
<a class="header__logo" href="${base}#home">${logo(ctx, { px: 56, alt: site.name })}</a>
<span class="header__word" aria-hidden="true">THE SMART GETFIT<br>NUTRITION</span>
<nav class="header__nav" aria-label="Primary">${NAV.map(navLink)}</nav>
<a class="btn header__dir" ${external(site.maps.url)} aria-label="Get directions on Google Maps">${icon('gpin', 'i--22')}<span class="lbl">Get Directions</span></a>
<a class="btn header__wa" ${external(site.wa.general)} aria-label="WhatsApp Us">${icon('wa')}<span class="lbl">WhatsApp Us</span></a>
<button class="header__menu" type="button" aria-label="Menu" aria-haspopup="dialog" aria-controls="menu" aria-expanded="false" data-open-menu>${icon('menu')}</button>
</header>
</div>
<dialog class="menu" id="menu" aria-label="Menu">
<div class="menu__bar">${logo(ctx, { px: 42, lazy: true })}<button class="menu__close" type="button" aria-label="Close menu" data-close>×</button></div>
<nav class="menu__nav" aria-label="Mobile">${NAV.map(menuLink)}</nav>
<div class="menu__foot"><span>${site.address.display}</span><a class="btn btn-wa" ${external(site.wa.general)}>${icon('wa', 'i--22')}<span class="lbl">WhatsApp Us</span></a></div>
</dialog>`;
}

function footer(ctx, current) {
  const { site } = ctx;
  const base = current === 'home' ? '' : '/';
  return html`<footer class="footer">
<div class="footer__grid">
<div class="footer__brand">${logo(ctx, { px: 88, lazy: true })}<div><span class="footer__name">${site.name.toUpperCase()}</span><address>${site.address.display}</address></div></div>
<nav class="footer__nav only-d" aria-label="Footer">${NAV.map(([label, hash]) => html`<a class="footer__link" href="${base}${hash}">${label}</a>`)}</nav>
<div class="footer__contact"><span class="label only-d">Contact</span><a class="footer__link only-d" ${external(site.wa.general)}>WhatsApp</a><a class="footer__link only-d" href="${site.phoneHref}">Phone — ${site.phone.display}</a><a class="footer__link only-d" ${external(site.maps.url)}>Google Maps</a>${site.social.instagram ? html`<a class="footer__link" ${external(site.social.instagram)}>Instagram</a>` : ''}${site.social.facebook ? html`<a class="footer__link" ${external(site.social.facebook)}>Facebook</a>` : ''}</div>
</div>
<div class="footer__bottom only-d"><span>© ${site.name}</span></div>
</footer>
<div class="float-wa only-m"><span class="float-wa__label" aria-hidden="true">Chat with us</span><a class="float-wa__btn" ${external(site.wa.general)} aria-label="Chat with us on WhatsApp">${icon('wa')}</a></div>`;
}

// path: canonical path ("/products/x"), or null for pages that must not be indexed.
// image: the social preview image ({ full, width, height, alt }).
// jsonLd: structured-data objects for this page.
// head: extra <head> markup; scripts: page-specific script names in /js/;
// afterPage: dialogs/data outside .page
export function page(ctx, {
  title, description, path = null, image = null, ogType = 'website', jsonLd = [],
  current = null, head = '', scripts = [], main, afterPage = '', beforeMain = '',
}) {
  const asset = (p) => ctx.assets.url(p);
  description = clip(description);
  const url = path === null ? null : absolute(ctx, path);
  const imageUrl = image ? absolute(ctx, image.full) : null;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${url ? html`<link rel="canonical" href="${url}">` : html`<meta name="robots" content="noindex">`}
<meta property="og:site_name" content="${ctx.site.name}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${url ? html`<meta property="og:url" content="${url}">` : ''}
${imageUrl ? html`<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="${image.width}">
<meta property="og:image:height" content="${image.height}">
<meta property="og:image:alt" content="${image.alt}">` : ''}
<meta property="og:locale" content="en_PK">
<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${imageUrl ? html`<meta name="twitter:image" content="${imageUrl}">` : ''}
<meta name="theme-color" content="#000000">
<link rel="icon" href="${asset('/assets/logo-sm-400.webp')}" type="image/webp">
<link rel="apple-touch-icon" href="${asset('/assets/logo-sm-400.webp')}">
<link rel="stylesheet" href="${asset('/css/tokens.css')}">
<link rel="stylesheet" href="${asset('/css/site.css')}">
${head}
${jsonLd.map((data) => html`<script type="application/ld+json">${jsonScript(data)}</script>\n`)}<script src="${asset('/js/main.js')}" defer></script>
${scripts.map((s) => html`<script src="${asset(`/js/${s}.js`)}" defer></script>\n`)}</head>
<body>
${SPRITE}
<a class="skip" href="#main">Skip to content</a>
<div class="page">
${masthead(ctx, current)}
${beforeMain}
${main}
${footer(ctx, current)}
</div>
${afterPage}
</body>
</html>
`.toString();
}

export function errorPage(ctx, status) {
  const copy = status === 404
    ? { title: "This page isn't on the shelf", text: "The page you're looking for doesn't exist or has moved. Browse the catalogue, or ask us on WhatsApp." }
    : { title: 'Something went wrong', text: "We couldn't load this page. Please try again in a moment, or message us on WhatsApp." };
  return page(ctx, {
    title: `${copy.title} | ${ctx.site.name}`,
    description: copy.text,
    main: html`<main id="main" class="err">
<span class="err__code" aria-hidden="true">${status}</span>
<h1>${copy.title}</h1>
<p>${copy.text}</p>
<div class="err__ctas">
<a class="btn btn-primary btn-cta" href="/">Back to the store<span aria-hidden="true">→</span></a>
<a class="btn btn-wa" ${external(ctx.site.wa.general)}>${icon('wa', 'i--22')}<span class="lbl">WhatsApp Us</span></a>
</div>
</main>`,
  });
}
