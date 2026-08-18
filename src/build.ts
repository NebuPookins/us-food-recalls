import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteMeta } from './config.ts';
import { loadRecalls } from './load.ts';
import { renderFeed, renderIndex } from './render.ts';
import { DATA_DIR, DIST_DIR, STATIC_DIR } from './paths.ts';

/**
 * `npm run build` — the whole site generator. The GitHub workflow and the local
 * preview both call exactly this, so what CI publishes is what you saw locally.
 */

const result = loadRecalls(DATA_DIR);

if (!result.ok) {
  console.error(`\n✗ Refusing to build; ${result.errors.length} problem(s) in the recall data:\n`);
  for (const error of result.errors) console.error(`  ${error}`);
  console.error('\nRun `npm run validate` for the same check without building.\n');
  process.exit(1);
}

const meta = siteMeta();

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });
cpSync(STATIC_DIR, DIST_DIR, { recursive: true });

writeFileSync(join(DIST_DIR, 'index.html'), renderIndex(result.recalls, meta));
writeFileSync(join(DIST_DIR, 'feed.xml'), renderFeed(result.recalls, meta));
writeFileSync(
  join(DIST_DIR, 'recalls.json'),
  JSON.stringify({ generated: meta.buildDate, recalls: result.recalls }, null, 2),
);
// Stops GitHub Pages running the output through Jekyll, which would drop any
// file or directory whose name begins with an underscore.
writeFileSync(join(DIST_DIR, '.nojekyll'), '');

console.log(`✓ Built ${result.recalls.length} recall(s) into dist/`);
