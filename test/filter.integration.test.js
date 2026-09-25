import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DATA_DIR, STATIC_DIR } from '../src/paths.ts';
import { loadRecalls } from '../src/load.ts';
import { renderIndex } from '../src/render.ts';
import { siteMeta } from '../src/config.ts';

/**
 * End-to-end test of the client-side "Foods to check" search behaviour, running
 * the real `filter.js` (and its `food-filter.js` helper) against the real
 * rendered index page inside jsdom.
 *
 * The regression this guards: `filter.js` registered `applyFoodSearch` directly
 * as the search box's `input` listener, so the browser handed it the `Event`
 * object as its `decisions` argument — every food then looked up
 * `decisions[i]` on an Event (always `undefined`) and stayed dim no matter what
 * the reader typed. A search for "chocolate" must light up the foods whose
 * still-active alerts actually mention chocolate.
 */

// The two browser scripts are ES modules; jsdom doesn't execute `<script
// type="module">`, so we load them by hand. `food-filter.js` is pure — strip
// its `export` keywords to get plain declarations — and `filter.js` only
// imports those helpers, so drop that one import line and the IIFE runs against
// the declarations already in scope.
const foodFilterSrc = readFileSync(`${STATIC_DIR}/food-filter.js`, 'utf8').replace(/^export /gm, '');
const filterSrc = readFileSync(`${STATIC_DIR}/filter.js`, 'utf8').replace(/^import .*$\n/m, '');

/** A jsdom window with the real index page and the real client scripts running. */
function renderWindow() {
  const result = loadRecalls(DATA_DIR);
  assert.ok(result.ok, 'recall data must load');
  const html = renderIndex(result.recalls, siteMeta());
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  dom.window.eval(`${foodFilterSrc}\n${filterSrc}`);
  return dom.window;
}

/** The "foods to check" entry whose food-name link reads exactly `label`. */
function foodByLabel(window, label) {
  const el = [...window.document.querySelectorAll('.food')].find(
    (f) => f.querySelector('a').textContent === label,
  );
  assert.ok(el, `expected a "foods to check" entry labelled "${label}"`);
  return el;
}

function search(window, query) {
  const q = window.document.getElementById('q');
  q.value = query;
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function uncheckCategory(window, value) {
  const input = window.document.querySelector(`input[name="category"][value="${value}"]`);
  assert.ok(input, `expected a category checkbox for "${value}"`);
  input.checked = false;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('a search lights up foods whose active alerts mention the term', () => {
  const window = renderWindow();

  uncheckCategory(window, 'undeclared-allergens');
  search(window, 'chocolate');

  for (const label of ['milk', 'chocolate', 'ice cream']) {
    assert.equal(
      foodByLabel(window, label).classList.contains('dim'),
      false,
      `"${label}" should light up for the search "chocolate"`,
    );
  }
});

test('a search still dims foods whose active alerts do not mention the term', () => {
  const window = renderWindow();

  uncheckCategory(window, 'undeclared-allergens');
  search(window, 'chocolate');

  // No active alert for apple sauce mentions chocolate.
  assert.equal(foodByLabel(window, 'apple sauce').classList.contains('dim'), true);
});

test('the food-name link bolds the part of its label the reader typed', () => {
  const window = renderWindow();

  search(window, 'chocolate');

  const link = foodByLabel(window, 'chocolate').querySelector('a');
  assert.equal(link.innerHTML, '<strong>chocolate</strong>');
});
