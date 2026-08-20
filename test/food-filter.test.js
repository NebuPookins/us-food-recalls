import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFoods } from '../static/food-filter.js';

// The regression: a food shared by recalls in several categories must not show
// its "also previously" links for categories the reader has filtered out.
test('hides an "also previously" link when its category is filtered out', () => {
  // "potato chips": newest recall is pathogens, the older one is undeclared-allergens.
  const foods = [{ primaryCategory: 'pathogens', alsoCategories: ['undeclared-allergens'] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true); // pathogens is still checked
  assert.deepEqual(decision.alsoVisible, [false]); // allergen link must be hidden
  assert.equal(decision.anyAlsoVisible, false); // so no "also previously" at all
});

test('drops the separator after the last visible food so it does not dangle', () => {
  const foods = [
    { primaryCategory: 'pathogens', alsoCategories: [] },
    { primaryCategory: 'undeclared-allergens', alsoCategories: [] }, // filtered out, was last
    { primaryCategory: 'pathogens', alsoCategories: [] },
  ];
  const active = new Set(['pathogens']);

  const decisions = decideFoods(foods, active);

  assert.deepEqual(decisions.map((d) => d.sepVisible), [true, false, false]);
});

test('drops the separator after the last visible "also previously" link', () => {
  const foods = [
    { primaryCategory: 'pathogens', alsoCategories: ['undeclared-allergens', 'foreign-objects'] },
  ];
  const active = new Set(['pathogens', 'undeclared-allergens']);

  const [decision] = decideFoods(foods, active);

  // Only the allergen link is visible, so it gets no trailing separator.
  assert.deepEqual(decision.alsoVisible, [true, false]);
  assert.deepEqual(decision.alsoSepVisible, [false, false]);
});

test('shows the "also previously" link when its category is active', () => {
  const foods = [{ primaryCategory: 'pathogens', alsoCategories: ['undeclared-allergens'] }];
  const active = new Set(['pathogens', 'undeclared-allergens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.deepEqual(decision.alsoVisible, [true]);
  assert.equal(decision.anyAlsoVisible, true);
});

test('hides only the filtered-out link when several remain', () => {
  const foods = [
    { primaryCategory: 'pathogens', alsoCategories: ['undeclared-allergens', 'foreign-objects'] },
  ];
  const active = new Set(['pathogens', 'foreign-objects']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.deepEqual(decision.alsoVisible, [false, true]);
  assert.equal(decision.anyAlsoVisible, true);
});

test('a food with no earlier recalls has no "also previously" to show', () => {
  const foods = [{ primaryCategory: 'pathogens', alsoCategories: [] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.deepEqual(decision.alsoVisible, []);
  assert.equal(decision.anyAlsoVisible, false);
});

test('a food stays visible while any of its recall categories is active, but its primary link is not', () => {
  // Regression: the food-name link always targets the newest (primary) recall.
  // If the primary's own category is filtered out while an older recall's
  // category is still active, the food must stay visible but `primaryVisible`
  // must go false so the client strips the link instead of leaving it pointing
  // at a now-hidden recall.
  const foods = [{ primaryCategory: 'pathogens', alsoCategories: ['undeclared-allergens'] }];
  const active = new Set(['undeclared-allergens']); // pathogens (primary) NOT active

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.visible, true);
  assert.equal(decision.primaryVisible, false);
  assert.deepEqual(decision.alsoVisible, [true]);
  assert.equal(decision.anyAlsoVisible, true);
});

test('primary link stays live when its own category is active', () => {
  const foods = [{ primaryCategory: 'pathogens', alsoCategories: ['undeclared-allergens'] }];
  const active = new Set(['pathogens']);

  const [decision] = decideFoods(foods, active);

  assert.equal(decision.primaryVisible, true);
});
