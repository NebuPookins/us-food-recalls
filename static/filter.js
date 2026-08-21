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
  const recallModal = document.getElementById('recall-modal');
  const recallModalBody = document.getElementById('recall-modal-body');
  const recallModalClose = document.getElementById('recall-modal-close');
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

  // Foods in the "foods to check" list, read once and grouped into recency
  // buckets. Within each bucket, the food-name link normally targets the newest
  // recall (`mainHref`); if that recall's own category gets filtered out while
  // an older one stays active, its `href` is stripped (see `applyFoods` below)
  // so it renders as inert text instead of a dead link. `alsoLinks` are the
  // earlier-recall "also previously" entries, each carrying the category of the
  // recall it points at.
  const buckets = Array.from(document.querySelectorAll('.summary-bucket')).map((bucketEl) => {
    const foods = Array.from(bucketEl.querySelectorAll('.food')).map((el) => {
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
    return {
      el: bucketEl,
      foods,
      // The plain-data view `decideFoods` needs: no DOM elements, so the decision
      // logic stays testable without a browser.
      foodData: foods.map(({ primaryCategory, alsoCategories }) => ({ primaryCategory, alsoCategories })),
    };
  });

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
  // with an `href` become links; items without one (category-filtered recalls,
  // which have no page to link to) become a button that opens the recall in a
  // modal instead.
  const renderNotice = (el, label, items) => {
    el.innerHTML = items.length
      ? `${label}: ${items
          .map((i) =>
            i.href
              ? `<a href="${i.href}">${escapeHtml(i.title)}</a>`
              : `<button type="button" class="link-button" data-recall-id="${escapeHtml(i.recallId)}">${escapeHtml(i.title)}</button>`,
          )
          .join(', ')}`
      : '';
  };

  // A category-filtered recall's `.recall-body` (the reusable content — see
  // `renderRecallBody` in src/render.ts) is still in the DOM, just inside a
  // `.recall` article that's currently `hidden`. Cloning `.recall-body`
  // specifically, rather than the whole article, means the clone never carries
  // the list-only `id`/`data-*` attributes in the first place — nothing to
  // strip. It does still carry two in-page anchors — the permalink and, for a
  // recall with a parent, the "Part of: …" link — whose `href="#id"` would
  // scroll the page behind the dialog to a (still-hidden) recall instead of
  // doing anything useful inside the modal, so both get removed.
  const openRecallModal = (recallId) => {
    const match = recallMeta.find((r) => r.id === recallId);
    if (!match) return;
    const clone = match.el.querySelector('.recall-body').cloneNode(true);
    clone.querySelector('.permalink')?.removeAttribute('href');
    clone.querySelector('.part-of a')?.removeAttribute('href');
    recallModalBody.replaceChildren(clone);
    recallModal.showModal();
    // The dialog box itself is the scrollable element (`dialog:modal` gets
    // `overflow: auto` from the UA stylesheet); reset it after showing so a
    // long recall scrolled last time doesn't leave the next one opening
    // mid-scroll. Setting this before `showModal()`, while the dialog is
    // still `display: none`, isn't reliable across browsers.
    recallModal.scrollTop = 0;
  };

  filteredOutHits.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-recall-id]');
    if (button) openRecallModal(button.dataset.recallId);
  });

  recallModalClose.addEventListener('click', () => recallModal.close());

  // Light-dismiss: a click that lands on the dialog element itself (not its
  // content, which is a child of the padded dialog box) hit the backdrop area.
  recallModal.addEventListener('click', (event) => {
    if (event.target === recallModal) recallModal.close();
  });

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
    // link couldn't scroll to them — offer a button that opens the recall in a
    // modal instead.
    renderNotice(
      filteredOutHits,
      'Filtered out alerts matching your search',
      hidden.map((r) => ({ title: r.title, recallId: r.id })),
    );
  };

  // The "foods to check" list reflects only the category preferences, not the
  // search/hazard/year controls, so it's kept separate from `applyRecalls` and
  // only called where a category might actually have changed — not on every
  // search keystroke. `decideFoods` also decides which separators would
  // otherwise dangle once filtered-out items drop out, at both the food level
  // and the "also previously" level, so this loop only has to apply its verdict.
  const applyFoods = () => {
    const categories = activeCategories();

    // `decideFoods` is applied per bucket so its separator logic (drop the
    // trailing comma after the last visible food) runs within each bucket, not
    // across the whole list. A bucket whose foods are all filtered out is
    // hidden along with its heading.
    for (const bucket of buckets) {
      const decisions = decideFoods(bucket.foodData, categories);

      bucket.foods.forEach((f, i) => {
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

      bucket.el.hidden = !decisions.some((d) => d.visible);
    }
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
