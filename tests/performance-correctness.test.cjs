'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { syntaxCheck, productionContext, deferred } = require('./production-harness.cjs');

const arrays = ['assignments', 'snapshots', 'counts', 'approvals', 'audit', 'details', 'jobs', 'job_items',
  'found', 'paper', 'items', 'locations', 'profiles', 'remarks', 'master', 'settings'];
const validationFunctions = ['dashboardReadErrorV252', 'validateDashboardRulesV252',
  'managementErrorV263', 'validateManagementBundleV263'];
const readFunctions = [...validationFunctions, 'managementCacheKeyV263', 'mergeManagementBundleV263',
  'cloneManagementBundleV263', 'isStatementTimeoutErrorV264', 'loadManagementBundleV263'];

function managementPayload(overrides = {}) {
  return {
    schema_version: 1, actor_id: 'user-a', session_id: 'session-a', tab: 'summary',
    revision: 10, catalog_revision: 4, unchanged: false, delta: false, location_ids: [],
    rules: { max_rounds: 3, repeat_match_action: 'recount' },
    generated_at: '2026-09-15T08:00:00Z',
    ...Object.fromEntries(arrays.map(key => [key, []])),
    row_counts: Object.fromEntries(arrays.map(key => [key, 0])),
    ...overrides,
  };
}

function unchangedPayload(overrides = {}) {
  return { schema_version: 1, actor_id: 'user-a', session_id: 'session-a', tab: 'summary',
    revision: 10, catalog_revision: 4, unchanged: true, generated_at: '2026-09-15T08:01:00Z', ...overrides };
}

function context(names = readFunctions, overrides = {}) {
  return productionContext(names, {
    APP_BUILD_ID: 'test-build', me: { id: 'user-a' }, prof: { role: 'admin' },
    S: { page: 'sv-dash', _dashTab: 'summary', _dashSid: 'session-a' },
    selectedDateFrom: '2026-09-15', selectedDateTo: '2026-09-15',
    _dashTab: 'summary', _activePageRequestController: new AbortController(),
    _managementRpcMissingV263: false, _managementRawCacheV263: new Map(),
    _managementMetricsV263: [], MANAGEMENT_ARRAYS_V263: arrays,
    updateDashboardTimeoutLoadingV264() {},
    sb: { rpc: async () => ({ data: managementPayload(), error: null }) },
    ...overrides,
  });
}

const isCode = code => error => error?.code === code;
const isAbort = error => error?.name === 'AbortError';

test('all production inline scripts compile without executing app initialization', () => {
  const scripts = syntaxCheck();
  assert.ok(scripts.length >= 2);
  assert.ok(scripts.some(script => script.characters > 1_000_000));
});

