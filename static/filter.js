import { activeSearchTexts, decideFoods, highlightHtml, matchesSearch, matchRanges, overlaps } from './food-filter.js';

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
    hazards: el.dataset.hazards.split(' '),
    year: el.dataset.year,
    categories: el.dataset.category.split(' '),
    search: el.dataset.search,
  }));

  // Looked up when deciding whether a "foods to check" entry still matches the
  // search box: each food links to one or more recalls (its primary alert plus
  // any "also previously" ones), and the food matches if any of them do.
  const searchById = new Map(recallMeta.map((r) => [r.id, r.search]));

  // The "foods to check" list, read once. `foods` is a flat list in server
  // (newest-first) order; each food-name and "also previously" link carries the
  // recall's ISO date (`data-date`) and its server-computed recency bucket
  // (`data-bucket`), so a food whose newest recall gets filtered out can be
  // re-pointed at the newest survivor and re-bucketed under that survivor's
  // precomputed bucket (see `applyFoods` below).
  const summary = document.querySelector('.summary');

  // Every recency bucket is pre-rendered by the server (empty ones `hidden`),
  // so the client only re-parents foods between existing lists — it never has to
  // construct a bucket or compute one from a date.
  const bucketByLabel = new Map();
  if (summary) {
    for (const bucketEl of summary.querySelectorAll('.summary-bucket')) {
      const label = bucketEl.querySelector('.summary-bucket-title').textContent;
      bucketByLabel.set(label, { el: bucketEl, list: bucketEl.querySelector('.food-list') });
    }
  }

  const foods = summary
    ? Array.from(summary.querySelectorAll('.food')).map((el) => {
        const mainLink = el.querySelector('a');
        const alsoLinks = Array.from(el.querySelectorAll('.also-previously .also-link'));
        const alsoAnchors = alsoLinks.map((link) => link.querySelector('a'));
        const anchors = [mainLink, ...alsoAnchors];
        return {
          el,
          mainLink,
          mainHref: mainLink.getAttribute('href'),
          label: mainLink.textContent,
          searchTexts: anchors.map((a) => searchById.get(a.getAttribute('href').slice(1))).filter(Boolean),
          primaryCategories: mainLink.dataset.category.split(' '),
          sep: el.querySelector('.sep'),
          also: el.querySelector('.also-previously'),
          alsoLinks,
          alsoAnchors,
          alsoSeps: alsoLinks.map((link) => link.querySelector('.also-sep')),
          alsoCategories: alsoAnchors.map((a) => a.dataset.category.split(' ')),
          dates: anchors.map((a) => a.dataset.date),
          buckets: anchors.map((a) => a.dataset.bucket),
        };
      })
    : [];

  const foodData = foods.map(({ primaryCategories, alsoCategories }) => ({ primaryCategories, alsoCategories }));

  const escapeHtml = (s) =>
    s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

  const activeCategories = () =>
    new Set(categoryInputs.filter((i) => i.checked).map((i) => i.value));

  // Shared by `applyRecalls` and `applyFoodSearch`, both of which rerun on every
  // search keystroke and need the same lowercased, whitespace-split terms.
  const searchTerms = () => q.value.toLowerCase().split(/\s+/).filter(Boolean);

  const setExpanded = (expanded) => {
    prefsToggle.setAttribute('aria-expanded', String(expanded));
    prefsBody.hidden = !expanded;
  };

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
    const terms = searchTerms();
    const categories = activeCategories();

    let visible = 0;
    const hidden = [];
    for (const r of recallMeta) {
      const inCategory = overlaps(r.categories, categories);
      const searchHit = matchesSearch(r.search, terms);
      const show =
        (hazard.value === '' || r.hazards.includes(hazard.value)) &&
        (year.value === '' || r.year === year.value) &&
        inCategory &&
        searchHit;
      r.el.hidden = !show;
      if (show) visible++;
      else if (terms.length > 0 && !inCategory && searchHit) hidden.push(r);
    }

    count.textContent = `Showing ${visible} of ${recalls.length} alerts`;
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

  // Applies one food's category decision to its DOM: points the name link at the
  // effective primary, hides the suppressed/also links, and sets the trailing
  // separator. Search dimming/highlighting is separate (`applyFoodSearch`),
  // since it depends on the query, not the categories.
  const applyFoodItem = (f, d, bucketSize, idx) => {
    if (d.primaryIndex === 0) {
      f.mainLink.setAttribute('href', f.mainHref);
    } else {
      f.mainLink.setAttribute('href', f.alsoAnchors[d.primaryIndex - 1].getAttribute('href'));
    }

    f.alsoLinks.forEach((link, j) => {
      link.hidden = !d.alsoVisible[j];
      if (f.alsoSeps[j]) f.alsoSeps[j].hidden = !d.alsoSepVisible[j];
    });
    if (f.also) f.also.hidden = !d.anyAlsoVisible;

    // Trailing comma on every food except the last in its bucket.
    f.sep.hidden = idx === bucketSize - 1;
  };

  // Search dims/highlights whatever `applyFoods` left visible. Kept separate
  // from `applyFoods` so the bucket re-parenting work below runs only on
  // category changes, not on every search keystroke.
  const applyFoodSearch = (decisions = null) => {
    const terms = searchTerms();
    const categories = activeCategories();
    const currentDecisions = decisions ?? decideFoods(foodData, categories);

    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (f.el.hidden) continue;
      const activeTexts = activeSearchTexts(f.searchTexts, currentDecisions[i]);
      const matches = terms.length === 0 || activeTexts.some((h) => matchesSearch(h, terms));
      f.el.classList.toggle('dim', !matches);
      f.mainLink.innerHTML = matches
        ? highlightHtml(f.label, matchRanges(f.label, terms), escapeHtml)
        : escapeHtml(f.label);
    }
  };

  // The "foods to check" list's visibility reflects only the category
  // preferences, not the search/hazard/year controls — so it's kept separate
  // from `applyRecalls` and only called where a category might actually have
  // changed. `decideFoods` promotes the newest surviving recall to the
  // food-name link and suppresses the newer filtered-out ones; this loop then
  // re-parents each food into the bucket of its effective primary (read from
  // `data-bucket`, which the server already computed) and applies the verdict.
  const applyFoods = () => {
    if (!summary) return; // no "foods to check" list on this page
    const categories = activeCategories();
    const decisions = decideFoods(foodData, categories);

    // Group each visible food under its effective primary's bucket.
    const foodsByBucket = new Map();
    for (const [i, d] of decisions.entries()) {
      foods[i].el.hidden = !d.visible;
      if (!d.visible) continue;
      const f = foods[i];
      const label = f.buckets[d.primaryIndex];
      const list = foodsByBucket.get(label);
      if (list) list.push({ f, d });
      else foodsByBucket.set(label, [{ f, d }]);
    }

    // Newest-first within each bucket; ties keep the server's original order.
    for (const [label, bucket] of bucketByLabel) {
      const items = (foodsByBucket.get(label) ?? []).toSorted((a, b) => {
        const da = a.f.dates[a.d.primaryIndex];
        const db = b.f.dates[b.d.primaryIndex];
        return da < db ? 1 : da > db ? -1 : 0;
      });
      const els = [];
      for (const [idx, { f, d }] of items.entries()) {
        applyFoodItem(f, d, items.length, idx);
        els.push(f.el);
      }
      bucket.list.replaceChildren(...els);
      bucket.el.hidden = items.length === 0;
    }

    applyFoodSearch(decisions);
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
  // `applyFoodSearch` takes an optional decisions array (reused by `applyFoods`),
  // so a bare reference here would receive the `input` event as that argument
  // and leave every food dim.
  q.addEventListener('input', () => applyFoodSearch());
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
