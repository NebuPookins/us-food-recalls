import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { RecallFileSchema } from './schema.ts';
import { SCHEMA_FILE } from './paths.ts';

/**
 * `npm run schema` — writes schema.json from the Zod schema.
 *
 * The data files point at it with a `# yaml-language-server: $schema=` comment,
 * which is what gives you completion and red squiggles in the editor while you
 * type, rather than at commit time. Committed so it works on a fresh clone.
 */

const jsonSchema = z.toJSONSchema(RecallFileSchema, { io: 'input' });

writeFileSync(SCHEMA_FILE, `${JSON.stringify(jsonSchema, null, 2)}\n`);

console.log(`✓ Wrote ${SCHEMA_FILE}`);