test('management full payload requires correct actor, session, tab and nonnegative safe revisions', () => {
  const ctx = context(validationFunctions);
  assert.equal(ctx.validateManagementBundleV263(managementPayload(), 'session-a', 'summary', 'user-a').revision, 10);
  for (const invalid of [{ actor_id: 'other' }, { session_id: 'other' }, { tab: 'team' },
    { revision: -1 }, { catalog_revision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => ctx.validateManagementBundleV263(managementPayload(invalid), 'session-a', 'summary', 'user-a'),
      isCode('MANAGEMENT_READ_INVALID'));
  }
});

test('management rejects incomplete arrays, row counts, duplicate IDs and out-of-scope rows', () => {
  const ctx = context(validationFunctions);
  for (const invalid of [
    { counts: null }, { row_counts: {} },
    { assignments: [{ id: 'x', session_id: 'session-a' }, { id: 'x', session_id: 'session-a' }],
      row_counts: { ...managementPayload().row_counts, assignments: 2 } },
    { assignments: [{ id: 'x', session_id: 'session-b' }],
      row_counts: { ...managementPayload().row_counts, assignments: 1 } },
  ]) {
    assert.throws(() => ctx.validateManagementBundleV263(managementPayload(invalid), 'session-a', 'summary', 'user-a'),
      isCode('MANAGEMENT_READ_INVALID'));
  }
});

test('unchanged response cannot authorize absent cache or a different revision', () => {
  const ctx = context(validationFunctions);
  for (const cached of [null, managementPayload({ revision: 9 }), managementPayload({ catalog_revision: 3 })]) {
    assert.throws(() => ctx.validateManagementBundleV263(unchangedPayload(), 'session-a', 'summary', 'user-a', cached),
      isCode('MANAGEMENT_READ_INVALID'));
  }
  assert.equal(ctx.validateManagementBundleV263(unchangedPayload(), 'session-a', 'summary', 'user-a', managementPayload()).unchanged, true);
});

test('full management read caches only validated data and returns an independent render clone', async () => {
  const raw = managementPayload({ items: [{ id: 'item-a', code: 'A' }], row_counts: { ...managementPayload().row_counts, items: 1 } });
  const ctx = context(readFunctions, { sb: { rpc: async () => ({ data: raw, error: null }) } });
  const result = await ctx.loadManagementBundleV263('session-a', 'summary');
  result.items[0].code = 'changed-by-render';
  assert.equal(raw.items[0].code, 'A');
  assert.equal(ctx._managementRawCacheV263.size, 1);
  assert.equal(ctx._managementMetricsV263.at(-1).outcome, 'full');
});

test('warm management read still contacts server and only reuses exact verified revision', async () => {
  const requests = [];
  const ctx = context(readFunctions, { sb: { rpc: async (name, params) => {
    requests.push({ name, params });
    return { data: requests.length === 1 ? managementPayload() : unchangedPayload(), error: null };
  } } });
  await ctx.loadManagementBundleV263('session-a', 'summary');
  const warm = await ctx.loadManagementBundleV263('session-a', 'summary', { metadataWhenUnchanged: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].params.p_since_revision, 10);
  assert.equal(requests[1].params.p_since_catalog, 4);
  assert.equal(warm._unchangedV263, true);
  assert.equal(ctx._managementMetricsV263.at(-1).outcome, 'unchanged');
});

test('database read errors and malformed payloads do not silently substitute cached data', async () => {
  const ctx = context();
  await ctx.loadManagementBundleV263('session-a', 'summary');
  const cached = ctx._managementRawCacheV263.values().next().value;
  ctx.sb.rpc = async () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
  await assert.rejects(ctx.loadManagementBundleV263('session-a', 'summary'), isCode('42501'));
  ctx.sb.rpc = async () => ({ data: managementPayload({ row_counts: {} }), error: null });
  await assert.rejects(ctx.loadManagementBundleV263('session-a', 'summary'), isCode('MANAGEMENT_READ_INVALID'));
  assert.equal(ctx._managementRawCacheV263.values().next().value, cached);
});

test('statement timeout permits complete fallback, not stale cache or persistent RPC disable', async () => {
  const ctx = context();
  await ctx.loadManagementBundleV263('session-a', 'summary');
  ctx.sb.rpc = async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } });
  assert.equal(await ctx.loadManagementBundleV263('session-a', 'summary'), null);
  assert.equal(ctx._managementRpcMissingV263, false);
  assert.equal(ctx._managementMetricsV263.at(-1).outcome, 'timeout-fallback');
});

test('missing RPC alone enables compatibility fallback until application reload', async () => {
  const ctx = context(readFunctions, { sb: { rpc: async () => ({ data: null,
    error: { code: 'PGRST202', message: 'get_management_read_bundle_v263 was not found' } }) } });
  assert.equal(await ctx.loadManagementBundleV263('session-a', 'summary'), null);
  assert.equal(ctx._managementRpcMissingV263, true);
});

test('navigation, aborted signal, user switch and role switch discard delayed management responses', async () => {
  for (const replace of [
    ctx => { ctx._activePageRequestController = new AbortController(); },
    ctx => ctx._activePageRequestController.abort(),
    ctx => { ctx.me = { id: 'user-b' }; },
    ctx => { ctx.prof = { role: 'supervisor' }; },
  ]) {
    const response = deferred();
    const ctx = context(readFunctions, { sb: { rpc: () => response.promise } });
    const pending = ctx.loadManagementBundleV263('session-a', 'summary');
    replace(ctx);
    response.resolve({ data: managementPayload(), error: null });
    await assert.rejects(pending, isAbort);
    assert.equal(ctx._managementRawCacheV263.size, 0);
  }
});

