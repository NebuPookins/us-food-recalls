import { decideFoods } from './food-filter.js';

// Progressive enhancement: the full list is already in the HTML, this only hides
// non-matching cards. With JS off the page still works, just unfiltered.
(() => {
  const q = document.getElementById('q');
  const hazard = document.getElementById('hazard');
  const year = document.getElementById('year');
  const count = document.getElementById('count');
  const empty = document.getElementById('empty');
  const retractedHits = document.getElementById('retracted-hits');
  const filteredOutHits = document.getElementById('filtered-out-hits');
  const recalls = Array.from(document.querySelectorAll('.recall'));

  const categoryInputs = Array.from(document.querySelectorAll('input[name="category"]'));
  const prefsToggle = document.getElementById('preferences-toggle');
  const prefsBody = document.getElementById('preferences-body');
  const prefsWarning = document.getElementById('preferences-warning');
  const savePrefs = document.getElementById('save-preferences');

  // Stored as the categories the reader *unchecked* (a denylist), so a category
  // added to the site later defaults to visible for returning readers.
  const STORAGE_KEY = 'recall-categories';

  // Retracted alerts live on retracted.html; the search surfaces them here.
  const retractedData = document.getElementById('retracted-data');
  const retracted = retractedData ? JSON.parse(retractedData.textContent) : [];

  // Read each recall's fields once at startup instead of re-reading the DOM on
  // every keystroke. `title` is needed to link hidden matches, so normalize the
  // `.recall` elements to the same {id, title, search} shape as `retracted`.
  const recallMeta = recalls.map((el) => ({
    el,
    id: el.id,
    title: el.querySelector('.permalink').textContent,
    hazard: el.dataset.hazard,
    year: el.dataset.year,
    category: el.dataset.category,
    search: el.dataset.search,
  }));

  // Foods in the "foods to check" list, read once. The food-name link normally
  // targets the newest recall (`mainHref`); if that recall's own category gets
  // filtered out while an older one stays active, its `href` is stripped (see
  // `applyFoods` below) so it renders as inert text instead of a dead link.
  // `alsoLinks` are the earlier-recall "also previously" entries, each carrying
  // the category of the recall it points at.
  const foods = Array.from(document.querySelectorAll('.food-list .food')).map((el) => {
    const mainLink = el.querySelector('a');
    const alsoLinks = Array.from(el.querySelectorAll('.also-previously .also-link'));
    return {
      el,
      mainLink,
      mainHref: mainLink.getAttribute('href'),
      primaryCategory: mainLink.dataset.category,
      sep: el.querySelector('.sep'),
      also: el.querySelector('.also-previously'),
      alsoLinks,
      alsoSeps: alsoLinks.map((link) => link.querySelector('.also-sep')),
      alsoCategories: alsoLinks.map((link) => link.querySelector('a')?.dataset.category ?? ''),
    };
  });

  // The plain-data view `decideFoods` needs: no DOM elements, so the decision
  // logic stays testable without a browser.
  const foodData = foods.map(({ primaryCategory, alsoCategories }) => ({ primaryCategory, alsoCategories }));

  const escapeHtml = (s) =>
    s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

  const activeCategories = () =>
    new Set(categoryInputs.filter((i) => i.checked).map((i) => i.value));

  const setExpanded = (expanded) => {
    prefsToggle.setAttribute('aria-expanded', String(expanded));
    prefsBody.hidden = !expanded;
  };

  const matchesSearch = (haystack, terms) => terms.every((t) => haystack.includes(t));

  // One renderer for the two "… matching your search" notices (retracted alerts
  // and category-filtered-out recalls), so their markup stays in sync. Items
  // with an `href` become links; without one they render as plain text.
  const renderNotice = (el, label, items) => {
    el.innerHTML = items.length
      ? `${label}: ${items
          .map((i) => (i.href ? `<a href="${i.href}">${escapeHtml(i.title)}</a>` : escapeHtml(i.title)))
          .join(', ')}`
      : '';
  };

  // Recall cards depend on search/hazard/year *and* category, so this reruns on
  // every keystroke as well as every category change.
  const applyRecalls = () => {
    const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const categories = activeCategories();

    let visible = 0;
    const hidden = [];
    for (const r of recallMeta) {
      const inCategory = categories.has(r.category);
      const searchHit = matchesSearch(r.search, terms);
      const show =
        (hazard.value === '' || r.hazard === hazard.value) &&
        (year.value === '' || r.year === year.value) &&
        inCategory &&
        searchHit;
      r.el.hidden = !show;
      if (show) visible++;
      else if (terms.length > 0 && !inCategory && searchHit) hidden.push(r);
    }

    count.textContent = `Showing ${visible} of ${recalls.length} recalls`;
    empty.hidden = visible > 0;

    const retractedMatches =
      terms.length > 0 ? retracted.filter((r) => matchesSearch(r.search, terms)) : [];
    renderNotice(
      retractedHits,
      'Retracted alerts matching your search',
      retractedMatches.map((r) => ({ href: `retracted.html#${r.id}`, title: r.title })),
    );

    // No href: the matching recalls are hidden on this page (by category), so a
    // link couldn't scroll to them — just name them so the reader knows why.
    renderNotice(
      filteredOutHits,
      'Filtered out alerts matching your search',
      hidden.map((r) => ({ title: r.title })),
    );
  };

  // The "foods to check" list reflects only the category preferences, not the
  // search/hazard/year controls, so it's kept separate from `applyRecalls` and
  // only called where a category might actually have changed — not on every
  // search keystroke. `decideFoods` also decides which separators would
  // otherwise dangle once filtered-out items drop out, at both the food level
  // and the "also previously" level, so this loop only has to apply its verdict.
  const applyFoods = () => {
    const decisions = decideFoods(foodData, activeCategories());

    foods.forEach((f, i) => {
      const d = decisions[i];
      f.el.hidden = !d.visible;
      if (f.sep) f.sep.hidden = !d.sepVisible;

      // Strip the food-name link's href when its own (newest-recall) category
      // is filtered out, so it renders as inert text instead of a dead link;
      // restore it once that category is active again.
      if (d.primaryVisible) f.mainLink.setAttribute('href', f.mainHref);
      else f.mainLink.removeAttribute('href');

      f.alsoLinks.forEach((link, j) => {
        link.hidden = !d.alsoVisible[j];
        if (f.alsoSeps[j]) f.alsoSeps[j].hidden = !d.alsoSepVisible[j];
      });
      if (f.also) f.also.hidden = !d.anyAlsoVisible;
    });
  };

  const persist = () => {
    try {
      const unchecked = categoryInputs.filter((i) => !i.checked).map((i) => i.value);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unchecked));
    } catch {
      // Storage may be unavailable (private browsing); the filter still works this session.
    }
  };

  const restore = () => {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return; // Storage unavailable or malformed: keep defaults (everything checked, panel open).
    }
    if (!Array.isArray(saved)) return; // First visit: everything checked, panel open.
    for (const input of categoryInputs) input.checked = !saved.includes(input.value);
    setExpanded(false);
  };

  for (const control of [q, hazard, year]) control.addEventListener('input', applyRecalls);
  for (const input of categoryInputs) {
    input.addEventListener('change', () => {
      prefsWarning.hidden = true;
      applyRecalls();
      applyFoods();
    });
  }

  savePrefs.addEventListener('click', () => {
    if (activeCategories().size === 0) {
      prefsWarning.hidden = false;
      return;
    }
    prefsWarning.hidden = true;
    persist();
    setExpanded(false);
    applyRecalls();
    applyFoods();
  });

  prefsToggle.addEventListener('click', () => {
    setExpanded(prefsToggle.getAttribute('aria-expanded') !== 'true');
  });

  restore();
  applyRecalls();
  applyFoods();
})();
