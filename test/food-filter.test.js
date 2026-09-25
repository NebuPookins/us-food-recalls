import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSearchTexts,
  decideFoods,
  highlightHtml,
  matchesSearch,
  matchRanges,
  separatorVisibility,
} from '../static/food-filter.js';

// `decideFoods`: a food shared by several alerts is shown once, linking to the
// newest alert whose category the reader still cares about ("the effective
// primary"). Alerts newer than that are suppressed entirely, and older ones
// that still match follow as dated "also previously" links.

test('hides an "also previously" link when its category is filtered out', () => {
  // "potato chips": newest alert is pathogens, the older one is undeclared-allergens.
  const foods = [{ primaryCategories: ['pathogens'], alsoCategories: [['undeclared-allergens']] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true); // pathogens is still checked
  assert.deepEqual(decision.alsoVisible, [false]); // allergen link must be hidden
  assert.equal(decision.anyAlsoVisible, false); // so no "also previously" at all
});

test('shows the "also previously" link when its category is active', () => {
  const foods = [{ primaryCategories: ['pathogens'], alsoCategories: [['undeclared-allergens']] }];
  const active = new Set(['pathogens', 'undeclared-allergens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.deepEqual(decision.alsoVisible, [true]);
  assert.equal(decision.anyAlsoVisible, true);
});

test('hides only the filtered-out link when several remain', () => {
  const foods = [
    { primaryCategories: ['pathogens'], alsoCategories: [['undeclared-allergens'], ['foreign-objects']] },
  ];
  const active = new Set(['pathogens', 'foreign-objects']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.deepEqual(decision.alsoVisible, [false, true]);
  assert.equal(decision.anyAlsoVisible, true);
});

test('a food with no earlier alerts has no "also previously" to show', () => {
  const foods = [{ primaryCategories: ['pathogens'], alsoCategories: [] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.deepEqual(decision.alsoVisible, []);
  assert.equal(decision.anyAlsoVisible, false);
});

test('keeps the primary link when its own category is active', () => {
  const foods = [{ primaryCategories: ['pathogens'], alsoCategories: [] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.primaryIndex, 0);
});

test('a food whose alert spans two categories stays visible while either is active', () => {
  const foods = [{ primaryCategories: ['pathogens', 'undeclared-allergens'], alsoCategories: [] }];
  const active = new Set(['undeclared-allergens']); // pathogens NOT active

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.primaryIndex, 0);
  assert.equal(decision.visible, true);
});

// The regression: a food whose newest alert is filtered out must not render as
// inert text plus a linked "also previously". It must link to the newest alert
// that is still active, with the filtered-out newer alerts suppressed entirely.

test('promotes the newest still-active alert when the primary is filtered out', () => {
  const foods = [{ primaryCategories: ['undeclared-allergens'], alsoCategories: [['pathogens']] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.equal(decision.primaryIndex, 1); // the salmonella alert becomes the link
  assert.deepEqual(decision.alsoVisible, [false]); // it is no longer "also previously"
  assert.equal(decision.anyAlsoVisible, false);
});

test('suppresses every inactive alert newer than the promoted one', () => {
  const foods = [
    { primaryCategories: ['undeclared-allergens'], alsoCategories: [['undeclared-allergens'], ['pathogens']] },
  ];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.equal(decision.primaryIndex, 2);
  assert.deepEqual(decision.alsoVisible, [false, false]);
  assert.equal(decision.anyAlsoVisible, false);
});

test('older active alerts stay as "also previously" after promotion', () => {
  const foods = [
    { primaryCategories: ['undeclared-allergens'], alsoCategories: [['pathogens'], ['pathogens']] },
  ];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.equal(decision.primaryIndex, 1);
  assert.deepEqual(decision.alsoVisible, [false, true]);
  assert.equal(decision.anyAlsoVisible, true);
});

test('a food is hidden when none of its alerts is active', () => {
  const foods = [{ primaryCategories: ['undeclared-allergens'], alsoCategories: [['pathogens']] }];
  const active = new Set(['foreign-objects']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, false);
  assert.equal(decision.primaryIndex, -1);
});

test('drops the separator after the last visible "also previously" link', () => {
  const foods = [
    { primaryCategories: ['pathogens'], alsoCategories: [['undeclared-allergens'], ['foreign-objects']] },
  ];
  const active = new Set(['pathogens', 'undeclared-allergens']);

  const [decision] = decideFoods(foods, active);

  // Only the allergen link is visible, so it gets no trailing separator.
  assert.deepEqual(decision.alsoVisible, [true, false]);
  assert.deepEqual(decision.alsoSepVisible, [false, false]);
});

test('activeSearchTexts includes only search texts for active recall entries', () => {
  const searchTexts = ['chocolate leben pasteurization', 'dark chocolate almond bites peanut allergen'];
  // Food has two recall entries: primary (other) and also (undeclared-allergens)
  const foods = [{ primaryCategories: ['other'], alsoCategories: [['undeclared-allergens']] }];

  // 1. Both categories active
  const activeBoth = new Set(['other', 'undeclared-allergens']);
  const [decisionBoth] = decideFoods(foods, activeBoth);
  assert.deepEqual(activeSearchTexts(searchTexts, decisionBoth), searchTexts);

  // 2. Only 'other' active (allergens filtered out)
  const activeOther = new Set(['other']);
  const [decisionOther] = decideFoods(foods, activeOther);
  assert.deepEqual(activeSearchTexts(searchTexts, decisionOther), ['chocolate leben pasteurization']);

  // Search for 'almond' against activeOther should NOT match
  const terms = ['almond'];
  const matches = activeSearchTexts(searchTexts, decisionOther).some((h) => matchesSearch(h, terms));
  assert.equal(matches, false);
});

test('separatorVisibility marks every visible item except the last', () => {
  assert.deepEqual(separatorVisibility([true, false, true]), [true, false, false]);
  assert.deepEqual(separatorVisibility([true, true]), [true, false]);
});

test('matchesSearch requires every term to appear in the haystack', () => {
  assert.equal(matchesSearch('peanut butter recall', ['peanut', 'butter']), true);
  assert.equal(matchesSearch('peanut butter recall', ['peanut', 'jelly']), false);
});

test('matchesSearch treats no terms as a match', () => {
  assert.equal(matchesSearch('anything', []), true);
});

test('matchRanges finds a single case-insensitive substring', () => {
  assert.deepEqual(matchRanges('Peanut Butter', ['peanut']), [[0, 6]]);
});

test('matchRanges finds and sorts multiple non-overlapping terms', () => {
  assert.deepEqual(matchRanges('Peanut Butter Cups', ['cups', 'peanut']), [[0, 6], [14, 18]]);
});

test('matchRanges merges overlapping or touching spans', () => {
  assert.deepEqual(matchRanges('Peanut', ['pea', 'anut']), [[0, 6]]);
});

test('matchRanges merges back-to-back occurrences of a repeated term', () => {
  assert.deepEqual(matchRanges('banana split', ['an']), [[1, 5]]);
});

test('matchRanges finds non-adjacent repeats without merging them', () => {
  assert.deepEqual(matchRanges('cat scan', ['ca']), [[0, 2], [5, 7]]);
});

test('matchRanges returns nothing when no term is found', () => {
  assert.deepEqual(matchRanges('Peanut Butter', ['jelly']), []);
});

test('highlightHtml wraps matched ranges in <strong> and escapes the rest', () => {
  const html = highlightHtml('<Peanut> Butter', [[1, 7]], (s) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  );
  assert.equal(html, '&lt;<strong>Peanut</strong>&gt; Butter');
});

test('highlightHtml returns the escaped text unchanged when there are no ranges', () => {
  const html = highlightHtml('Peanut Butter', [], (s) => s);
  assert.equal(html, 'Peanut Butter');
});
