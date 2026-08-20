import {
  CATEGORY_LABELS,
  HAZARD_CATEGORIES,
  HAZARD_LABELS,
  HAZARD_TO_CATEGORY,
  type Citation,
  type HazardCategory,
  type Product,
  type Recall,
} from './schema.ts';

/**
 * Pure data -> string rendering. Every value that came out of the YAML passes
 * through `escapeHtml` at the point of interpolation; notes are plain text by
 * design, so there is no path that emits author-supplied markup.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Formats `YYYY-MM-DD` by slicing the string. Deliberately avoids `new Date()`,
 * which parses a bare ISO date as UTC midnight and would render the previous
 * day for every reader in a US timezone.
 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Splits a note on blank lines so authors get paragraphs without needing markup. */
function paragraphs(note: string): string {
  return note
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n');
}

function renderProduct(product: Product): string {
  const brand = product.brand ? `<span class="brand">${escapeHtml(product.brand)}</span> ` : '';
  const codes = product.codes
    ? `<ul class="codes">${product.codes.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join('')}</ul>`
    : '';
  return `<li>${brand}${escapeHtml(product.name)}${codes}</li>`;
}

function renderCitation(citation: Citation): string {
  const publisher = citation.publisher
    ? ` <span class="publisher">${escapeHtml(citation.publisher)}</span>`
    : '';
  const accessed = citation.accessed
    ? ` <span class="accessed">accessed ${escapeHtml(formatDate(citation.accessed))}</span>`
    : '';
  return `<li><a href="${escapeHtml(citation.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(citation.title)}</a>${publisher}${accessed}</li>`;
}

type Fact = { readonly label: string; readonly value: string };

/** Small key/value chips shown under the title for the optional fields. */
function renderFacts(recall: Recall): string {
  const candidates: readonly (Fact | undefined)[] = [
    fact('Recalling firm', recall.recalling_firm),
    fact('Agency', recall.agency),
    fact('Class', recall.classification),
    fact('Distribution', recall.distribution),
    fact('Illnesses', recall.illnesses),
    fact('Deaths', recall.deaths),
    fact('Closed', recall.ended && formatDate(recall.ended)),
  ];
  const facts = candidates.filter((f) => f !== undefined);

  if (facts.length === 0) return '';
  return `<dl class="facts">${facts
    .map((f) => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`)
    .join('')}</dl>`;
}

/** Drops the fact entirely when the optional field is absent or empty. */
function fact(label: string, value: string | number | undefined): Fact | undefined {
  return value === undefined || value === '' ? undefined : { label, value: String(value) };
}

function renderParentLink(recall: Recall, byId: ReadonlyMap<string, Recall>): string {
  if (!recall.parent_id) return '';
  const parent = byId.get(recall.parent_id);
  if (!parent) return '';
  return `<p class="part-of">Part of: <a href="#${escapeHtml(parent.id)}">${escapeHtml(parent.title)}</a></p>`;
}

function renderRecall(recall: Recall, byId: ReadonlyMap<string, Recall>): string {
  // Data attributes drive the client-side filter; they hold raw values, not display text.
  return `
<article class="recall" id="${escapeHtml(recall.id)}"
         data-hazard="${escapeHtml(recall.hazard)}"
         data-category="${escapeHtml(HAZARD_TO_CATEGORY[recall.hazard])}"
         data-year="${escapeHtml(recall.date.slice(0, 4))}"
         data-search="${escapeHtml(searchIndex(recall))}">
  <header>
    <p class="meta">
      <time datetime="${escapeHtml(recall.date)}">${escapeHtml(formatDate(recall.date))}</time>
      <span class="hazard hazard-${escapeHtml(recall.hazard)}">${escapeHtml(HAZARD_LABELS[recall.hazard])}</span>
      ${recall.ended ? '<span class="closed">Closed</span>' : ''}
      ${recall.status === 'retracted' ? '<span class="closed">Retracted</span>' : ''}
    </p>
    <h2><a class="permalink" href="#${escapeHtml(recall.id)}">${escapeHtml(recall.title)}</a></h2>
    ${renderParentLink(recall, byId)}
  </header>
  ${renderFacts(recall)}
  <div class="note">${paragraphs(recall.note)}</div>
  <section class="products">
    <h3>Recalled products</h3>
    <ul>${recall.products.map(renderProduct).join('\n')}</ul>
  </section>
  <section class="citations">
    <h3>Citations</h3>
    <ol>${recall.citations.map(renderCitation).join('\n')}</ol>
  </section>
