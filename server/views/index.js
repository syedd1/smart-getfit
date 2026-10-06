// Renders every page once from validated data. The server keeps the result in memory,
// so a request never touches the data files and the pages can't be half-updated.
import { createAssetSizer } from '../lib/assets.js';
import { homePage } from './home.js';
import { productPage, listingPage } from './product.js';
import { errorPage } from './layout.js';

export function renderSite(data, { publicDir }) {
  const ctx = { ...data, size: createAssetSizer(publicDir) };
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
