# V2.86 — assignment loading and selected Location cancellation

The assignment menu repeatedly fetched annual job data for its summary, zone controls and job list, sorted large Location arrays repeatedly, and rendered thousands of hidden review rows. Its bulk cancellation controls operated across the Session.

## Behavior

- Fetch snapshots, assignments, Location/profile labels, jobs, job items and transfer history in one compact, consistent database snapshot. Concurrent consumers share the same request. Reject incomplete responses, obsolete page/account/role responses and failed reads. Reload on mutations, menu entry, cancellation entry and expiry of the short 10-second in-page reuse window.
- Reuse locale comparators with unchanged natural ordering. Cache derived Location rows by input identity. Render the normal list and review/print list in pages of 100; build the review list only when opened. Select-all and printing still cover the complete filtered set across pages.
- Put both cancellation buttons in section 1, “เลือกโหมดและกรองงาน”. Open a Location chooser with Zone/Row/Level/search filters, paging, selection count and confirmation. Changing filters removes hidden selections.
- Normal cancellation skips counted and finished work. Annual cancellation removes only selected unfinished Locations from JOB items, including when a JOB contains other Locations. Remaining Locations keep their JOB; existing count records, supporting evidence, assignment IDs and audit history remain intact. Partially counted released assignments return to the expired/reassign queue.
- Preview current server state, then check its token again while holding transaction locks. Changed counts, ownership, session rules or job membership reject the operation. Failed writes roll back the entire cancellation. No all-session client delete loop remains behind either moved button.

## Validation

- Full automated suite: 185 tests passed. Targeted assignment tests also rerun after the final cache freshness change.
- Full menu in isolated Edge/PGlite with 12,000 synthetic Locations and 4x CPU throttle: 4.059 s initial Session load, one workspace request, 100 rendered rows per page. The intermediate implementation before comparator reuse measured 14.020 s under the same fixture; this is not a measured V2.85 production baseline.
- Browser checks: select all across pages, prune selection after filter changes, cancel one normal Location, cancel one Location in a multi-Location JOB, preserve unselected work, print all 11,998 remaining assignments across review pages, mobile layout without horizontal overflow, no browser errors.
- Production read-only comparison: 13,602 snapshot rows, 11,713 assignments, 6,419 JOB items. Packed snapshot and assignment rows matched their source values and included every source row. No live assignment, count or stock records were modified during testing.
- Installed RPC read measured 456.981 ms database execution with the existing authenticated management RLS. Raw uncompressed bundle size was approximately 8.12 MB. Database timing excludes transfer, browser work and network variability; the synthetic browser timing is not a warehouse-device or unreliable-network guarantee.

## Database and compatibility

Migration `20261031032412_assignment_workspace_v286.sql` adds three security-invoker management RPCs and a partial index for annual-to-normal transfer history. Functions require an authenticated admin/supervisor, retain existing RLS and revoke public/anonymous execution. Install the migration before deploying the HTML. No SQL data rewrite is included.

Existing offline storage, pending operations and receipt formats are unchanged. Counts pending on a device when its work is deliberately cancelled may need later review; the confirmation explains this. The unapproved V2.83 theme preview is excluded.
