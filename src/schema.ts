import { z } from 'zod';

/**
 * The single source of truth for the shape of `data/recalls/*.yaml`.
 *
 * Everything downstream (the validator CLI, the renderer, the emitted
 * JSON Schema used for editor autocomplete) derives from this module.
 */

/** `YYYY-MM-DD`. Kept as a string on purpose: see `formatDate` in render.ts. */
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date (quote it if YAML complains)')
  .refine(isRealCalendarDate, 'not a real calendar date');

function isRealCalendarDate(s: string): boolean {
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= lengths[m - 1];
}

/** Why the food is a concern. Closed set so the site can filter and colour-code. */
export const HAZARDS = [
  'listeria',
  'salmonella',
  'e-coli',
  'botulism',
  'hepatitis-a',
  'norovirus',
  'cyclospora',
  'undeclared-allergen',
  'foreign-material',
  'chemical-contamination',
  'processing-defect',
  'mislabeling',
  'other',
] as const;

/** FDA recall classification. I = reasonable probability of serious harm or death. */
export const CLASSIFICATIONS = ['I', 'II', 'III'] as const;

/** Which federal agency announced it. FSIS covers meat, poultry and egg products. */
export const AGENCIES = ['FDA', 'FSIS', 'CDC', 'other'] as const;

/** Lifecycle status. `retracted` marks a report that was withdrawn or a false positive. */
export const RECALL_STATUSES = ['active', 'retracted'] as const;

const Product = z.strictObject({
  name: z.string().min(1).describe('The product as a shopper would recognise it on the shelf.'),
  brand: z.string().min(1).optional(),
  codes: z
    .array(z.string().min(1))
    .nonempty()
    .optional()
    .describe('Lot codes, UPCs, best-by dates, establishment numbers.'),
});

const Citation = z.strictObject({
  title: z.string().min(1),
  // Scheme is constrained here rather than in a comment: this string is
  // interpolated straight into an href, and escaping does nothing to
  // `javascript:` or `data:` URLs.
  url: z.url({ protocol: /^https?$/ }).describe('Must be a full http:// or https:// URL.'),
  publisher: z.string().min(1).optional().describe('e.g. "FDA", "AP News".'),
  accessed: IsoDate.optional().describe('When you last confirmed this link worked.'),
});

export const RecallSchema = z.strictObject({
  id: z
    .string()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'must be a lowercase kebab-case slug, e.g. "2026-08-acme-spinach"',
    )
    .describe('Stable unique slug. Becomes the permalink anchor, so never rename one.'),
  parent_id: z
    .string()
    .min(1)
    .optional()
    .describe('id of the umbrella alert this entry is part of.'),
  date: IsoDate.describe('Date the alert was announced.'),
  title: z
    .string()
    .min(1)
    .describe(
      'One-line headline naming the product and what\'s wrong with it, e.g. "DQ Chocolate Reduced Fat Ice Cream Mix contains metal shavings".',
    ),
  summary: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('One- or two-word food labels for the "at a glance" list at the top of the page.'),
  recalling_firm: z.string().min(1).optional(),
  agency: z.enum(AGENCIES).optional(),
  hazards: z
    .array(z.enum(HAZARDS))
    .nonempty()
    .refine((hazards) => new Set(hazards).size === hazards.length, 'must not contain duplicates'),
  classification: z.enum(CLASSIFICATIONS).optional(),
  products: z.array(Product).nonempty(),
  distribution: z
    .string()
    .min(1)
    .optional()
    .describe('Free text, e.g. "Nationwide" or "Nationwide via online orders".'),
  illnesses: z.int().nonnegative().optional().describe('Reported illnesses at time of writing.'),
  deaths: z.int().nonnegative().optional(),
  note: z.string().min(1).describe('Short plain-text description. HTML and markdown are escaped.'),
  status: z
    .enum(RECALL_STATUSES)
    .optional()
    .describe('active (default) or retracted (withdrawn / false positive).'),
  ended: IsoDate.optional().describe('Date the alert was closed out.'),
  citations: z.array(Citation).nonempty(),
});

/** The on-disk shape of one `data/recalls/*.yaml` file. */
export const RecallFileSchema = z.strictObject({
  recalls: z.array(RecallSchema).nonempty(),
});

export type Recall = z.infer<typeof RecallSchema>;
export type RecallFile = z.infer<typeof RecallFileSchema>;
export type Product = z.infer<typeof Product>;
export type Citation = z.infer<typeof Citation>;
export type Hazard = (typeof HAZARDS)[number];

/** Human-readable labels for the closed sets, used by the renderer and filters. */
export const HAZARD_LABELS: Readonly<Record<Hazard, string>> = {
  listeria: 'Listeria',
  salmonella: 'Salmonella',
  'e-coli': 'E. coli',
  botulism: 'Botulism',
  'hepatitis-a': 'Hepatitis A',
  norovirus: 'Norovirus',
  cyclospora: 'Cyclospora',
  'undeclared-allergen': 'Undeclared allergen',
  'foreign-material': 'Foreign material',
  'chemical-contamination': 'Chemical contamination',
  'processing-defect': 'Processing defect',
  mislabeling: 'Mislabeling',
  other: 'Other',
};

/** Reader-facing buckets for the "what do you care about" filter. */
export const HAZARD_CATEGORIES = [
  'pathogens',
  'foreign-objects',
  'undeclared-allergens',
  'other',
] as const;

export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];

/** Human-readable labels for the buckets, used by the renderer. */
export const CATEGORY_LABELS: Readonly<Record<HazardCategory, string>> = {
  pathogens: 'Bacteria & pathogens',
  'foreign-objects': 'Foreign objects',
  'undeclared-allergens': 'Undisclosed allergens & mislabeling',
  other: 'Everything else',
};

/** Which bucket each hazard falls into. Total over `Hazard` by construction. */
const HAZARD_TO_CATEGORY: Readonly<Record<Hazard, HazardCategory>> = {
  listeria: 'pathogens',
  salmonella: 'pathogens',
  'e-coli': 'pathogens',
  botulism: 'pathogens',
  'hepatitis-a': 'pathogens',
  norovirus: 'pathogens',
  cyclospora: 'pathogens',
  'undeclared-allergen': 'undeclared-allergens',
  'foreign-material': 'foreign-objects',
  'chemical-contamination': 'pathogens',
  'processing-defect': 'other',
  mislabeling: 'undeclared-allergens',
  other: 'other',
};

/** The categories an entry belongs to, derived from its hazards. An entry with
 *  hazards in more than one coarse bucket belongs to all of them, so the
 *  category filter shows it whenever any of its categories is checked. */
export function categoriesOf(hazards: readonly Hazard[]): readonly HazardCategory[] {
  return [...new Set(hazards.map((h) => HAZARD_TO_CATEGORY[h]))];
}
