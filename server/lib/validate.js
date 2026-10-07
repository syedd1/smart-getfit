// Zod schemas for the data files. Request-body schemas are added here in later phases.
import { z } from 'zod';

// URL-safe id: lowercase words joined by single hyphens ("whey-protein").
export const slug = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase-words-with-hyphens');

// A WebP file under public/assets/ — no "..", no query strings, no external URLs.
// (Photos uploaded through the admin panel are converted automatically; these are the built-in ones.)
const assetPath = z.string().max(200)
  .regex(/^\/assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.webp$/, 'must be a WebP image path like /assets/products/name.webp');

const httpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain });
const text = (max) => z.string().trim().min(1).max(max);

// ── products.json ─────────────────────────────────────────────────────────
const category = z.strictObject({
  id: slug,
  name: text(40),
  shortName: text(20).optional(),   // label on the mobile filter chips
  image: assetPath.optional(),      // tile photo when the category has no products yet
});

const product = z.strictObject({
  id: slug,                          // also the URL: /products/<id>. Don't rename once media is attached.
  brand: text(60),
  name: text(80),
  category: slug,
  size: text(40),
  flavour: text(40).optional(),
  description: text(300),
  image: assetPath,
  price: z.number().int().positive().max(10_000_000).optional(), // PKR; omit → "Ask for Price"
  available: z.boolean().default(true),
  featured: z.boolean().default(false),
});

export const catalogueSchema = z.strictObject({
  categories: z.array(category).min(1),
  products: z.array(product),
}).superRefine((data, ctx) => {
  const categoryIds = new Set();
  data.categories.forEach((c, i) => {
    if (categoryIds.has(c.id)) ctx.addIssue({ code: 'custom', path: ['categories', i, 'id'], message: `duplicate category id "${c.id}"` });
    categoryIds.add(c.id);
  });
  const productIds = new Set();
  data.products.forEach((p, i) => {
    if (productIds.has(p.id)) ctx.addIssue({ code: 'custom', path: ['products', i, 'id'], message: `duplicate product id "${p.id}"` });
    if (categoryIds.has(p.id)) ctx.addIssue({ code: 'custom', path: ['products', i, 'id'], message: `product id "${p.id}" clashes with a category id (both live under /products/)` });
    if (!categoryIds.has(p.category)) ctx.addIssue({ code: 'custom', path: ['products', i, 'category'], message: `unknown category "${p.category}"` });
    productIds.add(p.id);
  });
});

// ── site.json ─────────────────────────────────────────────────────────────
const day = z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24-hour)');
const productTemplate = text(300).refine((s) => s.includes('{product}'), 'must contain {product}');

export const siteSchema = z.strictObject({
  name: text(80),
  foundingYear: z.number().int().min(1900).max(2100),
  phone: z.strictObject({
    display: text(30),
    international: z.string().regex(/^\+\d{8,15}$/, 'must look like +923001234567'),
  }),
  whatsapp: z.strictObject({
    display: text(30),
    number: z.string().regex(/^\d{8,15}$/, 'digits only, with country code, e.g. 923001234567'),
  }),
  address: z.strictObject({
    street: text(120),
    area: text(60),
    city: text(60),
    region: text(60),
    country: z.string().regex(/^[A-Z]{2}$/),
    display: text(200),
  }),
  geo: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  hours: z.strictObject({
    display: text(80),
    schedule: z.array(z.strictObject({ days: z.array(day).min(1), opens: time, closes: time })).min(1),
  }),
  maps: z.strictObject({
    url: httpsUrl,
    embedUrl: httpsUrl.refine((u) => /^https:\/\/(?:www\.|maps\.)?google\.com\//.test(u), 'must be a google.com maps embed URL'),
  }),
  social: z.strictObject({ instagram: httpsUrl.optional(), facebook: httpsUrl.optional() }),
  deliveryAreas: z.array(text(40)).min(1),
  marquee: z.array(text(60)).min(1),
  whatsappMessages: z.strictObject({
    general: text(300),
    missingProduct: text(300),
    wholesale: text(300),
    productPrice: productTemplate,
    productAvailability: productTemplate,
    productAbout: productTemplate,
  }),
  reviews: z.strictObject({
    rating: z.number().min(0).max(5),
    count: z.number().int().min(0),
    url: httpsUrl,
    items: z.array(z.strictObject({ name: text(60), text: text(600) })),
  }),
});

// ── Admin API input ───────────────────────────────────────────────────────
const section = z.enum(['product', 'hero', 'banner', 'gallery']);
// Control characters and bidirectional overrides (which can make text display as
// something else) are removed rather than stored.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const alt = z.string().transform((s) => s.replace(UNSAFE_TEXT, '').trim()).pipe(z.string().max(200, 'Alt text can be at most 200 characters'));
const emptyToUndefined = (v) => (v === '' || v === null ? undefined : v);

export const loginSchema = z.strictObject({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

// Multipart form fields arrive as strings; an empty productId means "none".
export const uploadFieldsSchema = z.object({
  section,
  productId: z.preprocess(emptyToUndefined, slug.optional()),
  alt: alt.default(''),
});

export const mediaUpdateSchema = z.strictObject({
  section: section.optional(),
  productId: slug.nullable().optional(),
  alt: alt.optional(),
}).refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const reorderSchema = z.strictObject({
  section,
  productId: slug.nullable().optional(),
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

export const mediaId = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number);

// Products added in the admin panel: the same limits as products.json, with unsafe
// characters removed like alt text. Line breaks and tabs become spaces first, so words
// typed on separate lines don't run together.
const tidy = (s) => s.replace(/\s*[\r\n\t]+\s*/g, ' ').replace(UNSAFE_TEXT, '').trim();
const cleanText = (label, max) => z.string().transform(tidy)
  .pipe(z.string().min(1, `${label} is required`).max(max, `${label} can be at most ${max} characters`));
const optionalText = (label, max) => z.preprocess((v) => (typeof v === 'string' && tidy(v) === '' ? null : v),
  cleanText(label, max).nullable().default(null));

const productFields = {
  brand: cleanText('Brand', 60),
  name: cleanText('Name', 80),
  category: slug,
  size: cleanText('Size', 40),
  flavour: optionalText('Flavour', 40),
  description: cleanText('Description', 300),
  price: z.number({ error: 'Price must be a whole number of rupees' }).int('Price must be a whole number of rupees')
    .positive('Price must be more than 0').max(10_000_000, 'Price can be at most 10,000,000').nullable().default(null),
  available: z.boolean().default(true),
  featured: z.boolean().default(false),
};

export const productCreateSchema = z.strictObject({
  id: z.string().max(80, 'The web address can be at most 80 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'The web address must be lowercase letters and numbers joined by single hyphens'),
  ...productFields,
});

// The id never changes: it is the page address and links the product's photos.
export const productUpdateSchema = z.strictObject(productFields);

// "products[3].category: unknown category "wey"" — one line per issue, for startup logs.
export function formatIssues(error) {
  return error.issues.map((i) => {
    const where = i.path.reduce((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${String(p)}` : String(p)), '');
    return `${where || '(root)'}: ${i.message}`;
  });
}
