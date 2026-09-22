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

## Browser verification

Pending V2.75 deployment and authenticated navigation. V2.74 baseline retains all 9 WMS pages, totals, historical notes/variance, and the other three menu outputs for comparison. Do not claim the initial 5-second target is met until measured on the deployed version.
