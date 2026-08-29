/**
 * Fetch recent FDA/FSIS recall reports and turn the next new one into a curated
 * entry in `data/recalls/<year>-auto.yaml`, then open a pull request for review.
 *
 * Only one significant recall is added per run (the first one encountered), so
 * the reviewer merges incremental PRs instead of one large batch. If an earlier
 * auto PR is still open, this run exits early and waits for it to be merged.
 *
 * The curated fields are drafted by an LLM (Groq free tier); `GROQ_API_KEY` is
 * required whenever there is a new record to draft. The stable fields (`id`,
 * `date`, `agency`) are always produced by this script, never the model, so
 * slugs stay unique and dates stay well-formed.
 *
 * Usage:
 *   node scripts/sync-recalls.ts [--dry-run]
 *
 * Env:
 *   GROQ_API_KEY      required to draft new recalls (fails loudly if unset).
 *   GH_TOKEN          used by `gh` to push the branch and open the PR.
 *   RECALL_REVIEWER   GitHub login to request review from (defaults to repo owner).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import {
  CaseCounts,
  CLASSIFICATIONS,
  HAZARDS,
  HAZARD_LABELS,
  RecallSchema,
  type Recall,
} from '../src/schema.ts';
import { loadRecalls } from '../src/load.ts';
import { DATA_DIR } from '../src/paths.ts';

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = join(DATA_DIR, '..', '..');

const OPENFDA_URL = 'https://api.fda.gov/food/enforcement.json';
const FSIS_URL = 'https://www.fsis.usda.gov/fsis/api/recall/v/1';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Groq retires model IDs without notice. When this one stops resolving, the
// workflow fails loudly (see groqDraft) so it's easy to spot and update.
const GROQ_MODEL = 'openai/gpt-oss-120b';
// Keyless RSS feed used to find a human-facing news story for each citation.
const BING_NEWS_URL = 'https://www.bing.com/news/search';

const SEEN_FILE = join(DATA_DIR, '.seen.json');
const LOOKBACK_DAYS = 30;
const MAX_SEEN = 500;
// Head branch prefix written by openPr() and checked by hasOpenAutoPr().
const AUTO_BRANCH_PREFIX = 'auto/recalls-';

// ---------------------------------------------------------------- helpers

function log(...args: unknown[]): void {
  console.log(...args);
}
function warn(...args: unknown[]): void {
  console.error('⚠', ...args);
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Local calendar date as YYYY-MM-DD. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function compactDate(d: Date): string {
  return isoDate(d).replace(/-/g, '');
}

/** YYYY-MM-DD -> local-midnight Date. */
function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Accepts YYYY-MM-DD or YYYYMMDD; returns YYYY-MM-DD or ''. */
function normalizeDate(s: string): string {
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return '';
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

/** Stable, globally-unique kebab-case slug (see the `id` regex in schema.ts). */
function makeId(date: string, firm: string, product: string, used: Set<string>): string {
  const base =
    [date, slugify(firm), slugify(product)].filter(Boolean).join('-').slice(0, 80).replace(/-+$/, '') ||
    `${date || 'recall'}-recall`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------- sources

type SourceRecord = {
  key: string; // stable dedup key: "openfda:<event_id>" or "fsis:<recall_number>"
  agency: 'FDA' | 'FSIS';
  date: string; // YYYY-MM-DD
  firm: string;
  product: string;
  reason: string;
  distribution: string;
  classification: string; // raw, e.g. "Class I" or "Not Yet Classified"
  codes: string;
  quantity: string;
  citationUrl?: string; // a machine-readable https link to the record
};

type OpenfdaItem = {
  event_id?: string;
  report_date?: string;
  recall_initiation_date?: string;
  recalling_firm?: string;
  product_description?: string;
  reason_for_recall?: string;
  distribution_pattern?: string;
  classification?: string;
  code_info?: string;
  more_code_info?: string;
  product_quantity?: string;
};

function openfdaToRecord(r: OpenfdaItem): SourceRecord {
  const eventId = str(r.event_id);
  const date = normalizeDate(str(r.report_date)) || normalizeDate(str(r.recall_initiation_date));
  return {
    key: `openfda:${eventId}`,
    agency: 'FDA',
    date,
    firm: str(r.recalling_firm),
    product: str(r.product_description),
    reason: str(r.reason_for_recall),
    distribution: str(r.distribution_pattern),
    classification: str(r.classification),
    codes: [str(r.code_info), str(r.more_code_info)].filter(Boolean).join('; '),
    quantity: str(r.product_quantity),
    citationUrl: eventId ? `${OPENFDA_URL}?search=${encodeURIComponent(`event_id:${eventId}`)}` : undefined,
  };
}

async function fetchOpenfda(from: string, to: string): Promise<SourceRecord[]> {
  const out: SourceRecord[] = [];
  let skip = 0;
  while (true) {
    const params = new URLSearchParams({
      search: `report_date:[${from} TO ${to}]`,
      limit: '100',
      skip: String(skip),
      sort: 'recall_initiation_date:desc',
    });
    const url = `${OPENFDA_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`openFDA HTTP ${res.status}`);
    const body = (await res.json()) as { meta?: { results?: { total?: number } }; results?: OpenfdaItem[] };
    const items = body.results ?? [];
    out.push(...items.map(openfdaToRecord));
    const total = body.meta?.results?.total ?? out.length;
    skip += items.length;
    if (items.length === 0 || skip >= total) break;
  }
  return out;
}

/**
 * FSIS is best-effort: the whole `fsis.usda.gov` domain is behind Akamai bot
 * protection and returned 403 from a desktop, so this may yield nothing from a
 * CI runner too. Field names are the ones documented for the Recall API; if the
 * shape differs, records come out empty and are simply dropped.
 */
async function fetchFsis(): Promise<SourceRecord[]> {
  try {
    const res = await fetch(FSIS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      warn(`FSIS HTTP ${res.status} — skipping FSIS`);
      return [];
    }
    const body = (await res.json()) as unknown;
    const items = Array.isArray(body)
      ? body
      : ((body as { results?: unknown[]; data?: unknown[] }).results ??
        (body as { data?: unknown[] }).data ??
        []);
    return (Array.isArray(items) ? items : [])
      .map((item) => fsisToRecord(item as Record<string, unknown>))
      .filter((r): r is SourceRecord => r !== null);
  } catch (e) {
    warn(`FSIS fetch failed: ${msg(e)} — skipping FSIS`);
    return [];
  }
}

function fsisToRecord(item: Record<string, unknown>): SourceRecord | null {
  const recallNumber = str(item.recall_number) || str(item.recallNumber) || str(item.id);
  if (!recallNumber) return null;
  const rawUrl = str(item.url) || str(item.link);
  const citationUrl = rawUrl
    ? rawUrl.startsWith('http')
      ? rawUrl
      : `https://www.fsis.usda.gov${rawUrl}`
    : undefined;
  return {
    key: `fsis:${recallNumber}`,
    agency: 'FSIS',
    date: normalizeDate(str(item.recall_date) || str(item.date) || str(item.closed_date)),
    firm: str(item.establishment) || str(item.recalling_firm),
    product: str(item.title) || str(item.product_description),
    reason: str(item.summary) || str(item.reason_for_recall),
    distribution: str(item.distribution) || str(item.states),
    classification: str(item.classification),
    codes: str(item.code_info) || str(item.product_codes),
    quantity: str(item.product_quantity) || str(item.amount),
    citationUrl,
  };
}

// ---------------------------------------------------------------- watermark

type SeenState = { seen: string[]; lastRun?: string };

function loadSeen(): SeenState {
  if (!existsSync(SEEN_FILE)) return { seen: [] };
  try {
    return JSON.parse(readFileSync(SEEN_FILE, 'utf8')) as SeenState;
  } catch {
    return { seen: [] };
  }
}

function saveSeen(state: SeenState): void {
  writeFileSync(SEEN_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------- drafting

const SYSTEM_PROMPT = `You curate entries for a hand-maintained timeline of SIGNIFICANT United States
food safety alerts (nationwide or multi-state distribution, notable firms or products, or
alerts with reported illnesses). You receive one raw recall report as JSON and must return strict JSON.

First decide significance:
- "include": false (with a one-line "exclude_reason") for recalls that are clearly local
  (a single store, a single state with a small quantity, or trivial) with no illnesses.
- "include": true for nationwide or multi-state recalls, notable volume, or any illness/death.

When "include": true, produce a "draft" object with these fields:
- title: a one-line headline naming the product and what's wrong with it, e.g.
  "DQ Chocolate Reduced Fat Ice Cream Mix contains metal shavings" or
  "Acme Foods bagged spinach recalled for listeria". Lead with the product as a
  shopper would recognise it, not the firm name, and state the hazard/defect.
- summary: an array of 1-2 lowercase food labels, e.g. ["spinach"].
- recalling_firm: the firm name (omit if unknown).
- hazards: an array of one or more of: listeria, salmonella, e-coli, botulism, hepatitis-a,
  norovirus, undeclared-allergen, foreign-material, chemical-contamination,
  processing-defect, mislabeling, other. Map from reason_for_recall ("undeclared egg" ->
  undeclared-allergen, "Salmonella" -> salmonella, "glass" -> foreign-material, "produced
  without inspection" -> processing-defect). List more than one only when the report names
  more than one hazard, e.g. ["e-coli", "salmonella"].
- classification: exactly "I", "II", or "III"; OMIT the field entirely if the source says
  "Not Yet Classified", "Public Health Alert", or has no classification.
- products: an array of { name, brand?, codes? }. name is the product as a shopper would
  recognise it on the shelf; codes is an array of strings from code_info (UPCs, best-by
  dates, lot codes). Split into separate products only when clearly distinct.
- distribution: free text, e.g. "Nationwide" or "Nationwide via online orders".
- cases: an object { as_of, illnesses?, hospitalizations?, deaths? } holding case counts
  AS OF A SPECIFIC DATE. Counts go stale as an outbreak evolves, so an untimestamped count
  is meaningless. Include cases ONLY when the report states both a count and a date it is
  current as of (the report's own date qualifies, e.g. "no illnesses reported" in an
  announcement dated 2026-08-27 -> { as_of: "2026-08-27", illnesses: 0 }). as_of is required
  whenever cases is present. If a count is stated without any date, OMIT cases entirely
  rather than guess. Use 0 for "none reported", and omit any count the report does not mention.
- note: 2-4 sentences of plain prose describing what was recalled, why, the hazard, and what
  consumers should do. No markdown, no links, no bullet points.

Return JSON of exactly this shape:
{ "include": true, "draft": { ... } }   or   { "include": false, "exclude_reason": "..." }

Do not invent facts; use only what the report states. Write the note in plain English.`;

const DraftSchema = z.object({
  title: z.string().min(1),
  summary: z.array(z.string().min(1)).min(1),
  recalling_firm: z.string().min(1).optional(),
  hazards: z.array(z.enum(HAZARDS)).nonempty(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  products: z
    .array(
      z.object({
        name: z.string().min(1),
        brand: z.string().min(1).optional(),
        codes: z.array(z.string().min(1)).min(1).optional(),
      }),
    )
    .min(1),
  distribution: z.string().min(1).optional(),
  cases: CaseCounts.optional(),
  note: z.string().min(1),
});

const LlmResponseSchema = z.object({
  include: z.boolean(),
  exclude_reason: z.string().optional(),
  draft: DraftSchema.optional(),
});

type DraftResult = { recall?: Recall; excluded?: string };

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

type NewsCitation = { title: string; url: string; publisher?: string };

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** True if `s` parses as an http(s) URL (mirrors the schema's `z.url({ protocol })`). */
function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Pull the top story's title/url/publisher out of a Bing News RSS body. */
function parseFirstNewsItem(xml: string): NewsCitation | null {
  const item = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1];
  if (!item) return null;
  const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1];
  const source = item.match(/<News:Source>([\s\S]*?)<\/News:Source>/)?.[1];
  if (!title || !link) return null;
  // The <link> is a Bing redirect whose `url` param carries the real article URL.
  const url = new URL(decodeXml(link.trim())).searchParams.get('url');
  // Re-check before it reaches the strict RecallSchema: a malformed value should
  // drop the news citation, not make assemble() throw.
  if (!url || !isHttpUrl(url)) return null;
  return {
    title: decodeXml(title.trim()),
    url,
    publisher: source ? decodeXml(source.trim()).replace(/ on MSN$/, '') : undefined,
  };
}

/**
 * Best-effort: find a human-facing news story for a recall via Bing News' keyless
 * RSS feed. Returns null (and the entry keeps just its provenance citation) on any
 * failure or when no story is found.
 */
async function findNewsCitation(rec: SourceRecord): Promise<NewsCitation | null> {
  const terms = [rec.firm, rec.product].filter(Boolean);
  if (terms.length === 0) return null;
  try {
    // "recall" goes first so the slice never cuts it off for long product descriptions.
    const params = new URLSearchParams({ q: `recall ${terms.join(' ')}`.slice(0, 160), format: 'rss' });
    const res = await fetch(`${BING_NEWS_URL}?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return parseFirstNewsItem(await res.text());
  } catch (e) {
    warn(`news search failed for ${rec.key}: ${msg(e)}`);
    return null;
  }
}

// Free tier is 8k tokens/min, so a 429 clears after ~60s; retry rather than fail.
const MAX_GROQ_RETRIES = 10;

async function postGroq(key: string, payload: object): Promise<Response> {
  return fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
}

async function groqDraft(
  rec: SourceRecord,
  used: Set<string>,
  today: string,
): Promise<DraftResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');
  const payload = {
    model: GROQ_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(rec, null, 2) },
    ],
  };

  let res = await postGroq(key, payload);
  for (let attempt = 0; res.status === 429 && attempt < MAX_GROQ_RETRIES; attempt++) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
    warn(`Groq rate-limited on ${rec.key} — waiting ${waitSec}s (attempt ${attempt + 1}/${MAX_GROQ_RETRIES})`);
    await sleep(waitSec * 1000);
    res = await postGroq(key, payload);
  }

  if (res.status === 429) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Groq still rate-limited after ${MAX_GROQ_RETRIES} retries: ${detail}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Groq HTTP ${res.status}: ${detail}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? '';
  const parsed = LlmResponseSchema.safeParse(parseJsonLoose(content));
  if (!parsed.success) {
    throw new Error(`Groq returned invalid shape: ${parsed.error.issues[0]?.message}`);
  }
  const answer = parsed.data;
  if (!answer.include) return { excluded: answer.exclude_reason || 'not significant' };
  const draft = answer.draft!;
  const news = await findNewsCitation(rec);
  return { recall: assemble(rec, draft, news, used, today) };
}

function assemble(
  rec: SourceRecord,
  draft: z.infer<typeof DraftSchema>,
  news: NewsCitation | null,
  used: Set<string>,
  today: string,
): Recall {
  const fallbackUrl = rec.citationUrl ?? `${OPENFDA_URL}?search=${encodeURIComponent(rec.key)}`;
  const candidate: Recall = {
    id: makeId(rec.date, rec.firm, rec.product, used),
    date: rec.date || today,
    title: draft.title,
    summary: draft.summary,
    recalling_firm: draft.recalling_firm || rec.firm || undefined,
    agency: rec.agency,
    hazards: draft.hazards,
    classification: draft.classification,
    products: draft.products,
    distribution: draft.distribution,
    cases: draft.cases,
    note: draft.note,
    citations: [
      // The news link is taken blindly from search, so it isn't stamped `accessed`.
      ...(news ? [{ ...news }] : []),
      // Keep the raw record as provenance so the entry stays verifiable even if
      // the news link rots or a search surfaces the wrong story.
      { title: `${rec.agency} recall record`, url: fallbackUrl, publisher: rec.agency, accessed: today },
    ],
  };
  const checked = RecallSchema.safeParse(candidate);
  if (!checked.success) {
    throw new Error(`assembled recall invalid: ${checked.error.issues[0]?.message}`);
  }
  used.add(checked.data.id);
  return checked.data;
}

// ---------------------------------------------------------------- output

const AUTO_FILE_HEADER = [
  '# yaml-language-server: $schema=../../schema.json',
  '#',
  '# Auto-generated by scripts/sync-recalls.ts. Review, then move entries you want',
  '# to keep into the hand-curated <year>.yaml and delete them from this file.',
  '',
].join('\n');

function readAutoRecalls(file: string): unknown[] {
  if (!existsSync(file)) return [];
  try {
    const raw = parse(readFileSync(file, 'utf8')) as { recalls?: unknown };
    return Array.isArray(raw?.recalls) ? raw.recalls : [];
  } catch {
    return [];
  }
}

function writeAutoFile(file: string, recalls: unknown[]): void {
  writeFileSync(file, `${AUTO_FILE_HEADER}${stringify({ recalls }, { lineWidth: 0 })}\n`);
}

/** Append one drafted recall to its year's auto file (which holds prior runs' entries). */
function appendAutoEntry(recall: Recall): void {
  const file = join(DATA_DIR, `${recall.date.slice(0, 4)}-auto.yaml`);
  writeAutoFile(file, [...readAutoRecalls(file), recall]);
}

function buildSummary(added: Recall, excluded: { rec: SourceRecord; reason: string }[]): string {
  const lines: string[] = [
    '## New recalls (auto-drafted)',
    '',
    '_Drafted 1 recall for data/recalls/<year>-auto.yaml. Review the diff before merging._',
    '',
    `- ${added.date} — ${added.title} (${added.agency}, ${added.hazards.map((h) => HAZARD_LABELS[h]).join(', ')})`,
  ];
  if (excluded.length > 0) {
    lines.push('', '## Excluded (filtered as local/insignificant)');
    for (const e of excluded) {
      lines.push(`- ${e.rec.date || '?'} — ${e.rec.firm} — ${e.rec.product}: ${e.reason}`);
    }
  }
  return lines.join('\n');
}

function repoOwner(): string {
  try {
    return execFileSync('gh', ['api', 'repos/{owner}/{repo}', '--jq', '.owner.login'], {
      encoding: 'utf8',
      cwd: ROOT,
    }).trim();
  } catch {
    return '';
  }
}

/** True when a prior run's review PR is still open (head branch `auto/recalls-*`). */
function hasOpenAutoPr(): boolean {
  if (DRY_RUN) return false;
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'headRefName', '--jq', '.[].headRefName'],
      { encoding: 'utf8', cwd: ROOT },
    );
    return out.split('\n').some((branch) => branch.startsWith(AUTO_BRANCH_PREFIX));
  } catch (e) {
    // Listing PRs is also a prerequisite for openPr(), so a failure here means the
    // run cannot complete anyway — fail loudly rather than silently disabling the guard.
    throw new Error(`could not check for an open auto PR: ${msg(e)}`);
  }
}

function openPr(summary: string): void {
  if (DRY_RUN) {
    log(`\n[dry-run] would open a PR with body:\n\n${summary}`);
    return;
  }
  const branch = `${AUTO_BRANCH_PREFIX}${process.env.GITHUB_RUN_ID ?? 'local'}`;
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['checkout', '-b', branch]);
  run('git', ['add', 'data']);
  run('git', ['commit', '-m', 'Auto-draft recent recalls']);
  run('git', ['push', '-u', 'origin', branch]);
  const reviewer = process.env.RECALL_REVIEWER || repoOwner();
  const args = ['pr', 'create', '--title', 'New recalls (auto)', '--body', summary];
  if (reviewer) args.push('--reviewer', reviewer);
  try {
    run('gh', args);
  } catch (e) {
    warn(
      `opening the PR failed: ${msg(e)}\n` +
        '  If the error is "GitHub Actions is not permitted to create or approve pull requests",\n' +
        '  enable Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".',
    );
    throw e;
  }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (hasOpenAutoPr()) {
    log('An auto-recall PR is still open — skipping this run so it can be reviewed/merged first.');
    return;
  }

  const state = loadSeen();
  const seen = new Set(state.seen);

  const existing = loadRecalls(DATA_DIR);
  const used = new Set(existing.ok ? existing.recalls.map((r) => r.id) : []);
  const existingUrls = new Set(
    existing.ok ? existing.recalls.flatMap((r) => r.citations.map((c) => c.url)) : [],
  );

  const today = new Date();
  const todayIso = isoDate(today);
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - LOOKBACK_DAYS);
  // If a prior run stalled (an open PR blocked runs for > LOOKBACK_DAYS), extend
  // the window back to the last successful run so recalls don't scroll out.
  const lastRun = state.lastRun ? normalizeDate(state.lastRun) : '';
  const from = lastRun && lastRun < isoDate(defaultFrom) ? parseIsoDate(lastRun) : defaultFrom;

  const records: SourceRecord[] = [];
  try {
    records.push(...(await fetchOpenfda(compactDate(from), compactDate(today))));
  } catch (e) {
    warn(`openFDA fetch failed: ${msg(e)}`);
  }
  records.push(...(await fetchFsis()));

  const fresh = records.filter(
    (r) => !seen.has(r.key) && !(r.citationUrl && existingUrls.has(r.citationUrl)),
  );
  log(`${records.length} record(s) fetched, ${fresh.length} new.`);

  if (fresh.length > 0 && !process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — set it as a repository secret.');
  }

  const excluded: { rec: SourceRecord; reason: string }[] = [];
  let added: Recall | null = null;

  // One recall per run: scan past excluded (local/insignificant) records and stop
  // at the first significant one. A drafting error aborts the run (failing the
  // workflow); the unfinished record is retried on the next run.
  for (const rec of fresh) {
    const result = await groqDraft(rec, used, todayIso);
    seen.add(rec.key);
    if (result.recall) {
      added = result.recall;
      break;
    }
    if (result.excluded) excluded.push({ rec, reason: result.excluded });
  }

  if (!DRY_RUN) saveSeen({ seen: [...seen].slice(-MAX_SEEN), lastRun: todayIso });

  if (!added) {
    log('No new recalls to add.');
    if (DRY_RUN) {
      for (const e of excluded) log(`  [dry-run] excluded: ${e.rec.firm} — ${e.rec.product}`);
    }
    return;
  }

  const summary = buildSummary(added, excluded);
  log(summary);

  if (DRY_RUN) {
    log('\n[dry-run] drafted entry:\n');
    log(stringify({ recalls: [added] }, { lineWidth: 0 }));
    return;
  }

  appendAutoEntry(added);

  // Gate on the same validator the site and CI use; abort before touching git if invalid.
  const check = loadRecalls(DATA_DIR);
  if (!check.ok) {
    warn(`validation failed — nothing committed:\n  ${check.errors.join('\n  ')}`);
    process.exit(1);
  }

  openPr(summary);
}

main().catch((e) => {
  warn(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
