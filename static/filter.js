// Progressive enhancement: the full list is already in the HTML, this only hides
// non-matching cards. With JS off the page still works, just unfiltered.
(() => {
  const q = document.getElementById('q');
  const hazard = document.getElementById('hazard');
  const year = document.getElementById('year');
  const count = document.getElementById('count');
  const empty = document.getElementById('empty');
  const recalls = Array.from(document.querySelectorAll('.recall'));

  const matches = (el, terms, hazardValue, yearValue) =>
    (hazardValue === '' || el.dataset.hazard === hazardValue) &&
    (yearValue === '' || el.dataset.year === yearValue) &&
    terms.every((term) => el.dataset.search.includes(term));

  const apply = () => {
    const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const visible = recalls.filter((el) => {
      const show = matches(el, terms, hazard.value, year.value);
      el.hidden = !show;
      return show;
    });

    count.textContent = `Showing ${visible.length} of ${recalls.length} recalls`;
    empty.hidden = visible.length > 0;
  };

  for (const control of [q, hazard, year]) control.addEventListener('input', apply);
  apply();
})();
