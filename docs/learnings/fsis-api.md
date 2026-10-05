# FSIS recall API

- Endpoint: `https://www.fsis.usda.gov/fsis/api/recall/v/1`. Akamai bot protection 403s a bare Node `fetch` and `curl -A <short UA>`. It works with a full browser-like header set: Chrome UA plus `Accept-Language` and `Sec-Fetch-Dest/Mode/Site` (see `FSIS_HEADERS` in `scripts/sync-recalls.ts`). The `fetchpage` helper works for the same reason.
- It returns every recall since 2012 (~2k records) with `field_*` names (`field_recall_number`, `field_establishment`, `field_recall_date`, …) and has no server-side date filter, so filter by date client-side.
- `field_recall_date` is the FSIS announcement date and can be days earlier than news coverage (Fontanini: announced Sept 25, reported Sept 30). Use it for an entry's `date`.
- When testing header combinations in a shell, use bash, not fish: fish doesn't word-split `$H`-style header variables, which produces misleading `000` results.
