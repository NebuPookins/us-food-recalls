import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { RecallFileSchema, type Recall } from './schema.ts';

/**
 * Reads every `data/recalls/*.yaml` file, validates each against the schema, and
 * checks the invariants that span files (ID uniqueness).
 *
 * Never throws: callers get either the recalls or a list of human-readable
 * errors, so the validator CLI and the build share one code path.
 */

export type LoadResult =
  | { readonly ok: true; readonly recalls: readonly Recall[]; readonly fileCount: number }
  | { readonly ok: false; readonly errors: readonly string[] };

/** One recall plus where it came from, so errors can name a file. */
type Sourced = { readonly file: string; readonly recall: Recall };

export function loadRecalls(dataDir: string): LoadResult {
  const files = readdirSync(dataDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted()
    .map((name) => join(dataDir, name));

  if (files.length === 0) {
    return { ok: false, errors: [`No .yaml files found in ${dataDir}`] };
  }

  const parsed = files.map((file) => parseOne(file));
  const errors = parsed.flatMap((p) => p.errors);
  const sourced = parsed.flatMap((p) => p.recalls);

  const allErrors = [...errors, ...findDuplicateIds(sourced), ...findInvalidParentIds(sourced)];
  if (allErrors.length > 0) return { ok: false, errors: allErrors };

  // Newest first. IDs break ties so the output is stable regardless of file order.
  const recalls = sourced
    .map((s) => s.recall)
    .toSorted((a, b) => (b.date.localeCompare(a.date) || a.id.localeCompare(b.id)));

  return { ok: true, recalls, fileCount: files.length };
}

function parseOne(file: string): { readonly recalls: readonly Sourced[]; readonly errors: readonly string[] } {
  const where = relative(process.cwd(), file);

  let raw: unknown;
  try {
    raw = parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { recalls: [], errors: [`${where}: ${e instanceof Error ? e.message : String(e)}`] };
  }

  const result = RecallFileSchema.safeParse(raw);
  if (!result.success) {
    return {
      recalls: [],
      errors: result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `${where}: ${path}: ${issue.message}`;
      }),
    };
  }

  return {
    recalls: result.data.recalls.map((recall) => ({ file: where, recall })),
    errors: [],
  };
}

function findDuplicateIds(sourced: readonly Sourced[]): readonly string[] {
  const byId = Map.groupBy(sourced, (s) => s.recall.id);
  return [...byId]
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => `Duplicate recall id "${id}" in: ${group.map((g) => g.file).join(', ')}`);
}

/** Every `parent_id` must point at an existing recall in the same data set. */
function findInvalidParentIds(sourced: readonly Sourced[]): readonly string[] {
  const ids = new Set(sourced.map((s) => s.recall.id));
  return sourced
    .filter((s) => s.recall.parent_id && !ids.has(s.recall.parent_id))
    .map((s) => `Recall "${s.recall.id}" references missing parent_id "${s.recall.parent_id}" (in ${s.file}).`);
}