test('cache keys isolate build, actor, role, Session, tab and rendered date scope', () => {
  const ctx = context(['managementCacheKeyV263', 'dashboardViewCacheKey']);
  const originalRaw = ctx.managementCacheKeyV263('session-a', 'summary');
  const originalView = ctx.dashboardViewCacheKey('summary', 'session-a');
  for (const [field, value] of [['APP_BUILD_ID', 'different-build'], ['me', { id: 'user-b' }], ['prof', { role: 'supervisor' }]]) {
    const previous = ctx[field];
    ctx[field] = value;
    assert.notEqual(ctx.managementCacheKeyV263('session-a', 'summary'), originalRaw);
    assert.notEqual(ctx.dashboardViewCacheKey('summary', 'session-a'), originalView);
    ctx[field] = previous;
  }
  assert.notEqual(ctx.managementCacheKeyV263('session-b', 'summary'), originalRaw);
  assert.notEqual(ctx.managementCacheKeyV263('session-a', 'team'), originalRaw);
  ctx.selectedDateTo = '2026-09-16';
  assert.notEqual(ctx.dashboardViewCacheKey('summary', 'session-a'), originalView);
});

function verifiedPaintContext() {
  const paints = [];
  const ctx = context(['dashboardViewCacheKey', 'paintCachedDashboardView', 'paintVerifiedManagementCacheV263'], {
    _dashboardViewCacheStore: new Map(), _dashboardViewCache: null,
    paintDashboardView: (tab, cached) => { paints.push({ tab, cached }); return true; },
  });
  const cached = { userId: 'user-a', role: 'admin', sessionId: 'session-a',
    dateFrom: '2026-09-15', dateTo: '2026-09-15', _revisionV263: 10, _catalogRevisionV263: 4,
    loadedAt: 1, views: { summary: '<div>verified values</div>' } };
  ctx._dashboardViewCacheStore.set(ctx.dashboardViewCacheKey('summary', 'session-a'), cached);
  return { ctx, cached, paints };
}

test('dashboard cached HTML stays hidden until a fresh authorized unchanged response', () => {
  const { ctx, paints } = verifiedPaintContext();
  assert.equal(ctx.paintCachedDashboardView('summary'), false);
  assert.equal(paints.length, 0);
  assert.equal(ctx.paintVerifiedManagementCacheV263({ ...unchangedPayload(), _unchangedV263: true },
    'summary', 'session-a', '<option>fresh session</option>'), true);
  assert.equal(paints.length, 1);
  assert.ok(paints[0].cached.loadedAt > 1);
});

test('verified paint rejects changed/missing data, role/user/session/date and revision mismatches', () => {
  for (const mutate of [
    state => { state.bundle = null; },
    state => { state.bundle._unchangedV263 = false; },
    state => { state.cached.userId = 'user-b'; },
    state => { state.cached.role = 'supervisor'; },
    state => { state.cached.sessionId = 'session-b'; },
    state => { state.cached.dateFrom = '2026-09-14'; },
    state => { state.cached.dateTo = '2026-09-14'; },
    state => { state.cached._revisionV263 = 9; },
    state => { state.cached._catalogRevisionV263 = 3; },
    state => state.ctx._dashboardViewCacheStore.clear(),
  ]) {
    const state = { ...verifiedPaintContext(), bundle: { ...unchangedPayload(), _unchangedV263: true } };
    mutate(state);
    assert.equal(state.ctx.paintVerifiedManagementCacheV263(state.bundle, 'summary', 'session-a', ''), false);
    assert.equal(state.paints.length, 0);
  }
});

test('My Tasks active-load guard rejects stale menu, request, signal and serial', () => {
  const ctx = context(['myTasksAbortError', 'assertActiveMyTasksLoad'], {
    S: { page: 'c-tasks' }, _myTasksLoadSerial: 2,
  });
  const scope = ctx._activePageRequestController;
  assert.doesNotThrow(() => ctx.assertActiveMyTasksLoad(scope, 2));
  assert.throws(() => ctx.assertActiveMyTasksLoad(scope, 1), isAbort);
  assert.throws(() => ctx.assertActiveMyTasksLoad(new AbortController(), 2), isAbort);
  ctx.S.page = 'sv-dash';
  assert.throws(() => ctx.assertActiveMyTasksLoad(scope, 2), isAbort);
  ctx.S.page = 'c-tasks';
  scope.abort();
  assert.throws(() => ctx.assertActiveMyTasksLoad(scope, 2), isAbort);
});

