# V2.76 — per-session Zone Plan

User reviewed the local V2.76 preview and explicitly approved GitHub publication. Release HTML differs from that approved preview only in the version label and diagnostic log label (preview suffix removed).

- Original cycle-count Session keeps the central Location Plan by default.
- Spare part DMG defaults to its imported Location + Item pairs. One location with five items is five jobs; recount rounds do not increase Plan.
- A Plan-basis selector remembers the choice per user and Session on that device. This is a browser preference, not a shared database setting.
- Imported but unassigned/uncounted pairs remain in Plan. Only imported pairs contribute; recorded counts outside the imported set do not enlarge it.
- Completion uses existing item workflow and durable count/approval history. New uncounted items remain pending even in a previously completed location.
- Zone progress remains cumulative across the Session; Accuracy/DIFF calculations and the existing central-plan path are retained.
- No database schema, stock or count writes and no extra dashboard data request.

## Verification

96 tests passed, including imported-pair/recount deduplication, unassigned imports, historical completion, approval state, central-plan equivalence and per-user/per-session cache isolation. Both inline scripts parse.

Read-only DMG data at review: Plan 577 jobs, 176 completed, 401 remaining. Selective 168/404 (42%); Selective A 8/26 (31%). Other imported zones are pending. These are observations at review, not hardcoded totals.

The standalone Plan review's selectors and display were checked in browser; user approved the full HTML preview. Authenticated live-version navigation has not been independently rerun for this release. Deployment verification checks Pages success and the served version.
