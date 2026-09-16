# V2.70 verification — 2026-09-16

Scope: Overview navigation/revision caches and Assigned Work re-entry. No
stock/count/assignment records, existing RLS policies or table grants changed.

## Automated production-function tests

Run `node --test tests/*.test.cjs`. Tests extract the actual inline functions
from index.html; they do not reimplement the application. Seven dashboard
regressions failed before the patch and passed after it. See README.md for
coverage and limits. Successful tests are not an end-to-end latency guarantee.

## Read-only database verification

The new RPC was compared with the old workspace function in read-only
transactions under authenticated admin/supervisor/counter roles, including an
empty-workspace counter. All six operational arrays were equal after normalizing
array order. Existing row visibility was preserved. Baselines use the same
assignment scope/action/columns and are now read in the same STABLE snapshot.

| Sample | Assignments | Full JSON bytes | Verified unchanged JSON bytes |
| --- | ---: | ---: | ---: |
| Admin | 168 | 212,790 | 252 |
| Supervisor | 500 | 1,102,155 | 257 |
| Counter | 1,994 | 2,307,464 | 254 |
| Empty counter | 0 | 518 | 254 |

Single EXPLAIN ANALYZE samples for the 1,994-assignment counter: full bundle
495.331 ms; verified unchanged bundle 2.104 ms. These are SQL execution times
with warm database buffers, excluding HTTP, transfer, client processing and
browser rendering; they are not comparable to cold-end-to-end timings or P95.

Anonymous execution denied for both new functions. Public data RPC is SECURITY
INVOKER. A private, auth-checked helper returns only a SHA-256 self-scoped version
token. Advisor checks found no findings naming the new functions; pre-existing
security/performance notices remain outside this patch.

## Operational notes

The first read or any changed Session/catalog still performs a complete scoped
read. A timeout, denial or malformed response never permits stale-cache use.
Date filters are recomputed from raw verified data, including across midnight.
Future changes to authorization policies must invalidate the read contract or
bump the catalog revision, as with the existing management revision protocol.

Rollback frontend to the parent commit if required. The additive RPC can remain
unused safely; no existing function or data was replaced by this migration.
