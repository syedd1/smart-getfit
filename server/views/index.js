// Renders every page from validated data plus uploaded media. The server keeps the
// result in memory and re-renders after each media change, so a request never touches
// the data files and pages are never half-updated.
import { createAssetSizer } from '../lib/assets.js';
import { homePage } from './home.js';
import { productPage, listingPage } from './product.js';
import { errorPage } from './layout.js';

const NO_MEDIA = { hero: [], banner: [], gallery: [], product: new Map() };

export function renderSite(data, { publicDir, media = NO_MEDIA }) {
  const ctx = { ...data, media, size: createAssetSizer(publicDir) };
  const pages = new Map();
  pages.set('/', homePage(ctx));
  pages.set('/products', listingPage(ctx, null));
  for (const category of data.catalogue.categories) pages.set(category.url, listingPage(ctx, category));
  for (const product of data.catalogue.products) pages.set(product.url, productPage(ctx, product));
  return {
    pages,
    notFound: errorPage(ctx, 404),
    serverError: errorPage(ctx, 500),
  };
}
