// Renders every page — plus sitemap.xml and robots.txt — from validated data and
// uploaded media. The server keeps the result in memory and re-renders after each
// media change, so a request never touches the data files and pages are never
// half-updated.
import { createAssets } from '../lib/assets.js';
import { homePage } from './home.js';
import { productPage, listingPage } from './product.js';
import { errorPage } from './layout.js';
import { sitemapXml, robotsTxt } from './seo.js';

const NO_MEDIA = { hero: [], banner: [], gallery: [], product: new Map() };

// site: { siteUrl, adminPath, isProduction, lastModified }
export function renderSite(data, { publicDir, media = NO_MEDIA, site = {} }) {
  const ctx = {
    ...data,
    media,
    assets: createAssets(publicDir),
    siteUrl: site.siteUrl ?? 'http://localhost:3000',
    adminPath: site.adminPath ?? '/admin',
    isProduction: site.isProduction ?? false,
    lastModified: site.lastModified ?? new Date(),
  };
  const pages = new Map();
  pages.set('/', homePage(ctx));
  pages.set('/products', listingPage(ctx, null));
  for (const category of data.catalogue.categories) pages.set(category.url, listingPage(ctx, category));
  for (const product of data.catalogue.products) pages.set(product.url, productPage(ctx, product));

  const files = new Map([
    ['/sitemap.xml', { type: 'application/xml; charset=utf-8', body: sitemapXml(ctx, [...pages.keys()]) }],
    ['/robots.txt', { type: 'text/plain; charset=utf-8', body: robotsTxt(ctx) }],
  ]);
  return {
    pages,
    files,
    notFound: errorPage(ctx, 404),
    serverError: errorPage(ctx, 500),
  };
}
