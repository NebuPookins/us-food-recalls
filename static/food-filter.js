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

/**
 * @param {ReadonlyArray<{ primaryCategory: string, alsoCategories: readonly string[] }>} foods
 *   One entry per food label. `primaryCategory` is the category of the food's
 *   own link target (the newest recall); `alsoCategories` is the category of
 *   each earlier-recall ("also previously") link, in display order.
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
    const primaryVisible = activeCategories.has(food.primaryCategory);
    const alsoVisible = food.alsoCategories.map((c) => activeCategories.has(c));
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
