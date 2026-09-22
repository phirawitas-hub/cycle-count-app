# V2.75 WMS scoped read verification

## Change

- WMS alone uses `get_wms_read_bundle_v275`. Other menus keep their V2.74 readers.
- The server retains whole locations with any non-completed assignment or any approval (including drafts and zero variance).
- Completed-only locations without approvals may be omitted. The existing pending-queue gate explicitly excludes completed history; without an approval these assignments cannot produce a WMS row.
- Zero-OH and uncertain/zero baseline locations are also retained. This preserves the old loader's global historical-recovery gate and all per-location evidence.
- Direct location reads remain complete. Delta location IDs remain present when a location leaves the candidate set, removing stale cached children.
- No quantity, approval, count, status, stock or note write was added. Historical variance formulas, filter builders, pagination and close-location logic are unchanged.
- Candidate and full-session caches cannot share unchanged/delta responses. Only a genuinely absent endpoint permits full-read compatibility fallback. Errors fail closed.

## Automated verification

`node --test --experimental-test-isolation=none --test-reporter=spec tests/*.test.cjs`

90 passed, 0 failed. Both inline scripts parse. Covers authenticated revision reuse, missing-endpoint fallback, contract separation, cancellation/role change, candidate removal/re-entry, the exact production pending-queue gate, and existing menu tests.

The HTML was edited through exact Buffer replacements, retaining its existing non-UTF-8 bytes and CRLF convention. Whitespace checks must allow `cr-at-eol`.

## Read-only live database checks (2026-09-22)

Largest active session, admin authenticated RLS context. Old and new RPCs compared in one STABLE statement snapshot:

| Collection | Old | V2.75 |
| --- | ---: | ---: |
| Assignments | 8,157 | 1,046 |
| Snapshots | 9,918 | 2,226 |
| Counts | 10,876 | 2,605 |
| Approvals | 690 | 690 |
| Audit | 6,141 | 3,762 |
| Recovery details | 824 | 824 |
| Items | 8,955 | 1,832 |
| Locations | 8,222 | 1,046 |
| Profiles | 14 | 14 |
| Remarks | 7 | 7 |

- All 16 collections exactly equal the corresponding old rows in retained scope, with original ordering/values. Full approval collection is unchanged. All omitted assignments are completed.
- JSON text size: 10,907,064 -> 3,258,403 bytes (70.1% smaller). Not compressed HTTP transfer size.
- New RPC warm `EXPLAIN ANALYZE`: 1,917.768 ms, 49,918 shared hits, no reads or temp spills. This is one DB sample, NOT click-to-ready time or a guaranteed SLA. Prior old RPC sample was 2,774.468 ms, not a controlled paired benchmark.
- Admin and supervisor succeed; counter and anon are denied with 42501. Authenticated unchanged revision returns true. Direct completed-location response equals the old complete response except contract/timestamp.
- Existing security advisor notices predate this change: legacy SECURITY DEFINER endpoints, login tables with RLS/no policies, and disabled leaked-password protection. This new function is SECURITY INVOKER, empty search_path, admin/supervisor checked, with PUBLIC/anon execution revoked. No unrelated access changes were made.

Security follow-up references: [function access](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Browser verification (deployed V2.75, authenticated admin)

Pages deployment succeeded; the user logged in again after page navigation. First WMS entry in that page lifetime was measured before any previous WMS read. Database/HTTP caches were NOT forcibly cleared.

| Menu | Observed timing | Method |
| --- | ---: | --- |
| WMS first entry | 4,454 ms | Click to loading overlay hidden |
| WMS re-entry | 1,599 ms | Click to loading overlay hidden |
| Team first entry | 5,622 ms | Click to loading overlay hidden |
| Layout first entry | 14,502 ms | Click to loading overlay hidden |
| Dashboard initial automatic load | 6,140 ms | In-app loader to synchronous renderer completion; NOT click-to-ready |

WMS first-entry cumulative phases: sessions 288 ms, bundle validated 3,403 ms, historical recovery 3,444 ms, workflow 3,457 ms, renderer complete 3,534 ms. Bundle phase is 3,115 ms versus the earlier V2.74 sample 6,762 ms. These are separate observed runs, not a controlled benchmark or SLA guarantee.

Layout cumulative phases: sessions 467 ms, bundle validated 11,606 ms, recovery 11,769 ms, workflow 11,869 ms, renderer complete 12,983 ms. It remains a significant cold-entry bottleneck; V2.75 does not change its endpoint or data scope.

Correctness checks against the retained V2.73/V2.74 UI baseline:

- WMS all 9 full list-page texts exactly match, including quantities, historical variance, notes and close state. Last-page Next is disabled.
- Complete WMS KPI header and all 7 select controls (values, labels, option lists, disabled state) exactly match.
- Status filters pending/unfixed/fixed/all each exactly match their baseline list text.
- WMS totals: 344 rows, 1 pending, 343 reviewed; 219/219 eligible locations closed. Re-entry retains the same KPI header.
- Dashboard and Team full rendered content exactly match.
- Layout full text matches after removing only the live clock; all 1,816 Cool Room cell codes, classes and tooltips exactly match. Other zones were not independently retested.
- Browser warning/error log: empty at final check. No confirmation, close-location, stock or note writes were performed.

Conclusion: first-entry WMS passed 5 seconds in this observed run; repeat entry was faster. The all-menu 5-second target is NOT achieved, and performance across networks/load still needs repeated measurements. Prioritize Layout's scoped read next, then Team/Dashboard, without applying WMS's pruning predicate to those menus.
