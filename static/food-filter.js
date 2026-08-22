/**
 * Pure decision logic for the "foods to check" list. Separated from filter.js
 * (the DOM glue) so it can be unit-tested without a browser.
 *
 * The static HTML already contains every food and "also previously" link; this
 * says which of them a set of category preferences should leave visible, plus
 * which trailing commas would otherwise dangle once the hidden ones drop out.
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
