/**
 * Recognise a source record that is already covered by a curated entry, and
 * merge its new details into that entry instead of drafting a duplicate.
 *
 * A match requires all three of: the same recalling firm (after normalisation),
 * recall dates within DUPLICATE_WINDOW_DAYS, and at least one shared lot code.
 * Lot codes are the high-confidence signal; firm and date only narrow the search.
 */

import { stringify } from 'yaml';
import type { Citation, Recall } from '../src/schema.ts';

export type Classification = NonNullable<Recall['classification']>;

/** The source-record fields needed to recognise an existing entry. */
export type DupCandidate = {
  readonly firm: string;
  readonly date: string; // YYYY-MM-DD, or '' when the source had no usable date
  readonly codes: string; // free-text lot/UPC/code info from the source
};

export type DuplicateMatch = {
  readonly recall: Recall;
  readonly sharedCodes: readonly string[];
};

export type EntryAdditions = {
  readonly classification?: Classification; // only written if the entry has none
  readonly citations: readonly Citation[];
};

export const DUPLICATE_WINDOW_DAYS = 60;

const MS_PER_DAY = 86_400_000;

// Corporate suffixes that differ between sources without changing the company.
const FIRM_NOISE_WORDS = new Set(['inc', 'llc', 'co', 'corp', 'corporation', 'company', 'ltd', 'limited', 'the']);

const CLASSIFICATION_BY_RAW = new Map<string, Classification>([
  ['Class I', 'I'],
  ['Class II', 'II'],
  ['Class III', 'III'],
]);

/** Lower-case, strip punctuation and corporate suffixes: "Berlin Seeds, Inc." → "berlin seeds". */
export function normalizeFirm(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !FIRM_NOISE_WORDS.has(word))
    .join(' ');
}

/**
 * Distinctive lot-like tokens: alphanumeric runs containing both a letter and a
 * digit, at least four characters long. This excludes plain numbers (UPCs, dates)
 * and words ("LOT", "ALL"), which would otherwise match unrelated recalls.
 */
export function lotTokens(text: string): ReadonlySet<string> {
  const runs = text.toUpperCase().match(/[A-Z0-9][A-Z0-9-]*[A-Z0-9]/g) ?? [];
  return new Set(runs.filter((t) => t.length >= 4 && /[A-Z]/.test(t) && /[0-9]/.test(t)));
}

function withinWindow(a: string, b: string): boolean {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(ms) && ms <= DUPLICATE_WINDOW_DAYS * MS_PER_DAY;
}

function matchOne(
  candidate: DupCandidate,
  firm: string,
  codes: ReadonlySet<string>,
  recall: Recall,
): DuplicateMatch | undefined {
  if (!recall.recalling_firm || normalizeFirm(recall.recalling_firm) !== firm) return undefined;
  if (!withinWindow(candidate.date, recall.date)) return undefined;
  const entryCodes = recall.products.flatMap((p) => p.codes ?? []).join('; ');
  const sharedCodes = [...lotTokens(entryCodes)].filter((t) => codes.has(t));
  return sharedCodes.length > 0 ? { recall, sharedCodes } : undefined;
}

/** The first existing entry that the candidate duplicates, or undefined. */
export function findDuplicate(
  candidate: DupCandidate,
  recalls: readonly Recall[],
): DuplicateMatch | undefined {
  const firm = normalizeFirm(candidate.firm);
  const codes = lotTokens(candidate.codes);
  if (firm === '' || codes.size === 0) return undefined;
  return recalls
    .map((recall) => matchOne(candidate, firm, codes, recall))
    .find((m) => m !== undefined);
}

/** "Class I" → "I". Anything else (e.g. "Not Yet Classified") → undefined. */
export function classificationFromRaw(raw: string): Classification | undefined {
  return CLASSIFICATION_BY_RAW.get(raw.trim());
}

/**
 * Add citations (and a classification, if the entry lacks one) to the entry with
 * the given id, by editing its lines in the YAML text.
 *
 * The curated files are hand-maintained, so they are not re-serialised: parsing and
 * stringifying the whole file would reflow it. Only lines inside the entry change.
 * Throws if the entry or its citations block cannot be found.
 */
export function addToEntry(yaml: string, id: string, additions: EntryAdditions): string {
  const lines = yaml.split('\n');
  const start = lines.indexOf(`  - id: ${id}`);
  if (start < 0) throw new Error(`entry ${id} not found in YAML text`);

  // An entry ends at the next entry or the next top-level key/comment.
  const next = lines.findIndex((l, i) => i > start && /^(  - id: |\S)/.test(l));
  const end = next < 0 ? lines.length : next;

  const citationsLine = lines.findIndex((l, i) => i > start && i < end && l === '    citations:');
  if (citationsLine < 0) throw new Error(`entry ${id} has no citations block`);

  const hasClassification = lines.slice(start, end).some((l) => /^    classification:/.test(l));
  const classificationLines =
    additions.classification && !hasClassification
      ? [`    classification: ${additions.classification}`]
      : [];

  // Insert after the last citation item (lines indented 6+), so nothing that follows is disturbed.
  let afterCitations = citationsLine + 1;
  while (afterCitations < end && /^ {6,}\S/.test(lines[afterCitations])) afterCitations++;

  const citationLines =
    additions.citations.length > 0
      ? stringify([...additions.citations], { lineWidth: 0 })
          .trimEnd()
          .split('\n')
          .map((l) => `      ${l}`)
      : [];

  return [
    ...lines.slice(0, citationsLine),
    ...classificationLines,
    ...lines.slice(citationsLine, afterCitations),
    ...citationLines,
    ...lines.slice(afterCitations),
  ].join('\n');
}
