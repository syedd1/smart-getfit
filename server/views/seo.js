// Structured data (schema.org JSON-LD), sitemap.xml and robots.txt.
import { absolute } from './layout.js';
import { escapeHtml } from '../lib/html.js';

const storeId = (ctx) => absolute(ctx, '/#store');

// The physical shop as a LocalBusiness (Store), on the homepage.
export function storeJsonLd(ctx, images) {
  const { site } = ctx;
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': storeId(ctx),
    name: site.name,
    url: absolute(ctx, '/'),
    description: `Sports nutrition and supplement store in ${site.address.area}, ${site.address.city}, offering retail and wholesale since ${site.foundingYear}.`,
    foundingDate: String(site.foundingYear),
    logo: absolute(ctx, ctx.assets.url('/assets/logo-sm.webp')),
    image: images.map((src) => absolute(ctx, src)),
    telephone: site.phone.international,
    address: {
      '@type': 'PostalAddress',
      streetAddress: `${site.address.street}, ${site.address.area}`,
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      addressCountry: site.address.country,
    },
    ...(site.geo ? { geo: { '@type': 'GeoCoordinates', latitude: site.geo.lat, longitude: site.geo.lng } } : {}),
    openingHoursSpecification: site.hours.schedule.map((s) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: s.days.map((d) => `https://schema.org/${d}`),
      opens: s.opens,
      closes: s.closes,
    })),
    areaServed: site.deliveryAreas.map((name) => (name === 'All Karachi'
      ? { '@type': 'City', name: site.address.city }
      : { '@type': 'Place', name: `${name}, ${site.address.city}` })),
    hasMap: site.maps.url,
    sameAs: Object.values(site.social).filter(Boolean),
  };
}

export function websiteJsonLd(ctx) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': absolute(ctx, '/#website'),
    url: absolute(ctx, '/'),
    name: ctx.site.name,
    publisher: { '@id': storeId(ctx) },
  };
}

// An Offer is only included when products.json lists a real price.
export function productJsonLd(ctx, p, image) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': absolute(ctx, `${p.url}#product`),
    name: `${p.brand} ${p.name}`,
    brand: { '@type': 'Brand', name: p.brand },
    category: p.categoryName,
    description: p.description,
    image: [absolute(ctx, image.full)],
    sku: p.id,
    size: p.size,
    url: absolute(ctx, p.url),
    ...(p.price ? {
      offers: {
        '@type': 'Offer',
        url: absolute(ctx, p.url),
        priceCurrency: 'PKR',
        price: String(p.price),
        availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@id': storeId(ctx) },
      },
    } : {}),
  };
}

// trail: [[name, path], …] — the last item is the current page.
export function breadcrumbJsonLd(ctx, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({
      '@type': 'ListItem', position: i + 1, name, item: absolute(ctx, path),
    })),
  };
}

export function sitemapXml(ctx, paths) {
  const lastmod = ctx.lastModified.toISOString().slice(0, 10);
  const urls = paths.map((p) => `  <url><loc>${escapeHtml(absolute(ctx, p))}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// Only production is indexable; any other environment (e.g. a staging copy) asks
// search engines to stay away entirely.
export function robotsTxt(ctx) {
  if (!ctx.isProduction) return 'User-agent: *\nDisallow: /\n';
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    `Disallow: ${ctx.adminPath}/`,
    '',
    `Sitemap: ${absolute(ctx, '/sitemap.xml')}`,
    '',
  ].join('\n');
}
