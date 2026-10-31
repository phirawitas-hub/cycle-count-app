# V2.89 — Include expired work in cancellation

Expired assignments have no current assignee; the previous assignee is retained in `expired_from`. Both the cancellation dialog and server preview previously required `assigned_to`, so expired Locations were omitted.

- Rename both cancellation buttons and the dialog title to **ยกเลิกงาน**.
- Include expired normal assignments with an expiration timestamp and previous assignee. Show the expired status and previous user's name in the dialog.
- Extend the existing invoker preview function to recognize these assignments. Keep the existing count-evidence, completed/WMS-closed and active-JOB exclusions, row locks, preview token and atomic cancellation behavior.
- Normal work with existing count records remains protected. Cancelling eligible uncounted expired work clears its assignee/expiration fields without deleting its assignment, audit history or supporting evidence.
- Existing expired JOB cancellation remains available, scoped to selected Locations.

Validation:

- 15 targeted frontend/database tests passed, including expired pending/in-progress assignments, preserved zero counts, completed/WMS-closed exclusions, concurrent reassignment rejection and expired JOB selection.
- Isolated production browser test with 12,000 Locations passed: expired Location appears and cancels, expiration fields clear, other Locations remain unchanged, JOB filtering/selection and printing across pages work; no mobile overflow or browser errors.
- Applied migration `expired_assignment_cancel_v289`; deployed function body hash matches the tested source. Security invoker and existing execute permissions remain unchanged.
- Read-only live preview under authenticated management access: 45 expired Locations across 2 active Sessions, all 45 eligible for normal cancellation. No live cancellation or count/stock writes were executed during verification.
- Security advisory categories/counts unchanged from before this migration; pre-existing unrelated findings are outside this fix.
