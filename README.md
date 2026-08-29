# US Food Safety Alerts

A static site generated from YAML. You edit a data file, commit, push, and GitHub
Actions builds and publishes the HTML to GitHub Pages.

View the live site at https://nebupookins.github.io/us-food-recalls/

## Everyday use

1. Add an entry to `data/recalls/<year>.yaml` (create the file if the year is new).
2. `npm run preview` → open <http://localhost:8080/>.
3. Commit. The pre-commit hook validates the data and refuses the commit if it's wrong.
4. Push. The Action re-validates, builds, and deploys.

## Commands

| Command | What it does |
| --- | --- |
| `npm run preview` | Build, then serve `dist/` at <http://localhost:8080/> |
| `npm run build` | Generate `dist/` — this is exactly what CI runs |
| `npm run validate` | Check the YAML only. Fast; the git hook calls this |
| `npm run schema` | Regenerate `schema.json` after editing `src/schema.ts` |
| `npm run typecheck` | `tsc --noEmit` |

No build step or bundler: Node runs the TypeScript directly, so `npm install` and
`npm run build` is the whole toolchain. Requires **Node 24+**.

## Writing an entry

```yaml
- id: 2026-08-acme-spinach      # unique, kebab-case, permanent — it's the permalink
  date: 2026-08-14              # announcement date
  title: Acme Foods bagged baby spinach
  summary:                      # optional: food labels for the "foods to check" list
    - spinach
  recalling_firm: Acme Foods Inc.
  agency: FDA                   # FDA | FSIS | CDC | other
  hazards: [listeria]           # see HAZARDS in src/schema.ts
  classification: I             # I | II | III
  distribution: Nationwide
  cases:                        # optional: timestamped case counts
    as_of: 2026-08-14           # required when `cases` is present
    illnesses: 12
    hospitalizations: 3
    deaths: 1
  ended:                        # optional: omit while the alert is open
    announced: 2026-09-01       # date the end was officially announced
    note: Most product should be past expiration and off shelves.
    citations:                  # required: sources showing it ended
      - title: Acme Foods outbreak investigation (closed)
        url: https://www.fda.gov/...
        publisher: FDA
        accessed: 2026-09-01
  products:
    - name: Baby Spinach, 5 oz clamshell
      brand: Acme Farms
      codes: ["UPC 0-00000-00000-0", "Best by 2026-09-02"]
  note: |
    Plain text. Blank lines become paragraphs. Markdown and HTML are escaped,
    not rendered — links belong in `citations`.
  citations:
    - title: Acme Foods Inc. Recalls Baby Spinach
      url: https://www.fda.gov/...
      publisher: FDA
      accessed: 2026-08-15
```

Required: `id`, `date`, `title`, `hazards`, `products`, `note`, `citations`.
Everything else is optional and simply omitted from the page when absent.

`parent_id` links a sub-alert to its umbrella alert (rendered as a "Part of:"
link). `status: retracted` marks a report that was withdrawn or was a false
positive; those are published on `retracted.html` rather than the main timeline.

`ended` marks a recall or outbreak as over: the entry is removed from the
"Foods to check" list at the top but still appears in the timeline and search
with an "Ended" tag, followed by a callout with the announcement date, an
optional note, and the `citations` (required, non-empty) that show it ended.

`cases` holds illness, hospitalization and death counts **as of a specific
date**. The `as_of` date is what makes a number meaningful — counts go stale as
an outbreak evolves, so an untimestamped "12 illnesses" is a snapshot pretending
to be current. If you can't find a reliable "as of" date for a count, omit the
whole `cases` block rather than publishing a number without its date. A `0`
means "none reported as of that date"; a count you simply don't have is left out
rather than guessed at.

The `# yaml-language-server: $schema=../../schema.json` line at the top of each
data file gives you autocomplete and inline errors in VS Code / Zed / Neovim
(install the YAML extension). That's the fastest feedback loop — the hook and CI
are backstops.

`src/schema.ts` is the single source of truth. After changing it, run
`npm run schema` and commit the regenerated `schema.json`; CI fails if it's stale.

## First-time setup on GitHub

1. Push the repo.
2. **Settings → Pages → Source → GitHub Actions.** The deploy fails until you do
   this; it can't be set from code.
3. Set `siteUrl` in `src/config.ts` (only affects absolute links in the Atom feed;
   CI overrides it with the real Pages URL anyway).

The hook is wired by `npm install` (a `prepare` script points `core.hooksPath` at
`.githooks/`). On a fresh clone, run `npm install` once. `git commit --no-verify`
bypasses it, which is why the same validation also runs in CI.

## Output

`dist/` contains `index.html` (whole timeline, with client-side search and
hazard/year filters), `style.css`, `filter.js`, `feed.xml` (Atom), and
`recalls.json`. All asset links are relative, so it works at a project page, a
user page, or straight off the filesystem.

## Data provenance

Entries here are hand-written and hand-cited. If you want to seed or cross-check
against the primary sources, the [openFDA food enforcement
API](https://open.fda.gov/apis/food/enforcement/) and the [FSIS recall
API](https://www.fsis.usda.gov/science-data/developer-resources/api) both expose
recalls as JSON. They're a firehose rather than a curated timeline, but they're
useful for catching things you missed and for verifying dates and firm names.

`data/recalls/2026.yaml` holds the hand-curated entries; `2026-auto.yaml` holds
auto-drafted entries from `scripts/sync-recalls.ts` awaiting review.
