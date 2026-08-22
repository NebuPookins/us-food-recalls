import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteMeta } from './config.ts';
import { loadRecalls } from './load.ts';
import { renderFeed, renderIndex, renderRetractedPage } from './render.ts';
import { DATA_DIR, DIST_DIR, STATIC_DIR } from './paths.ts';

/**
 * `npm run build` — the whole site generator. The GitHub workflow and the local
 * preview both call exactly this, so what CI publishes is what you saw locally.
 */

const result = loadRecalls(DATA_DIR);

if (!result.ok) {
  console.error(`\n✗ Refusing to build; ${result.errors.length} problem(s) in the alert data:\n`);
  for (const error of result.errors) console.error(`  ${error}`);
  console.error('\nRun `npm run validate` for the same check without building.\n');
  process.exit(1);
}

const meta = siteMeta();

// `retracted` entries stay in the YAML as a triage record (a submitted URL that
// turned out to be a false positive) and are published on retracted.html, not
// in the main timeline.
const active = result.recalls.filter((r) => r.status !== 'retracted');

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });
cpSync(STATIC_DIR, DIST_DIR, { recursive: true });

writeFileSync(join(DIST_DIR, 'index.html'), renderIndex(result.recalls, meta));
writeFileSync(join(DIST_DIR, 'retracted.html'), renderRetractedPage(result.recalls, meta));
writeFileSync(join(DIST_DIR, 'feed.xml'), renderFeed(result.recalls, meta));
writeFileSync(
  join(DIST_DIR, 'recalls.json'),
  JSON.stringify({ generated: meta.buildDate, recalls: active }, null, 2),
);
// Stops GitHub Pages running the output through Jekyll, which would drop any
// file or directory whose name begins with an underscore.
writeFileSync(join(DIST_DIR, '.nojekyll'), '');

console.log(`✓ Built ${active.length} alert(s) + ${result.recalls.length - active.length} retracted alert(s) into dist/`);
