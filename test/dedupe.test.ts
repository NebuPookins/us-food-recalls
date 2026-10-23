import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import {
  addToEntry,
  classificationFromRaw,
  findDuplicate,
  lotTokens,
  type DupCandidate,
} from '../scripts/dedupe.ts';
import type { Recall } from '../src/schema.ts';

// Modelled on the Berlin Seeds case: a curated entry and an auto-drafted record
// that share the lot code SAL2-24JB and sit 21 days apart.
const berlinEntry: Recall = {
  id: '2026-09-berlin-seeds-alfalfa-sprouting-seed',
  date: '2026-09-23',
  title: 'Berlin Seeds alfalfa sprouting seed (E. coli and Salmonella)',
  agency: 'FDA',
  recalling_firm: 'Berlin Seeds',
  hazards: ['e-coli', 'salmonella'],
  products: [
    {
      name: 'Alfalfa sprouting seed',
      codes: ['Lot SAL2-24JB (on 5 lb and 50 lb packages only)'],
    },
  ],
  note: 'Recall of alfalfa sprouting seed.',
  citations: [{ title: 'FDA', url: 'https://www.fda.gov/example' }],
};

const autoRecord: DupCandidate = {
  firm: 'Berlin Seeds',
  date: '2026-10-14',
  codes: 'Lot # SAL2-24JB',
};

test('a record from the same firm, within the window, sharing a lot code is a duplicate', () => {
  const match = findDuplicate(autoRecord, [berlinEntry]);
  assert.equal(match?.recall.id, berlinEntry.id);
  assert.deepEqual(match?.sharedCodes, ['SAL2-24JB']);
});

test('firm names are matched after normalising case, punctuation and corporate suffixes', () => {
  const match = findDuplicate({ ...autoRecord, firm: 'BERLIN SEEDS, INC.' }, [berlinEntry]);
  assert.equal(match?.recall.id, berlinEntry.id);
});

test('a shared lot code from a different firm is not a duplicate', () => {
  const match = findDuplicate({ ...autoRecord, firm: 'Someone Else Foods' }, [berlinEntry]);
  assert.equal(match, undefined);
});

test('the same firm with a different lot code is not a duplicate', () => {
  const match = findDuplicate({ ...autoRecord, codes: 'Lot ZZZ9-99QQ' }, [berlinEntry]);
  assert.equal(match, undefined);
});

test('a shared lot code outside the date window is not a duplicate', () => {
  const match = findDuplicate({ ...autoRecord, date: '2027-06-01' }, [berlinEntry]);
  assert.equal(match, undefined);
});

test('a record with no usable date is never matched on lot code alone', () => {
  const match = findDuplicate({ ...autoRecord, date: '' }, [berlinEntry]);
  assert.equal(match, undefined);
});

test('generic words and plain numbers are not treated as lot codes', () => {
  const match = findDuplicate(
    { firm: 'Berlin Seeds', date: '2026-10-14', codes: 'All lots; UPC 194346442706; best by 2/25/2028' },
    [{ ...berlinEntry, products: [{ name: 'x', codes: ['All lots', 'UPC 194346442706'] }] }],
  );
  assert.equal(match, undefined);
});

test('lotTokens keeps only alphanumeric tokens containing both a letter and a digit', () => {
  assert.deepEqual([...lotTokens('Lot # SAL2-24JB, L6081A, 2026, LOT, ABCD')].sort(), [
    'L6081A',
    'SAL2-24JB',
  ]);
});

test('classificationFromRaw maps FDA class labels and rejects others', () => {
  assert.equal(classificationFromRaw('Class I'), 'I');
  assert.equal(classificationFromRaw('Class II'), 'II');
  assert.equal(classificationFromRaw('Not Yet Classified'), undefined);
});

const curatedYaml = `recalls:
  - id: 2026-09-berlin-seeds-alfalfa-sprouting-seed
    date: 2026-09-23
    title: Berlin Seeds alfalfa sprouting seed
    recalling_firm: Berlin Seeds
    agency: FDA
    hazards: [e-coli, salmonella]
    products:
      - name: Alfalfa sprouting seed
        codes:
          - Lot SAL2-24JB
    note: |
      Recalled seed.
    citations:
      - title: FDA
        url: https://www.fda.gov/example
        publisher: FDA
        accessed: 2026-09-28

  # A comment that must survive the edit.
  - id: 2026-08-other-entry
    date: 2026-08-01
    title: Other
    recalling_firm: Other Co
    agency: FDA
    hazards: [listeria]
    products:
      - name: Other
    note: Other.
    citations:
      - title: Other
        url: https://www.fda.gov/other
`;

test('addToEntry adds the citation and classification to the named entry only', () => {
  const updated = addToEntry(curatedYaml, '2026-09-berlin-seeds-alfalfa-sprouting-seed', {
    classification: 'I',
    citations: [
      {
        title: 'FDA recall record',
        url: 'https://api.fda.gov/food/enforcement.json?search=event_id%3A99894',
        publisher: 'FDA',
        accessed: '2026-10-23',
      },
    ],
  });
  const { recalls } = parse(updated) as { recalls: Array<Record<string, unknown>> };

  const berlin = recalls[0];
  assert.equal(berlin.classification, 'I');
  assert.deepEqual(berlin.citations, [
    { title: 'FDA', url: 'https://www.fda.gov/example', publisher: 'FDA', accessed: '2026-09-28' },
    {
      title: 'FDA recall record',
      url: 'https://api.fda.gov/food/enforcement.json?search=event_id%3A99894',
      publisher: 'FDA',
      accessed: '2026-10-23',
    },
  ]);
  assert.equal(recalls[1].classification, undefined);
  assert.deepEqual(recalls[1].citations, [{ title: 'Other', url: 'https://www.fda.gov/other' }]);
  assert.match(updated, /# A comment that must survive the edit\./);
});

test('addToEntry leaves an existing classification alone', () => {
  const classified = curatedYaml.replace(
    '    hazards: [e-coli, salmonella]\n',
    '    hazards: [e-coli, salmonella]\n    classification: II\n',
  );
  const updated = addToEntry(classified, '2026-09-berlin-seeds-alfalfa-sprouting-seed', {
    classification: 'I',
    citations: [],
  });
  const { recalls } = parse(updated) as { recalls: Array<Record<string, unknown>> };
  assert.equal(recalls[0].classification, 'II');
});

test('addToEntry refuses an id that is not in the file', () => {
  assert.throws(() => addToEntry(curatedYaml, 'no-such-entry', { citations: [] }), /not found/);
});
