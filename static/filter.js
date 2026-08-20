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

  // Foods in the "foods to check" list; category and separator read once.
  const foods = Array.from(document.querySelectorAll('.food-list .food')).map((el) => ({
    el,
    category: el.dataset.category,
    sep: el.querySelector('.sep'),
  }));

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

  const apply = () => {
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

    // The "foods to check" list reflects only the category preferences, not the
    // search/hazard/year controls — its labels wouldn't match the search text.
    let lastFood = null;
    for (const f of foods) {
      f.el.hidden = !categories.has(f.category);
      if (!f.el.hidden) lastFood = f;
    }
    // Hide the comma on the last visible food so filtering out the final item
    // can't leave a dangling ", " behind.
    for (const f of foods) if (f.sep) f.sep.hidden = f === lastFood;

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

  for (const control of [q, hazard, year]) control.addEventListener('input', apply);
  for (const input of categoryInputs) {
    input.addEventListener('change', () => {
      prefsWarning.hidden = true;
      apply();
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
    apply();
  });

  prefsToggle.addEventListener('click', () => {
    setExpanded(prefsToggle.getAttribute('aria-expanded') !== 'true');
  });

  restore();
  apply();
})();
