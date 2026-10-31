# V2.87 — organized assignment controls and JOB cancellation picker

The added cancellation button did not fit the older compact toolbar grid and wrapped the status filter onto a separate row. Both toolbar states now use explicit positions: assignment modes, status with cancellation action, assignee, and primary actions. Responsive layouts preserve these groups.

The cancellation dialog separates its heading, filters, Location list and confirmation footer. Annual mode replaces free-text search with a JOB dropdown containing only jobs with unfinished cancellable Locations. Options show the job code and unique Location count, use exact job IDs, and exclude completed jobs, empty jobs and jobs whose Locations are all completed/WMS-closed. Normal mode retains Location search. Changing the JOB or spatial filters removes hidden selections and never automatically confirms or cancels work. Shared-Location selections explicitly identify that cancellation affects the displayed jobs sharing those Locations.

The server-side cancellation RPC, transaction guards, count preservation, read path and offline queues are unchanged. No database migration or live data update is part of this release.

Validation: ten targeted unit/database tests passed, including eligible JOB options, exact-ID filtering, protected work, stale-state rejection and rollback. Isolated full-menu Edge/PGlite checks with 12,000 synthetic Locations passed selection across pages, normal cancellation, selected-Location JOB cancellation, review printing, compact toolbar alignment, and desktop/mobile dialog layout without horizontal overflow or browser errors. Screenshots were inspected. Tests use synthetic data only.