function refreshContext(extra = {}) {
  const events = [];
  const ctx = context(['refreshDashboardData', 'openDashboardMenu', 'paintCachedDashboardView'], {
    _dashboardLoadInFlight: null, _dashboardViewCache: null, _navStack: [],
    SUPERVISOR_ALLOWED_DASHBOARD_TABS: new Set(['summary', 'team', 'tracker', 'layout', 'log']),
    deferNavigationDuringSaveV251: () => false,
    invalidateDashboardCache: tab => events.push(['invalidate', tab]),
    startPageLoadingVisual: () => { events.push(['loading']); return 7; },
    finishPageLoadingVisual: token => events.push(['finish', token]),
    failPageLoadingVisual: token => events.push(['fail', token]),
    renderPageLoadError: error => events.push(['error', error.message]),
    uiCopy: th => th, loadSvDash: async () => { events.push(['read']); },
    stopWarehouseLayoutLiveSync() {}, updateDashboardNavigationUi() {},
    dashboardLoadingHtml: () => '<div>loading</div>', cnt: () => ({ innerHTML: '' }),
    render: () => events.push(['render']),
    ...extra,
  });
  ctx.beginPageRequestScope = () => {
    ctx._activePageRequestController.abort();
    ctx._activePageRequestController = new AbortController();
    events.push(['new-scope']);
  };
  return { ctx, events };
}

async function flushMicrotasks() {
  await new Promise(resolve => setImmediate(resolve));
}

test('manual refresh invalidates its selected view and waits for a completed read', async () => {
  const response = deferred();
  const { ctx, events } = refreshContext({ loadSvDash: () => response.promise });
  const pending = ctx.refreshDashboardData();
  await flushMicrotasks();
  assert.deepEqual(events.filter(event => event[0] === 'invalidate'), [['invalidate', 'summary']]);
  assert.equal(events.some(event => event[0] === 'finish'), false);
  response.resolve();
  await pending;
  await flushMicrotasks();
  assert.equal(events.some(event => event[0] === 'finish'), true);
});

test('safe dashboard navigation preserves hidden revision-verifiable views only', async () => {
  for (const tab of ['summary', 'executive', 'team', 'log', 'tracker', 'layout', 'wms']) {
    const { ctx, events } = refreshContext({ S: { page: 'sv-dash', _dashTab: tab, _dashSid: 'session-a' } });
    await ctx.refreshDashboardData({ preserveVerifiedView: true });
    const invalidations = events.filter(event => event[0] === 'invalidate');
    assert.equal(invalidations.length, ['summary', 'executive', 'team', 'log'].includes(tab) ? 0 : 1, tab);
    assert.equal(events.filter(event => event[0] === 'read').length, 1, `${tab} still verifies fresh data`);
  }
});

test('changing dashboard tabs cancels pending scope without clearing unrelated hidden views', async () => {
  const { ctx, events } = refreshContext({ _dashboardLoadInFlight: Promise.resolve() });
  const oldScope = ctx._activePageRequestController;
  ctx.openDashboardMenu('team');
  await flushMicrotasks();
  assert.equal(oldScope.signal.aborted, true);
  assert.equal(ctx.S._dashTab, 'team');
  assert.equal(events.some(event => event[0] === 'invalidate'), false);
  assert.equal(events.filter(event => event[0] === 'read').length, 1);
});

test('cancelled dashboard refresh cannot paint stale success or error into the new menu', async () => {
  for (const failed of [false, true]) {
    const response = deferred();
    const { ctx, events } = refreshContext({ loadSvDash: () => response.promise });
    const pending = ctx.refreshDashboardData({ preserveVerifiedView: true });
    await flushMicrotasks();
    ctx.beginPageRequestScope();
    ctx.S._dashTab = 'team';
    const observed = pending.catch(() => undefined);
    if (failed) response.reject(Object.assign(new Error('old request cancelled'), { name: 'AbortError' }));
    else response.resolve();
    await observed;
    await flushMicrotasks();
    assert.equal(events.some(event => ['finish', 'fail', 'error'].includes(event[0])), false);
  }
});

