# V2.73 management read optimization — 2026-09-21

## Scope

Dashboard (`summary`), Team Progress (`team`), Warehouse Layout (`layout`), and WMS confirmation/stock adjustment (`wms`) now prefer `get_management_read_bundle_v273`.

- Lossless columnar JSON: column names appear once per collection; every existing row, value, type, NULL and ordering is retained. Decode to the old object contract before existing business calculations and validation.
- Historical OH recovery uses materialized counted-assignment / zero-baseline sets instead of a correlated audit lookup per snapshot. NULL, blank and numeric-zero baseline semantics are unchanged.
- Preserve authorized same-snapshot reads, RLS, revision checks, unchanged responses, location deltas, cancellation, actor/role/Session cache isolation, row-count validation and complete paged fallback.
- A genuinely missing V2.73 endpoint can use V2.63 once during rolling deployment. Denial, timeout or invalid data cannot trigger this compatibility retry.
- Other menus continue using their existing endpoint. Existing V2.63 RPC is retained. No business data or stock quantities were written.

Migration: `20260921014205_management_compact_read_v273.sql`. Installed function body MD5 matches the local migration: `687eab31b6794502712fed8c72636da1`.

## Data equivalence

Read-only tests under authenticated Admin against the largest current Session (8,157 assignments): all 16 row collections matched V2.63 exactly for **all four tabs**, including audit histories, count rounds, OH recovery details, WMS approvals/remarks and layout jobs/settings. The candidate query was executed from the migration's SELECT before installing the function; installed function source was subsequently verified identical.

Additional direct old/new RPC comparisons for full Summary and Team were identical including metadata. Explicit single-Location reads matched including metadata under Admin and Supervisor. Unchanged revision responses matched exactly (256 bytes for Team). Counter was rejected with SQLSTATE 42501; anon was rejected at function privilege level.

One additional large Layout direct-RPC comparison request returned connector HTTP 504, so it is **not** recorded as a passing test. Its pre-install query row equivalence passed; post-install actual Layout payload size was separately measured successfully. No unfinished database read was observed afterward.

## Payload size

UTF-8 bytes of PostgreSQL JSON text, **not compressed HTTP transfer size**:

| Tab | V2.63 bytes | V2.73 bytes | Reduction |
| --- | ---: | ---: | ---: |
| Summary | 16,220,549 | 10,797,719 | 33.4% |
| Team | 16,069,056 | 10,683,199 | 33.5% |
| Layout | 17,950,260 | 12,113,312 | 32.5% |
| WMS | 16,372,240 | 10,907,065 | 33.4% |

Trade-off: the per-collection column schema adds approximately 3 KB of fixed overhead. A one-Location Summary sample grew from 3,530 to 4,847 bytes. Tiny unchanged responses have no column metadata overhead. This change targets large full loads, not compression efficiency for tiny deltas.

## Timing and limits

One warm `EXPLAIN (ANALYZE, BUFFERS)` sample per actual Team RPC, under authenticated Admin:

- V2.63: **4,550.192 ms**
- V2.73: **2,598.547 ms**

These are individual database execution measurements, not an A/B load test, P95, or end-to-end page timing. An inlined candidate SELECT measured 1,176.333 ms, but that is not equivalent to RPC timing and is not used for the user-facing improvement claim.

Browser QA was blocked by `Unable to load browser request-header policy`. No claim that all four pages finish within 3–5 seconds is made. Payloads remain large; narrower menu-specific read models/server-side pagination remain possible future work but require reproducing complex OH/WMS business rules exactly.

## Automated verification

- `node tests/production-harness.cjs`: both inline scripts parse.
- `node --test --test-reporter=dot tests/*.test.cjs`: **75 tests pass**.
- New tests exercise all column schemas/types, Thai text, NULL/zero, row truncation, bad schema/column ordering, 12,000 rows without truncation, route selection, strict compatibility fallback, cancellation, decoded-cache scope validation, location deletion deltas, and fresh unchanged-cache verification.
- Existing 64 production-function regression tests remain passing.
- Byte-based index.html patching preserves pre-existing non-UTF-8 bytes outside the edited fragments. No unrelated HTML/CSS or business formula changes.

## Security

New function is STABLE, SECURITY INVOKER with empty search_path. PUBLIC/anon EXECUTE revoked; authenticated callers still require Admin/Supervisor checks and existing table RLS. No new advisor findings related to this function.

Pre-existing advisor findings remain unchanged and outside this performance patch: two RLS-enabled login tables without policies, two anon-callable definer RPCs, six authenticated-callable definer RPCs, and disabled leaked-password protection. These findings need a separate authorization review, not blanket permission changes during a performance patch. See [function permission advisors](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
