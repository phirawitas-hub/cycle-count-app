# V2.74 — phase 1, remove redundant client work

## Implemented

- Team renders after the existing historical OH recovery, effective workflow calculation and assignment-date filtering. It no longer builds unrelated WMS, Summary, Zone and hourly-chart output first. The renderer was moved verbatim; complete lazy detail data and revision-verified cache remain.
- Layout no longer builds discarded legacy rack HTML before the actual matrix. A render-local index replaces repeated full-location scans while preserving both rack-only and zone/rack lookup semantics. No stale index persists across refreshes.
- Summary/WMS/other non-Layout tabs no longer derive the full Layout assignment workflow or duplicate the raw-count index.
- WMS skips Summary-only sets and the unused workflow Map. Queue membership, notes, final quantities, variance and stock-write paths are unchanged.
- Cold Summary/Team/Executive/Log requests skip the metadata precheck when no eligible rendered-cache candidate exists. If the full bundle falls back, the before-revision is read before any paged data/settings reads; after-read verification remains. Warm HTML still requires fresh authorized revision verification.
- Local console phase timings contain only menu, phase and elapsed milliseconds; no identities, Session IDs, records or credentials. These checkpoints help distinguish server/read delay from browser computation, but are not HTTP/network traces or paint-frame timings.

## Verification before rollout

- Two inline scripts parse.
- 82 automated tests pass, including all previous regression coverage (two test harness expectations updated for the extracted Team helper).
- New tests compare Team HTML and all detail rows exactly with the V2.73 source, including 1,994 rows, duplicate assignee names and historical review states.
- Layout returned HTML matches V2.73 in fixtures; the discarded legacy renderers are never invoked. Rack-index tests preserve duplicate IDs across zones, source order, totals and refreshed arrays.
- Cold full reads skip the extra metadata request; fallback tests verify metadata precedes row reads. Actor/role/Session/date/revision cache checks remain.
- index.html was edited through exact Buffer replacements to preserve pre-existing non-UTF-8 bytes outside the changed fragments.

Command on the restricted Windows runner:

`node --test --experimental-test-isolation=none --test-reporter=spec tests/*.test.cjs`

The normal isolated runner cannot spawn child processes in this sandbox (EPERM); the documented non-isolated test mode runs the same tests.

## Scope and remaining work

This is the first phase, not the proposed server-derived WMS queue. V2.73's complete compact Supabase RPC is still used. No database schema, RLS, stock/count/approval records or business formulas were changed.

The <5-second first-entry target is NOT established by unit tests or this refactor. Live before/after observations are recorded separately after deployment. The next larger step is an exactly equivalent WMS-specific derived read response; do not switch production to it until full queue, totals, filters, location-close semantics and historical notes pass same-snapshot equivalence checks.
