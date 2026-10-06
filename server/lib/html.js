// HTML templating with escaping by default — the single XSS chokepoint for the views.
//   html`<p>${userText}</p>`   → userText is escaped
//   html`<ul>${items.map(...)}</ul>` → arrays of html`` fragments are joined as-is
//   raw(trustedMarkup)        → inserted without escaping (only for markup we wrote)

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export const raw = (markup) => new SafeHtml(String(markup));

// JSON for <script type="application/json|ld+json">: "<" is escaped so the data can
// never close the script element.
export const jsonScript = (data) => raw(JSON.stringify(data).replace(/</g, '\\u003c'));
