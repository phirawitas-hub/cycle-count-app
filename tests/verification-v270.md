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

## V2.71 follow-up from live browser testing

V2.70 deployed successfully. A live authenticated Admin browser returned to
Summary with its real Session data in 980 ms from click to the visible Accuracy
heading (one automation-assisted sample, not P95). Displayed summary values
matched the preceding visit. The current Admin had no assigned work, so the
browser My Tasks check covers the empty state; populated cases were verified
with the database comparisons above and production-function tests.

Live Team Progress exposed an existing first/full-read timeout and paginated
fallback. Such fallback results lacked revision metadata, so V2.70 could not
reuse them safely. V2.71 adds a metadata-only, SECURITY INVOKER read using the
existing management authorization contract. Static Summary/Executive/Team/Log
views can now be reused after exact fresh revision verification even when the
large raw dataset is absent. Paged fallback views are stamped only after equal
before-and-after revisions; concurrent changes trigger the existing bounded
retry instead of painting/caching mixed revisions. Operational Tracker/Layout/
WMS views remain outside this static-view shortcut.

The extended production-function suite passes 58 tests. Read-only database
checks confirmed metadata-only results/current revisions for all four eligible
tabs. Full large-Session reads remain a limitation: read-only SQL samples for
Team took approximately 5.8–6.7 seconds, excluding transport/rendering. No
claim is made that every first visit or every menu meets 3–5 seconds.

The final review caught legacy fallback reads that swallowed paper/master/found/
item/profile/WMS-history errors. V2.71 now rejects those failures before rendering
or certifying the result, including pending-item reads and approval derivation
errors. Pending found items use complete pagination rather than a capped select;
fallback pages have unique ordering. A regression executes the actual dashboard
loader with a paper-read timeout and confirms no view/cache is published.
