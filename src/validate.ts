import { DATA_DIR } from './paths.ts';
import { loadRecalls } from './load.ts';

/** `npm run validate` — schema + cross-file checks, no rendering. The git hook calls this. */

const result = loadRecalls(DATA_DIR);

if (!result.ok) {
  console.error(`\n✗ ${result.errors.length} problem(s) in the alert data:\n`);
  for (const error of result.errors) console.error(`  ${error}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ ${result.recalls.length} alert(s) across ${result.fileCount} file(s) are valid.`);
