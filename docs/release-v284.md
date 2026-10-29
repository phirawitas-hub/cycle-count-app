# V2.84 — empty-location counting continuity

Base: released V2.82 (9af2b6b). The unapproved V2.83 appearance preview is excluded.

Empty placeholders were rejected by both preparation and submission RPCs and the client bundle validator. Offline navigation consequently skipped them; zero saves fell back to a network-only path. V2.84 prepares verified zero-OH placeholders and saves explicit zero through the existing IndexedDB outbox and idempotent SQL receipt transaction. A pending send alone no longer causes online navigation to skip an unprepared location.

Positive quantities on empty placeholders still require the existing Found Work workflow. Offline entries retain quantity, Location, LPN, Item, description, UOM and evidence as drafts. They do not become positive placeholder counts or silently become zero. Blank quantities, mismatched scanned locations and zero alongside an entered Item are rejected.

No storage reset, stock adjustment, count-data migration, privilege widening or receipt format change is included. Existing device-local pending operations retain their database, IDs and protocol. The migration replaces only two function bodies and preserves ownership, locks, conflict checks and grants.

## Validation

- 167 automated tests passed, including real PostgreSQL execution via PGlite: zero, blank, positive discovery, stale stock, ownership, closure, lost acknowledgements and duplicate submission.
- Isolated Edge browser: six consecutive offline locations with three empty placeholders; correct next-location order; ten stored counts, ten count audit entries and ten receipts after automatic synchronization; no browser errors.
- Actual mobile count form: explicit zero saves offline, repeated OK does not enqueue twice, confirmation completes the location; Found Work draft survives reload; wrong Location and inconsistent zero/Item inputs are rejected.
- Current live function bodies matched the released migration before modification. Production records were not modified for testing.

Offline continuation still requires each location's data to have arrived while connected. New or changed work cannot be downloaded without connectivity. Physical warehouse handheld/network conditions require field verification; this release does not claim universal offline availability.
