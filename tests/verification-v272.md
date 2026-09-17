# V2.72 Team rendering verification — 2026-09-17

V2.71 was deployed at 97976d6786b1681d2ce7a96e8553164ac0b8e476.
Authenticated browser QA confirmed Summary re-entry in 1,062 ms and another
sample in 1,438 ms; displayed text matched the corresponding complete first
read. These are individual automation-assisted samples, not a latency SLA.
The Admin account has no Assigned Work: populated cases are covered by the
V2.70 database comparisons and function tests, not live populated UI testing.

Initial Summary loading still exceeded 30 seconds in live observations. Team
loaded successfully, but its initial collapsed view contained 8,157 hidden
detail rows and 41,323 total DOM elements. A repeat test's broad text locator
timed out; this is not an accurate completed-menu latency measurement.

V2.72 retains all verified Team detail records inside the scoped view cache.
Only the 13 observed summary groups are painted initially; opening one group
renders its complete details, using the current location-sort direction.
Closing the group releases those DOM rows. No extra data request, row cap,
operational write, database change, or authorization relaxation is introduced.
The view's actor, role, Session, date range and active tab must match before
details can open. Existing server revision verification still precedes reuse.

64 production-function tests pass, including a 1,994-row expansion, collapse/
reopen, sorting, scope rejection and fallback completeness. This patch reduces
browser work; it does not by itself resolve expensive first database reads.
