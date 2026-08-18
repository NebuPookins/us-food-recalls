import type { SiteMeta } from './render.ts';

/**
 * Edit these two lines when you fork this. `siteUrl` only affects the absolute
 * links inside the Atom feed; every asset link in the HTML is relative, so the
 * site works unchanged at a user page, a project page or `file://`.
 */
export const SITE = {
  title: 'US Nationwide Food Recalls',
  description: 'A hand-curated, cited timeline of nationwide food recalls in the United States.',
  siteUrl: process.env.SITE_URL ?? 'https://nebupookins.github.io/us-food-recalls',
} as const;

export function siteMeta(): SiteMeta {
  return { ...SITE, buildDate: new Date().toISOString().slice(0, 10) };
}
