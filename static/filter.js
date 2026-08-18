// Progressive enhancement: the full list is already in the HTML, this only hides
// non-matching cards. With JS off the page still works, just unfiltered.
(() => {
  const q = document.getElementById('q');
  const hazard = document.getElementById('hazard');
  const year = document.getElementById('year');
  const count = document.getElementById('count');
  const empty = document.getElementById('empty');
  const retractedHits = document.getElementById('retracted-hits');
  const recalls = Array.from(document.querySelectorAll('.recall'));

  // Retracted alerts live on retracted.html; the search surfaces them here.
  const retractedData = document.getElementById('retracted-data');
  const retracted = retractedData ? JSON.parse(retractedData.textContent) : [];

  const matches = (el, terms, hazardValue, yearValue) =>
    (hazardValue === '' || el.dataset.hazard === hazardValue) &&
    (yearValue === '' || el.dataset.year === yearValue) &&
    terms.every((term) => el.dataset.search.includes(term));

  const escapeHtml = (s) =>
    s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

  const apply = () => {
    const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const visible = recalls.filter((el) => {
      const show = matches(el, terms, hazard.value, year.value);
      el.hidden = !show;
      return show;
    });

    count.textContent = `Showing ${visible.length} of ${recalls.length} recalls`;
    empty.hidden = visible.length > 0;

    const retractedMatches =
      terms.length > 0 ? retracted.filter((r) => terms.every((t) => r.search.includes(t))) : [];
    retractedHits.innerHTML = retractedMatches.length
      ? `Retracted alerts matching your search: ${retractedMatches
          .map((r) => `<a href="retracted.html#${r.id}">${escapeHtml(r.title)}</a>`)
          .join(', ')}`
      : '';
  };

  for (const control of [q, hazard, year]) control.addEventListener('input', apply);
  apply();
})();
