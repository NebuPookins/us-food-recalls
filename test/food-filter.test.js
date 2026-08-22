import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFoods } from '../static/food-filter.js';

// The regression: a food shared by alerts in several categories must not show
// its "also previously" links for categories the reader has filtered out.
test('hides an "also previously" link when its category is filtered out', () => {
  // "potato chips": newest alert is pathogens, the older one is undeclared-allergens.
  const foods = [{ primaryCategories: ['pathogens'], alsoCategories: [['undeclared-allergens']] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true); // pathogens is still checked
  assert.deepEqual(decision.alsoVisible, [false]); // allergen link must be hidden
  assert.equal(decision.anyAlsoVisible, false); // so no "also previously" at all
});

test('drops the separator after the last visible food so it does not dangle', () => {
  const foods = [
    { primaryCategories: ['pathogens'], alsoCategories: [] },
    { primaryCategories: ['undeclared-allergens'], alsoCategories: [] }, // filtered out, was last
    { primaryCategories: ['pathogens'], alsoCategories: [] },
  ];
  const active = new Set(['pathogens']);

  const decisions = decideFoods(foods, active);

  assert.deepEqual(decisions.map((d) => d.sepVisible), [true, false, false]);
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

test('a food stays visible while any of its alert categories is active, but its primary link is not', () => {
  // Regression: the food-name link always targets the newest (primary) alert.
  // If the primary's own category is filtered out while an older alert's
  // category is still active, the food must stay visible but `primaryVisible`
  // must go false so the client strips the link instead of leaving it pointing
  // at a now-hidden alert.
  const foods = [{ primaryCategories: ['pathogens'], alsoCategories: [['undeclared-allergens']] }];
  const active = new Set(['undeclared-allergens']); // pathogens (primary) NOT active

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.equal(decision.primaryVisible, false);
  assert.deepEqual(decision.alsoVisible, [true]);
  assert.equal(decision.anyAlsoVisible, true);
});

test('primary link stays live when its own category is active', () => {
  const foods = [{ primaryCategories: ['pathogens'], alsoCategories: [] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.primaryVisible, true);
});

test('a food whose alert spans two categories stays visible while either is active', () => {
  const foods = [{ primaryCategories: ['pathogens', 'undeclared-allergens'], alsoCategories: [] }];
  const active = new Set(['undeclared-allergens']); // pathogens NOT active

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.primaryVisible, true);
  assert.equal(decision.visible, true);
});
