# V2.85 — retained offline results, fresh assignment checks and large queues

## Incident evidence and limits

The October 29 handheld screenshots show 27 operations requiring review, not proof that IndexedDB records were deleted. Production logs around the incident contain CC409 scope/closed-work rejections. A read-only audit found reassignment events before the incident, including the tablet's B-GH-002-A assignment. That assignment has a server count of 2 recorded at 18:14 Bangkok time. The actual handheld export is still needed to identify and reconcile the 27 operations. No count, stock, receipt or assignment records were changed during investigation/testing.

Code inspection found that prefetch/next navigation could reuse prepared jobs indefinitely. Status refresh, foreground work and synchronization also repeatedly read/visited unrelated cached jobs. The old review action archived local operations before opening a fresh count form; the replacement review UI keeps the original quantities visible and does not archive them.

## Changes

- Check known assignment issue times and cache age before opening untouched prepared work online. Keep pending results and drafts intact. Do not use a known superseded assignment offline or as a network-failure fallback.
- Protect the active form's generation from background preparation.
- Read a single assignment through existing IndexedDB indexes for foreground operations. Coalesce status updates, yield between preparation batches, group operations for readiness calculation, and sync only jobs with sendable operations.
- Pause the sync pass after a network/authentication failure instead of trying every remaining location on a broken connection.
- Show local quantity, counter, time and server comparison in review. Keep missing server counts distinct from zero. Show archived copies in export/recovery. Retry, when requested, uses the original UUID and request; scope/state guards remain unchanged.
- Use a recovery panel that does not require native dialog.showModal support on older handheld browsers.

## Validation

- 177 automated tests passed, including retained quantities, rejected retries, actor isolation, assignment changes, active-generation protection and limiting failed network sends.
- Isolated browser + PGlite: real count form, explicit zero, reassignment conflict after reconnect, read-only comparison, recovery export, retry rejection without overwrite, six offline locations with three empty locations, ten counts/audits/receipts and no browser errors.
- Volume test: 600 prepared jobs and 600 offline operations at 6x CPU throttling; all 600 retained after reopening IndexedDB and all acknowledged exactly once by a synthetic receiver. Enqueueing the entire batch took 27.694 s; 50 scoped reads plus one failed sync pass took 1.332 s; the full synthetic reconnect pass took 66.503 s. Maximum measured 20 ms heartbeat interval was 528 ms; sampled JS heap was 22 MB. This is not a warehouse-network throughput benchmark or a physical handheld certification.

No SQL migration or production data writes are part of V2.85. Existing IndexedDB names, receipt IDs, request formats and server conflict protections remain compatible. Actual incident recovery remains pending the affected device's export; do not clear its site data.