</article>`;
}

/** Lowercased haystack for the client-side search box. */
function searchIndex(recall: Recall): string {
  return [
    recall.title,
    recall.recalling_firm ?? '',
    recall.note,
    HAZARD_LABELS[recall.hazard],
    ...recall.products.flatMap((p) => [p.name, p.brand ?? '', ...(p.codes ?? [])]),
  ]
    .join(' ')
    .toLowerCase();
}

export type SiteMeta = {
  readonly title: string;
  readonly description: string;
  readonly siteUrl: string;
  readonly buildDate: string;
};

/** Compact "foods to check" list with anchor links to each entry, newest first. */
function renderSummary(recalls: readonly Recall[]): string {
  const items = recalls.flatMap((r) =>
    (r.summary ?? []).map((food) => ({ id: r.id, category: HAZARD_TO_CATEGORY[r.hazard], food })),
  );
  if (items.length === 0) return '';

  // Each item is wrapped so the client can hide it by category; the trailing
  // separator lives inside the wrapper so hiding an item hides its comma too.
  const links = items
    .map(
      (it, i) =>
        `<span class="food" data-category="${escapeHtml(it.category)}">` +
        `<a href="#${escapeHtml(it.id)}">${escapeHtml(it.food)}</a>` +
        (i < items.length - 1 ? '<span class="sep">, </span>' : '') +
        '</span>',
    )
    .join('');

  return `<section class="summary" aria-labelledby="summary-title">
  <h2 id="summary-title">Foods to check</h2>
  <p class="food-list">${links}</p>
</section>`;
}

/** Two calls to action: report a missed recall by email, and support the site. */
function renderActions(): string {
  return `<section class="actions" aria-label="Get involved">
  <a class="button" href="mailto:nebupookins@gmail.com?subject=New%20food%20recall%20to%20report">📧 Spotted a recall I missed? Let me know!</a>
  <a class="button button-secondary" href="https://ko-fi.com/nebupookins" target="_blank" rel="noopener noreferrer">☕ Find this list useful? Support the site!</a>
</section>`;
}

const CATEGORY_DESCRIPTIONS: Readonly<Record<HazardCategory, string>> = {
  pathogens: 'Germs like Salmonella, E. coli, Listeria and Cyclospora, plus chemical contamination — things you can’t see that shouldn’t be in your food.',
  'foreign-objects': 'Glass, metal, plastic or other things that shouldn’t be in food — but that you could spot if you looked.',
  'undeclared-allergens': 'Ingredients that are fine for some people but not others — nuts, milk, eggs, wheat, soy — when the label doesn’t say they’re there.',
  other: 'Processing problems and any other reason that doesn’t fit the three above.',
};

/** Collapsible "what do you care about" filter. Rendered open so it works with
 *  JS off; the client collapses it once preferences have been saved. */
function renderPreferences(): string {
  const checkboxes = HAZARD_CATEGORIES.map(
    (category) => `
    <label class="category">
      <input type="checkbox" name="category" value="${escapeHtml(category)}" checked>
      <span class="category-text">
        <span class="category-label">${escapeHtml(CATEGORY_LABELS[category])}</span>
        <span class="category-desc">${escapeHtml(CATEGORY_DESCRIPTIONS[category])}</span>
      </span>
    </label>`,
  ).join('\n');

  return `<section class="preferences" id="preferences" aria-label="What you care about">
  <button class="preferences-toggle" id="preferences-toggle" type="button" aria-expanded="true" aria-controls="preferences-body">
    <span class="preferences-heading">What do you care about?</span>
    <span class="preferences-caret" aria-hidden="true"></span>
  </button>
  <div class="preferences-body" id="preferences-body">
    <p class="preferences-intro">Only show recalls in the categories you check:</p>
    <div class="categories">
${checkboxes}
    </div>
    <button class="button" id="save-preferences" type="button">Save preferences</button>
    <p class="preferences-warning" id="preferences-warning" hidden>Choose at least one category to save.</p>
  </div>
