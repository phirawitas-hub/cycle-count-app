# V2.88 — Session OH visibility continuity

Prepared next-Location envelopes retained the Session's earlier `show_oh` value. Opening a recently prefetched Location could therefore revert the display after an administrator changed OH, even though the database setting was correct.

- Validate the single Session visibility field before using a prepared Location online. Reuse the envelope when unchanged; obtain a fresh signed envelope when changed. A prefetch already in flight is allowed to finish before a second read if it still contains the previous value.
- Keep pending operations and drafts on their original generation, UUID, scope/state tokens and quantities. Only their displayed OH can reflect a newer verified Session setting. Existing server conflict/review checks remain enforced.
- Network failures preserve usable downloaded work. Authorization and malformed-response failures do not silently authorize a stale bundle. Offline devices continue with downloaded settings and cannot receive administrator changes until connected.
- Require an updated Session row with the requested OH value before reporting toggle success. Recover the control after thrown read/write errors.
- Replace the Session OH control with a keyboard-accessible switch, explicit on/off text, SVG eye icon, visible focus and disabled state. Remove the assignment sidebar's Zone-summary disclosure; retain the main dashboard and its colors.
- Bump the service-worker shell version without clearing IndexedDB, receipts, pending operations or browser preferences.

Validation:

- Full existing unit/database suite: 194 tests passed before the final in-flight-prefetch regression was added; final targeted OH suite includes that case.
- Actual production count form in isolated Edge/PGlite: cached next Locations follow OH off → on → off; offline reopening works; management switch keyboard operation persists the returned database value; desktop/mobile controls do not overlap or overflow; no page errors.
- Offline recovery browser suite: 6 offline Locations including 3 empty Locations; automatic next navigation, retained reassignment evidence and export; 10 counts / 10 audits / 10 receipts; no browser errors.
- No live counts, stock, assignments or Session settings changed during verification. No database migration required.
