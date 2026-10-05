# Notes for agents

- `scripts/sync-recalls.ts` degrades silently: a source that fails (HTTP error, shape mismatch) logs a `⚠` warning and the run still goes green. For a suspected missed recall, check the CI log for `⚠ FSIS HTTP …` and run `node scripts/sync-recalls.ts --dry-run` (works without `GROQ_API_KEY`; it stops after printing the fetched/new counts).
- The FSIS recall API (`fsis.usda.gov`, behind Akamai) 403s a bare Node `fetch` and short-UA `curl`; it needs full browser-like headers (`FSIS_HEADERS`). See `docs/learnings/fsis-api.md`.