</section>`;
}

export function renderIndex(recalls: readonly Recall[], meta: SiteMeta): string {
  const active = recalls.filter((r) => r.status !== 'retracted');
  const retracted = recalls.filter((r) => r.status === 'retracted');
  const years = [...new Set(active.map((r) => r.date.slice(0, 4)))].toSorted().toReversed();
  const hazards = [...new Set(active.map((r) => r.hazard))].toSorted((a, b) =>
    HAZARD_LABELS[a].localeCompare(HAZARD_LABELS[b]),
  );
  const byId = new Map(active.map((r) => [r.id, r] as const));
  // Searchable index of retracted alerts, embedded for the client-side search.
  const retractedData = JSON.stringify(
    retracted.map((r) => ({ id: r.id, title: r.title, search: searchIndex(r) })),
  ).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(meta.description)}">
<link rel="stylesheet" href="style.css">
<link rel="alternate" type="application/atom+xml" title="${escapeHtml(meta.title)}" href="feed.xml">
</head>
<body>
<header class="site-header">
  <h1>${escapeHtml(meta.title)}</h1>
  <p class="tagline">${escapeHtml(meta.description)}</p>
  <p class="site-links">
    <a href="feed.xml">Atom feed</a> ·
    <a href="recalls.json">JSON</a> ·
    <span>${active.length} recall${active.length === 1 ? '' : 's'}</span> ·
    <span>updated ${escapeHtml(formatDate(meta.buildDate))}</span>
  </p>
</header>

${renderPreferences()}

${renderSummary(active)}

${renderActions()}

<form class="filters" role="search" aria-label="Filter recalls">
  <label>Search
    <input type="search" id="q" placeholder="product, brand, firm…" autocomplete="off">
  </label>
  <label>Hazard
    <select id="hazard">
      <option value="">All</option>
      ${hazards.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(HAZARD_LABELS[h])}</option>`).join('\n      ')}
    </select>
  </label>
  <label>Year
    <select id="year">
      <option value="">All</option>
      ${years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('\n      ')}
    </select>
  </label>
</form>

<p class="result-count" id="count" role="status"></p>
<p class="retracted-hits" id="retracted-hits"></p>
<p class="filtered-out-hits" id="filtered-out-hits"></p>

<main id="recalls">
${active.map((r) => renderRecall(r, byId)).join('\n')}
</main>

<p class="empty" id="empty" hidden>No recalls match those filters.</p>

<footer class="site-footer">
  <p class="site-links"><a href="retracted.html">Retracted alerts</a></p>
  <p>Generated from YAML. Not affiliated with the FDA, FSIS or CDC. Always check the linked
     primary sources before acting on anything here.</p>
</footer>

<script id="retracted-data" type="application/json">${retractedData}</script>
<script src="filter.js"></script>
</body>
</html>
`;
}

/** A separate page listing retracted (withdrawn / false-positive) reports. */
export function renderRetractedPage(recalls: readonly Recall[], meta: SiteMeta): string {
  const retracted = recalls.filter((r) => r.status === 'retracted');
  const byId = new Map(recalls.map((r) => [r.id, r] as const));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Retracted alerts — ${escapeHtml(meta.title)}</title>
<meta name="description" content="Reports that were withdrawn or turned out to be false positives — not actual recalls.">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-header">
  <h1>Retracted alerts</h1>
  <p class="tagline">Reports that were withdrawn or turned out to be false positives. These are not actual recalls.</p>
  <p class="site-links"><a href="index.html">← Back to all recalls</a></p>
</header>

<main id="recalls">
${retracted.map((r) => renderRecall(r, byId)).join('\n')}
</main>

<footer class="site-footer">
  <p>Generated from YAML. Not affiliated with the FDA, FSIS or CDC. Always check the linked
     primary sources before acting on anything here.</p>
</footer>
</body>
</html>
`;
}

/** Atom feed. Uses each recall's date as the entry timestamp at UTC midnight. */
export function renderFeed(recalls: readonly Recall[], meta: SiteMeta): string {
  const base = meta.siteUrl.replace(/\/$/, '');
  const active = recalls.filter((r) => r.status !== 'retracted');
  const latest = active[0]?.date ?? meta.buildDate;

  const entries = active.slice(0, 50).map(
    (r) => `  <entry>
    <title>${escapeHtml(r.title)}</title>
    <link href="${escapeHtml(`${base}/#${r.id}`)}"/>
    <id>${escapeHtml(`${base}/#${r.id}`)}</id>
    <updated>${escapeHtml(r.date)}T00:00:00Z</updated>
    <category term="${escapeHtml(r.hazard)}"/>
    <summary>${escapeHtml(r.note)}</summary>
  </entry>`,
  );

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(meta.title)}</title>
  <subtitle>${escapeHtml(meta.description)}</subtitle>
  <link href="${escapeHtml(`${base}/feed.xml`)}" rel="self"/>
  <link href="${escapeHtml(`${base}/`)}"/>
  <id>${escapeHtml(`${base}/`)}</id>
  <author><name>${escapeHtml(meta.title)}</name></author>
  <updated>${escapeHtml(latest)}T00:00:00Z</updated>
${entries.join('\n')}
</feed>
`;
}
