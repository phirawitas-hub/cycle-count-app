# Performance and correctness regression tests

Run with Node.js 22 or newer; no package installation, login or database writes:

```powershell
node tests/production-harness.cjs
node --test tests/*.test.cjs
```

The harness compiles every inline application script, then extracts named
production function declarations directly from `index.html` and executes only
those functions in isolated VM contexts. Database responses, browser controls
and rendering boundaries are explicit test stubs; the implementation under test
is never copied into the tests.

These tests check cache authorization/isolation, complete payload validation,
read-failure handling and late-request cancellation. They are not a production
3–5 second SLA test. They do not model network latency, database load/RLS cost,
browser layout/paint, real data volume or concurrent users. Measure each actual
menu from click until fresh scoped data is ready on the user's device/network
before claiming a speed target, including cold navigation, repeat navigation
and return after a save.
