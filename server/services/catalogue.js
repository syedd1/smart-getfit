// Loads data/products.json and data/site.json once, validates them, and derives
// everything the views need (URLs, WhatsApp links, alt text, category groupings).
// Any problem throws DataError, so the server refuses to start rather than serve
// a partially broken catalogue.
import fs from 'node:fs';
import path from 'node:path';
import { catalogueSchema, siteSchema, formatIssues } from '../lib/validate.js';

export class DataError extends Error {
  constructor(file, problems) {
    super(`${file} is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'DataError';
    this.file = file;
    this.problems = problems;
  }
}

function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new DataError(path.basename(file), [`cannot read file (${err.code || err.message})`]);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new DataError(path.basename(file), [`not valid JSON: ${err.message}`]);
  }
}

function validate(file, schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new DataError(path.basename(file), formatIssues(result.error));
  return result.data;
}

const fill = (template, product) => template.replaceAll('{product}', product);
const formatPrice = (pkr) => `Rs ${pkr.toLocaleString('en-PK')}`;

export function loadData({ dataDir, publicDir }) {
  const siteFile = path.join(dataDir, 'site.json');
  const catalogueFile = path.join(dataDir, 'products.json');
  const site = validate(siteFile, siteSchema, readJson(siteFile));
  const data = validate(catalogueFile, catalogueSchema, readJson(catalogueFile));

  // Every referenced image must exist, or the page would show broken images.
  const missing = [];
  const checkImage = (where, src) => {
    if (src && !fs.existsSync(path.join(publicDir, src))) missing.push(`${where}: image not found: public${src}`);
  };
  data.categories.forEach((c, i) => checkImage(`categories[${i}].image`, c.image));
  data.products.forEach((p, i) => checkImage(`products[${i}].image`, p.image));
  if (missing.length) throw new DataError('products.json', missing);

  const waLink = (message) => `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(message)}`;
  const msg = site.whatsappMessages;

  const phoneHref = `tel:${site.phone.international}`;
  const builtSite = {
    ...site,
    phoneHref,
    wa: {
      general: waLink(msg.general),
      missingProduct: waLink(msg.missingProduct),
      wholesale: waLink(msg.wholesale),
    },
  };
  return {
    site: builtSite,
    catalogue: buildCatalogue(builtSite, data),
    base: data, // the validated products.json, for rebuilding with admin-added products
  };
}

// The catalogue from products.json plus `added` (products from the admin panel, already
// checked: unique ids, existing categories). Added products come after the built-in ones.
export function buildCatalogue(site, data, added = []) {
  const waLink = (message) => `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(message)}`;
  const msg = site.whatsappMessages;

  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const products = [...data.products, ...added].map((p) => {
    const category = categoryById.get(p.category);
    const variant = p.flavour ? `${p.size} · ${p.flavour}` : p.size;
    const label = `${p.brand} ${p.name} (${variant})`;
    return {
      ...p,
      categoryName: category.name,
      variant,
      title: `${p.brand} ${p.name}`,
      alt: `${p.brand} ${p.name} ${variant} — ${category.name}`,
      url: `/products/${p.id}`,
      priceText: p.price ? formatPrice(p.price) : null,
      waPrice: waLink(fill(msg.productPrice, label)),
      waAvailability: waLink(fill(msg.productAvailability, label)),
      waAbout: waLink(fill(msg.productAbout, label)),
    };
  });

  const categories = data.categories.map((c, i) => {
    const items = products.filter((p) => p.category === c.id);
    return {
      ...c,
      number: String(i + 1).padStart(2, '0'),
      url: `/products/${c.id}`,
      products: items,
    };
  });

  return {
    categories,
    products,
    featured: products.filter((p) => p.featured),
    brands: [...new Set(products.map((p) => p.brand))],
    productById: new Map(products.map((p) => [p.id, p])),
    categoryById: new Map(categories.map((c) => [c.id, c])),
  };
}
