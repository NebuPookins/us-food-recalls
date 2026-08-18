import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolved from this file, so every script works regardless of the cwd it was run from. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const DATA_DIR = join(ROOT, 'data', 'recalls');
export const STATIC_DIR = join(ROOT, 'static');
export const DIST_DIR = join(ROOT, 'dist');
export const SCHEMA_FILE = join(ROOT, 'schema.json');
