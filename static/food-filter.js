/**
 * Pure decision logic for the "foods to check" list. Separated from filter.js
 * (the DOM glue) so it can be unit-tested without a browser.
 *
 * The static HTML already contains every food and "also previously" link; this
 * says which of them a set of category preferences should leave visible, plus
 * which trailing commas would otherwise dangle once the hidden ones drop out.
 *
 * Also covers the search box's effect on that same list: which foods still
 * match the typed terms (`matchesSearch`) and which substrings of a food's
 * label should be highlighted (`matchRanges`/`highlightHtml`).
 */

/** True for every visible entry except the last one — its separator would dangle. */
function separatorVisibility(visible) {
  const lastVisible = visible.lastIndexOf(true);
  return visible.map((v, i) => v && i !== lastVisible);
}

/** True when any value in `values` is in the `active` set. */
export function overlaps(values, active) {
  return values.some((v) => active.has(v));
}

/** True when every search term appears somewhere in `haystack` (both already lowercased). */
export function matchesSearch(haystack, terms) {
  return terms.every((t) => haystack.includes(t));
}

/**
 * @param {ReadonlyArray<{ primaryCategories: readonly string[], alsoCategories: readonly (readonly string[])[] }>} foods
 *   One entry per food label. `primaryCategories` are the categories of the food's
 *   own link target (the newest alert); `alsoCategories` are the categories of
 *   each earlier-alert ("also previously") link, in display order.
 * @param {ReadonlySet<string>} activeCategories
 * @returns {ReadonlyArray<{
 *   visible: boolean,
 *   primaryVisible: boolean,
 *   sepVisible: boolean,
 *   alsoVisible: readonly boolean[],
 *   alsoSepVisible: readonly boolean[],
 *   anyAlsoVisible: boolean,
 * }>}
 */
export function decideFoods(foods, activeCategories) {
  const decided = foods.map((food) => {
    const primaryVisible = overlaps(food.primaryCategories, activeCategories);
    const alsoVisible = food.alsoCategories.map((cats) => overlaps(cats, activeCategories));
    const anyAlsoVisible = alsoVisible.some(Boolean);
    return { primaryVisible, visible: primaryVisible || anyAlsoVisible, alsoVisible, anyAlsoVisible };
  });

  const sepVisible = separatorVisibility(decided.map((d) => d.visible));

  return decided.map((d, i) => ({
    ...d,
    sepVisible: sepVisible[i],
    alsoSepVisible: separatorVisibility(d.alsoVisible),
  }));
}

/**
 * Case-insensitive spans in `text` covered by any of `terms`, merged where they
 * overlap or touch and sorted left to right. Used to bold the part of a food
 * label the reader actually typed, when a term happens to land inside it (the
 * search itself may also match on a recall's firm name, note, etc. — text
 * that isn't in the label at all, so there's nothing to highlight there).
 * @param {string} text
 * @param {readonly string[]} terms
 * @returns {ReadonlyArray<readonly [number, number]>}
 */
export function matchRanges(text, terms) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    let at;
    while ((at = lower.indexOf(term, from)) !== -1) {
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/**
 * Renders `text` as HTML with `ranges` wrapped in `<strong>`, escaping
 * everything else with the caller-supplied `escapeHtml` (kept out of this
 * module so it stays DOM-free and callable from a plain Node test).
 * @param {string} text
 * @param {ReadonlyArray<readonly [number, number]>} ranges
 * @param {(s: string) => string} escapeHtml
 */
export function highlightHtml(text, ranges, escapeHtml) {
  let out = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    out += escapeHtml(text.slice(cursor, start));
    out += `<strong>${escapeHtml(text.slice(start, end))}</strong>`;
    cursor = end;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}