test('dashboard read does not start after queued navigation or user/role replacement', async () => {
  for (const change of [
    ctx => { ctx.S.page = 'c-tasks'; },
    ctx => { ctx.S._dashTab = 'team'; },
    ctx => { ctx.me = { id: 'user-b' }; },
    ctx => { ctx.prof = { role: 'supervisor' }; },
  ]) {
    const { ctx, events } = refreshContext();
    const pending = ctx.refreshDashboardData({ preserveVerifiedView: true });
    change(ctx);
    await pending;
    await flushMicrotasks();
    assert.equal(events.some(event => ['read', 'finish', 'error'].includes(event[0])), false);
  }
});

test('current dashboard read failure remains visible instead of reporting successful readiness', async () => {
  const { ctx, events } = refreshContext({ loadSvDash: async () => { throw new Error('read failed'); } });
  await assert.rejects(ctx.refreshDashboardData({ preserveVerifiedView: true }), /read failed/);
  await flushMicrotasks();
  assert.equal(events.filter(event => event[0] === 'error').length, 1);
  assert.equal(events.some(event => event[0] === 'finish'), false);
});

test('deferred navigation retains the verification-preservation option', async () => {
  let resume;
  const { ctx, events } = refreshContext({ deferNavigationDuringSaveV251: fn => { resume = fn; return true; } });
  assert.equal(ctx.refreshDashboardData({ preserveVerifiedView: true }), undefined);
  assert.equal(events.length, 0);
  ctx.deferNavigationDuringSaveV251 = () => false;
  await resume();
  await flushMicrotasks();
  assert.equal(events.some(event => event[0] === 'invalidate'), false);
  assert.equal(events.filter(event => event[0] === 'read').length, 1);
});

test('all six management dashboard datasets survive normal navigation without eviction', async () => {
  const ctx = context(readFunctions, { sb: { rpc: async (name, params) => ({
    data: managementPayload({ session_id: params.p_session_id, tab: params.p_tab }), error: null,
  }) } });
  for (const tab of ['summary', 'executive', 'team', 'log', 'tracker', 'layout']) {
    await ctx.loadManagementBundleV263('session-a', tab);
  }
  assert.equal(ctx._managementRawCacheV263.size, 6);
  for (const tab of ['summary', 'executive', 'team', 'log', 'tracker', 'layout']) {
    assert.equal(ctx._managementRawCacheV263.has(ctx.managementCacheKeyV263('session-a', tab)), true, tab);
  }
});

test('management LRU touches a successfully reverified metadata-only read and evicts least recently used', async () => {
  const ctx = context(readFunctions, { sb: { rpc: async (name, params) => ({
    data: params.p_since_revision === null
      ? managementPayload({ session_id: params.p_session_id })
      : unchangedPayload({ session_id: params.p_session_id }),
    error: null,
  }) } });
  for (let i = 0; i < 8; i++) await ctx.loadManagementBundleV263(`session-${i}`, 'summary');
  await ctx.loadManagementBundleV263('session-0', 'summary', { metadataWhenUnchanged: true });
  await ctx.loadManagementBundleV263('session-8', 'summary');
  assert.equal(ctx._managementRawCacheV263.size, 8);
  assert.equal(ctx._managementRawCacheV263.has(ctx.managementCacheKeyV263('session-0', 'summary')), true);
  assert.equal(ctx._managementRawCacheV263.has(ctx.managementCacheKeyV263('session-1', 'summary')), false);
  assert.equal(ctx._managementRawCacheV263.has(ctx.managementCacheKeyV263('session-8', 'summary')), true);
});

test('failed validation and cancelled revalidation do not move management LRU order', async () => {
  const ctx = context(readFunctions, { sb: { rpc: async (name, params) => ({
    data: managementPayload({ session_id: params.p_session_id }), error: null,
  }) } });
  await ctx.loadManagementBundleV263('session-a', 'summary');
  await ctx.loadManagementBundleV263('session-b', 'summary');
  const original = [...ctx._managementRawCacheV263.keys()];
  ctx.sb.rpc = async () => ({ data: unchangedPayload({ revision: 999 }), error: null });
  await assert.rejects(ctx.loadManagementBundleV263('session-a', 'summary'), isCode('MANAGEMENT_READ_INVALID'));
  assert.deepEqual([...ctx._managementRawCacheV263.keys()], original);
  const delayed = deferred();
  ctx.sb.rpc = () => delayed.promise;
  const pending = ctx.loadManagementBundleV263('session-a', 'summary');
  ctx._activePageRequestController = new AbortController();
  delayed.resolve({ data: unchangedPayload(), error: null });
  await assert.rejects(pending, isAbort);
  assert.deepEqual([...ctx._managementRawCacheV263.keys()], original);
});

test('location-only management read cannot replace the full Session cache', async () => {
  const ctx = context();
  await ctx.loadManagementBundleV263('session-a', 'summary');
  const key = ctx.managementCacheKeyV263('session-a', 'summary');
  const original = ctx._managementRawCacheV263.get(key);
  ctx.sb.rpc = async () => ({ data: managementPayload({ delta: true, location_ids: ['location-a'], revision: 11 }), error: null });
  const location = await ctx.loadManagementBundleV263('session-a', 'summary', { locationId: 'location-a' });
  assert.equal(location.revision, 11);
  assert.equal(ctx._managementRawCacheV263.get(key), original);
  assert.equal(ctx._managementRawCacheV263.get(key).revision, 10);
});

test('location delta replaces removed assignments and their dependent counts without losing other locations', () => {
  const ctx = context(['managementErrorV263', 'mergeManagementBundleV263']);
  const cached = managementPayload({
    assignments: [{ id: 'a', session_id: 'session-a', location_id: 'l1' }, { id: 'b', session_id: 'session-a', location_id: 'l2' }],
    snapshots: [{ id: 's1', location_id: 'l1' }, { id: 's2', location_id: 'l2' }],
    counts: [{ id: 'c1', assignment_id: 'a' }, { id: 'c2', assignment_id: 'b' }],
    approvals: [{ id: 'v1', assignment_id: 'a' }, { id: 'v2', assignment_id: 'b' }],
    items: [{ id: 'i1', code: 'old' }, { id: 'i2', code: 'keep' }],
  });
  const incoming = managementPayload({ delta: true, revision: 11, location_ids: ['l1'],
    snapshots: [{ id: 's3', location_id: 'l1' }], items: [{ id: 'i1', code: 'fresh' }] });
  const merged = ctx.mergeManagementBundleV263(cached, incoming);
  assert.deepEqual(Array.from(merged.assignments, row => row.id), ['b']);
  assert.deepEqual(Array.from(merged.counts, row => row.id), ['c2']);
  assert.deepEqual(Array.from(merged.approvals, row => row.id), ['v2']);
  assert.deepEqual(Array.from(merged.snapshots, row => row.id), ['s2', 's3']);
  assert.deepEqual(Array.from(merged.items, row => row.code), ['keep', 'fresh']);
  assert.equal(merged.row_counts.snapshots, 2);
  assert.equal(merged.delta, false);
  assert.equal(cached.assignments.length, 2);
  assert.equal(cached.items[0].code, 'old');
});

test('delta cannot merge across changed catalog or older Session revisions', () => {
  const ctx = context(validationFunctions);
  for (const change of [{ catalog_revision: 5 }, { revision: 10 }, { revision: 9 }]) {
    assert.throws(() => ctx.validateManagementBundleV263(managementPayload({ delta: true,
      location_ids: ['l1'], revision: 11, ...change }), 'session-a', 'summary', 'user-a', managementPayload()),
    isCode('MANAGEMENT_READ_INVALID'));
  }
});

test('page readiness is recorded only after the complete loader settles, never after a cancelled old load', async () => {
  for (const page of ['sv-dash', 'c-tasks']) {
    for (const cancelled of [false, true]) {
      const events = [];
      const ctx = context(['runPageLoaderWithTimeout'], {
        S: { page }, pageLoadTimeoutForCurrentRoute: () => 1000,
        markCurrentPageViewReady: () => events.push('ready'),
        finishPageLoadingVisual: () => events.push('finish'),
        failPageLoadingVisual: () => events.push('error'),
      });
      const response = deferred();
      const pending = ctx.runPageLoaderWithTimeout(() => response.promise, ctx._activePageRequestController);
      await flushMicrotasks();
      assert.deepEqual(events, []);
      if (cancelled) ctx._activePageRequestController = new AbortController();
      response.resolve({ complete: true });
      await pending;
      assert.deepEqual(events, cancelled ? [] : ['ready', 'finish']);
    }
  }
});
