'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { productionContext, deferred } = require('./production-harness.cjs');

const arrays = ['assignments', 'annual_jobs', 'annual_items', 'counts', 'snapshots', 'session_rules', 'baselines'];
const helpers = ['dashboardReadErrorV252', 'validateDashboardRulesV252', 'myTasksAbortError',
  'myTasksCacheKeyV270', 'validateMyTasksBundleV270', 'loadMyTasksBundleV270'];
const validToken = 'a'.repeat(64);
const baselineAction = 'wms_count_baseline';
const isInvalid = error => ['MY_TASKS_READ_INVALID', 'DASHBOARD_DATA_INVALID'].includes(error?.code);
const isAbort = error => error?.name === 'AbortError';

function payload(overrides = {}) {
  const result = {
    schema_version: 1, actor_id: 'user-a', actor_role: 'counter', version_token: validToken,
    unchanged: false, generated_at: '2026-09-15T08:00:00Z',
    ...Object.fromEntries(arrays.map(key => [key, []])),
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'row_counts')) {
    result.row_counts = Object.fromEntries(arrays.map(key => [key, result[key]?.length ?? 0]));
  }
  return result;
}

function task(id = 'assignment-a', day = '2026-09-15') {
  return { id, assigned_to: 'user-a', session_id: 'session-a', location_id: `location-${id}`,
    assigned_at: `${day}T03:00:00Z`, created_at: `${day}T03:00:00Z`, status: 'pending',
    locations: { code: id, zone: 'Longspan E' }, count_sessions: { name: 'Session', status: 'active' } };
}

function taskPayload(overrides = {}) {
  return payload({
    assignments: [task()],
    session_rules: [{ id: 'session-a', max_rounds: 3, repeat_match_action: 'recount' }],
    snapshots: [{ session_id: 'session-a', location_id: 'location-assignment-a', item_id: 'item-a',
      onhand_qty: 20, items: { code: 'A' } }],
    counts: [{ assignment_id: 'assignment-a', item_id: 'item-a', round: 1, count_qty: 20 }],
    baselines: [{ id: 'baseline-a', assignment_id: 'assignment-a', item_id: 'item-a', action: baselineAction }],
    ...overrides,
  });
}

function unchanged(overrides = {}) {
  return { schema_version: 1, actor_id: 'user-a', actor_role: 'counter', version_token: validToken,
    unchanged: true, generated_at: '2026-09-15T08:01:00Z', ...overrides };
}

function context(extra = {}, functions = helpers, declarations = []) {
  return productionContext(functions, {
    APP_BUILD_ID: 'test-build', me: { id: 'user-a' }, prof: { role: 'counter' },
    S: { page: 'c-tasks' }, _dashTab: 'summary', _activePageRequestController: new AbortController(),
    _myTasksRawCacheV270: null, _myTasksRpcMissingV270: false,
    _myTasksReadMetricsV270: [], _menuLoadMetricsV270: [],
    MY_TASK_ARRAYS_V270: arrays, WMS_COUNT_BASELINE_ACTION: baselineAction,
    sb: { rpc: async () => ({ data: payload(), error: null }) },
    ...extra,
  }, declarations);
}

test('My Tasks full and empty payloads require exact actor, role, schema and a valid opaque token', () => {
  const ctx = context();
  assert.equal(ctx.validateMyTasksBundleV270(payload(), 'user-a', 'counter').unchanged, false);
  assert.equal(ctx.validateMyTasksBundleV270(taskPayload(), 'user-a', 'counter').assignments.length, 1);
  for (const invalid of [{ schema_version: 2 }, { actor_id: 'user-b' }, { actor_role: 'admin' },
    { version_token: '' }, { version_token: 'a'.repeat(63) }, { version_token: 'g'.repeat(64) }, { unchanged: null }]) {
    assert.throws(() => ctx.validateMyTasksBundleV270(payload(invalid), 'user-a', 'counter'), isInvalid);
  }
});

test('My Tasks rejects missing arrays, wrong totals, duplicate tasks and incomplete relations', () => {
  const ctx = context();
  for (const invalid of [
    { assignments: null }, { baselines: undefined }, { row_counts: {} },
    { assignments: [task(), task()] },
    { assignments: [{ ...task(), locations: null }] },
    { assignments: [{ ...task(), count_sessions: null }] },
    { assignments: [{ ...task(), session_id: 'session-b' }] },
    { session_rules: [] },
  ]) assert.throws(() => ctx.validateMyTasksBundleV270(taskPayload(invalid), 'user-a', 'counter'), isInvalid);
  const missingDate = task();
  delete missingDate.created_at;
  assert.throws(() => ctx.validateMyTasksBundleV270(taskPayload({ assignments: [missingDate] }), 'user-a', 'counter'), isInvalid);
});

test('My Tasks rejects out-of-scope/duplicate counts, snapshots, annual details and baselines', () => {
  const ctx = context();
  const good = taskPayload();
  for (const invalid of [
    { counts: [...good.counts, ...good.counts] },
    { counts: [{ ...good.counts[0], assignment_id: 'other' }] },
    { counts: [{ ...good.counts[0], count_qty: null }] },
    { counts: [{ ...good.counts[0], round: 4 }] },
    { snapshots: [...good.snapshots, ...good.snapshots] },
    { snapshots: [{ ...good.snapshots[0], session_id: 'other' }] },
    { snapshots: [{ ...good.snapshots[0], onhand_qty: 'not-a-number' }] },
    { annual_items: [{ id: 'orphan', job_id: 'missing' }] },
    { baselines: [{ ...good.baselines[0], assignment_id: 'other' }] },
    { baselines: [{ ...good.baselines[0], action: 'other' }] },
  ]) assert.throws(() => ctx.validateMyTasksBundleV270(taskPayload(invalid), 'user-a', 'counter'), isInvalid);
});

test('unchanged task token cannot authorize absent, foreign, malformed or mismatched cached data', () => {
  const ctx = context();
  for (const cached of [null, payload({ version_token: 'b'.repeat(64) }),
    payload({ actor_id: 'user-b' }), payload({ actor_role: 'admin' }), payload({ row_counts: {} }), unchanged()]) {
    assert.throws(() => ctx.validateMyTasksBundleV270(unchanged(), 'user-a', 'counter', cached), isInvalid);
  }
  assert.equal(ctx.validateMyTasksBundleV270(unchanged(), 'user-a', 'counter', taskPayload()).unchanged, true);
});

test('cold and warm task reads both verify with server; warm request sends only cached token', async () => {
  const calls = [];
  const ctx = context({ sb: { rpc: async (name, params) => {
    calls.push({ name, params });
    return { data: calls.length === 1 ? taskPayload() : unchanged(), error: null };
  } } });
  const first = await ctx.loadMyTasksBundleV270();
  const second = await ctx.loadMyTasksBundleV270();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'get_my_tasks_read_bundle_v270');
  assert.equal(calls[0].params.p_known_token, null);
  assert.equal(calls[1].params.p_known_token, validToken);
  assert.equal(Object.keys(calls[1].params).length, 1);
  assert.equal(first._verifiedV270, true);
  assert.equal(second._verifiedV270, true);
  assert.equal(second.assignments[0].id, 'assignment-a');
  assert.equal(second.generated_at, unchanged().generated_at);
  assert.equal(ctx._myTasksReadMetricsV270.at(-1).outcome, 'unchanged');
});

test('task render clone cannot mutate raw cache, including nested relations and baseline-derived OH', async () => {
  const ctx = context({ sb: { rpc: async () => ({ data: taskPayload(), error: null }) } });
  const first = await ctx.loadMyTasksBundleV270();
  first.assignments[0].locations.code = 'mutated';
  first.snapshots[0].onhand_qty = 999;
  first.snapshots[0].items.code = 'mutated-item';
  ctx.sb.rpc = async () => ({ data: unchanged(), error: null });
  const second = await ctx.loadMyTasksBundleV270();
  assert.equal(second.assignments[0].locations.code, 'assignment-a');
  assert.equal(second.snapshots[0].onhand_qty, 20);
  assert.equal(second.snapshots[0].items.code, 'A');
});

test('denial, timeout, transport error and malformed task response never return old cache or fall back', async () => {
  const ctx = context();
  await ctx.loadMyTasksBundleV270();
  const cached = ctx._myTasksRawCacheV270;
  for (const error of [{ code: '42501', message: 'denied' }, { code: '57014', message: 'timeout' },
    { code: 'FETCH_ERROR', message: 'network unavailable' }]) {
    ctx.sb.rpc = async () => ({ data: null, error });
    await assert.rejects(ctx.loadMyTasksBundleV270(), err => err.code === error.code);
    assert.equal(ctx._myTasksRpcMissingV270, false);
    assert.equal(ctx._myTasksRawCacheV270, cached);
  }
  ctx.sb.rpc = async () => ({ data: payload({ row_counts: {} }), error: null });
  await assert.rejects(ctx.loadMyTasksBundleV270(), isInvalid);
  assert.equal(ctx._myTasksRawCacheV270, cached);
});

test('only absence of the exact task RPC enables compatibility fallback', async () => {
  for (const code of ['PGRST202', '42883']) {
    const ctx = context({ sb: { rpc: async () => ({ data: null,
      error: { code, message: 'get_my_tasks_read_bundle_v270 does not exist' } }) } });
    assert.equal(await ctx.loadMyTasksBundleV270(), null);
    assert.equal(ctx._myTasksRpcMissingV270, true);
  }
  const ctx = context({ sb: { rpc: async () => ({ data: null,
    error: { code: '42883', message: 'another_helper does not exist' } }) } });
  await assert.rejects(ctx.loadMyTasksBundleV270(), error => error.code === '42883');
  assert.equal(ctx._myTasksRpcMissingV270, false);
});

test('task cache key separates application build, user and current role', async () => {
  for (const [property, replacement] of [['APP_BUILD_ID', 'other-build'], ['me', { id: 'user-b' }], ['prof', { role: 'admin' }]]) {
    const ctx = context();
    await ctx.loadMyTasksBundleV270();
    const oldKey = ctx.myTasksCacheKeyV270();
    ctx[property] = replacement;
    assert.notEqual(ctx.myTasksCacheKeyV270(), oldKey);
    let sentToken;
    ctx.sb.rpc = async (name, params) => {
      sentToken = params.p_known_token;
      return { data: payload({ actor_id: ctx.me.id, actor_role: ctx.prof.role }), error: null };
    };
    await ctx.loadMyTasksBundleV270();
    assert.equal(sentToken, null);
    assert.equal(ctx._myTasksRawCacheV270.key, ctx.myTasksCacheKeyV270());
  }
});

test('malformed cached tasks are discarded before sending a token and cannot satisfy unchanged response', async () => {
  const ctx = context();
  ctx._myTasksRawCacheV270 = { key: ctx.myTasksCacheKeyV270(), payload: payload({ row_counts: {} }) };
  let sentToken;
  ctx.sb.rpc = async (name, params) => { sentToken = params.p_known_token; return { data: unchanged(), error: null }; };
  await assert.rejects(ctx.loadMyTasksBundleV270(), isInvalid);
  assert.equal(sentToken, null);
  assert.equal(ctx._myTasksRawCacheV270, null);
});

test('late task responses are discarded after navigation, cancellation, actor or role switch', async () => {
  for (const change of [
    ctx => { ctx.S.page = 'sv-dash'; },
    ctx => { ctx._activePageRequestController = new AbortController(); },
    ctx => ctx._activePageRequestController.abort(),
    ctx => { ctx.me = { id: 'user-b' }; },
    ctx => { ctx.prof = { role: 'admin' }; },
  ]) {
    const response = deferred();
    const ctx = context({ sb: { rpc: () => response.promise } });
    const pending = ctx.loadMyTasksBundleV270();
    change(ctx);
    response.resolve({ data: taskPayload(), error: null });
    await assert.rejects(pending, isAbort);
    assert.equal(ctx._myTasksRawCacheV270, null);
  }
});

test('task reads attach the current navigation abort signal to the Supabase request', async () => {
  let signal;
  const ctx = context({ sb: { rpc: () => ({
    abortSignal(value) { signal = value; return this; },
    then(resolve, reject) { return Promise.resolve({ data: payload(), error: null }).then(resolve, reject); },
  }) } });
  await ctx.loadMyTasksBundleV270();
  assert.equal(signal, ctx._activePageRequestController.signal);
});

test('old My Tasks HTML cannot be restored before fresh server verification', () => {
  const ctx = context({ selectedDateFrom: '', selectedDateTo: '' },
    ['pageViewCacheDescriptor'], ['PAGE_VIEW_CACHE_TTL_MS']);
  assert.equal(ctx.pageViewCacheDescriptor({ page: 'c-tasks' }), null);
  assert.equal(ctx.pageViewCacheDescriptor({ page: 'sv-list' }).routeKey, 'sv-list');
});

test('menu metric includes the complete loader duration and distinguishes deferred, failed and aborted', async () => {
  let now = 0;
  const ctx = context({ performance: { now: () => now } }, ['measureMenuLoadV270']);
  const response = deferred();
  const pending = ctx.measureMenuLoadV270('my-tasks', () => response.promise);
  now = 4300;
  assert.equal(ctx._menuLoadMetricsV270.length, 0);
  response.resolve();
  await pending;
  assert.equal(ctx._menuLoadMetricsV270[0].elapsed_ms, 4300);
  assert.equal(ctx._menuLoadMetricsV270[0].outcome, 'finished');
  await ctx.measureMenuLoadV270('overview', async () => ({ deferred: true }));
  assert.equal(ctx._menuLoadMetricsV270.at(-1).outcome, 'deferred');
  for (const [name, outcome] of [['Error', 'error'], ['AbortError', 'aborted']]) {
    await assert.rejects(ctx.measureMenuLoadV270('my-tasks', async () => { throw Object.assign(new Error('failed'), { name }); }));
    assert.equal(ctx._menuLoadMetricsV270.at(-1).outcome, outcome);
  }
  for (let index = 0; index < 110; index++) await ctx.measureMenuLoadV270('my-tasks', async () => undefined);
  assert.equal(ctx._menuLoadMetricsV270.length, 100);
  assert.deepEqual(Object.keys(ctx._menuLoadMetricsV270[0]).sort(), ['at', 'elapsed_ms', 'menu', 'outcome', 'tab']);
});

const coreFunctions = [...helpers, 'measureMenuLoadV270', 'loadCTasks', 'loadCTasksCoreV270',
  'assertActiveMyTasksLoad', 'isAbortLikeError', 'annualAssignmentKey',
  'currentMyTaskDateMode', 'currentMyTaskDateValue', 'myTaskWorkDate', 'myTaskMatchesDate',
  'assignedCountWorkProgressV217'];

function coreContext(extra = {}) {
  const dom = { innerHTML: 'loading' };
  let currentDay = '2026-09-15';
  const forbidden = () => { throw new Error('Unexpected redundant network request'); };
  const ctx = context({
    _myTasksLoadSerial: 0, MY_TASK_FILTER_FIELDS: [], MY_TASK_DATE_MODES: new Set(['today', 'date', 'all']),
    cnt: () => dom, errBox: message => `error:${message}`,
    // Only the clock boundary is stubbed. Date-mode selection and filtering
    // below execute the actual production functions, including every reload.
    bangkokDateKey: value => value === undefined ? currentDay : String(value).slice(0, 10),
    fetchPagedSupabaseRows: forbidden, fetchSupabaseRowsByValues: forbidden,
    fetchSnapshotsForAssignmentScopes: forbidden, measureMyTasksReadV252: forbidden,
    applyWmsCountBaselines() {},
    deriveAssignmentWorkflowStatus: (rows, counts, rules, status) => ({ effectiveStatus: status }),
    assignmentPhysicalCountFinished: row => ['completed', 'approved'].includes(row.status),
    assignmentPendingVarianceReview: () => false, assignmentNeedsAnotherCount: () => false,
    readMyTaskFilters: () => ({}), normalizeMultiFilterValues: value => value || [],
    continueToNextMyTaskAfterCount: async () => false,
    multiFilterFieldHtml: () => '', myTaskLevelSortControlHtml: () => '', locationSortControlHtml: () => '',
    myTaskDateFilterHtml: () => '', hardwareLaserCaptureHtml: () => '', uiCopy: th => th,
    refreshMyTaskFilters() {}, activateHardwareLaserScanner() {},
    ...extra,
  }, coreFunctions);
  return { ctx, dom, setDay: day => { currentDay = day; } };
}

test('complete My Tasks loader uses one verified RPC and bundled baseline data without fan-out', async () => {
  let calls = 0;
  let baselinesUsed;
  const { ctx, dom } = coreContext({
    sb: { rpc: async () => { calls++; return { data: taskPayload(), error: null }; } },
    applyWmsCountBaselines: (rows, assignments, baselines) => { baselinesUsed = baselines; },
  });
  await ctx.loadCTasks();
  assert.equal(calls, 1);
  assert.equal(baselinesUsed[0].id, 'baseline-a');
  assert.equal(ctx._myTasks.length, 1);
  assert.equal(ctx._countAssignedWorkProgressV217.total, 1);
  assert.match(dom.innerHTML, /my-task-progress-card/);
  assert.equal(ctx._menuLoadMetricsV270.at(-1).outcome, 'finished');
});

test('complete My Tasks loader re-filters an unchanged raw bundle after midnight and date changes', async () => {
  const raw = taskPayload({ assignments: [task('yesterday', '2026-09-15'), task('today', '2026-09-16')],
    snapshots: [], counts: [], baselines: [] });
  let calls = 0;
  const { ctx, setDay } = coreContext({ sb: { rpc: async () => ({ data: ++calls === 1 ? raw : unchanged(), error: null }) } });
  await ctx.loadCTasks();
  assert.deepEqual(Array.from(ctx._myTasks, row => row.id), ['yesterday']);
  setDay('2026-09-16');
  await ctx.loadCTasks();
  assert.deepEqual(Array.from(ctx._myTasks, row => row.id), ['today']);
  ctx.S._mtDateMode = 'all';
  await ctx.loadCTasks();
  assert.deepEqual(Array.from(ctx._myTasks, row => row.id), ['yesterday', 'today']);
  ctx.S._mtDateMode = 'date';
  ctx.S._mtDateValue = '2026-09-15';
  await ctx.loadCTasks();
  assert.deepEqual(Array.from(ctx._myTasks, row => row.id), ['yesterday']);
  assert.equal(calls, 4);
});

test('verified empty My Tasks workspace does not trigger redundant legacy emptiness reads', async () => {
  const { ctx, dom } = coreContext();
  ctx._myTasks = [{id:'old-job'}];
  ctx._myTasksAllDates = [{id:'old-job'}];
  ctx._myAnnualJobs = [{id:'old-annual'}];
  ctx._myAnnualJobsAllDates = [{id:'old-annual'}];
  ctx._myAnnualJobItems = [{id:'old-item'}];
  await ctx.loadCTasks();
  assert.match(dom.innerHTML, /ยังไม่มีงานที่ได้รับมอบหมาย/);
  for (const key of ['_myTasks','_myTasksAllDates','_myAnnualJobs','_myAnnualJobsAllDates','_myAnnualJobItems']) {
    assert.equal(ctx[key].length,0,'removed work must not remain available to scanner/navigation');
  }
});

test('changed server token replaces old task rows and is sent on the next verification', async () => {
  const requests = [];
  let calls = 0;
  const updated = taskPayload({version_token:'b'.repeat(64),assignments:[task('new-job','2026-09-15')],counts:[],snapshots:[],baselines:[]});
  const {ctx} = coreContext({sb:{rpc:async (_name,args) => {
    requests.push(args);
    calls++;
    return {data:calls === 1 ? taskPayload() : calls === 2 ? updated : unchanged({version_token:'b'.repeat(64)}),error:null};
  }}});
  await ctx.loadCTasks();
  await ctx.loadCTasks();
  assert.deepEqual(Array.from(ctx._myTasks,row=>row.id),['new-job']);
  await ctx.loadCTasks();
  assert.equal(requests[2].p_known_token,'b'.repeat(64));
});

test('complete My Tasks loader cannot paint denied or delayed old response over a new page', async () => {
  const delayed = deferred();
  const { ctx, dom } = coreContext({ sb: { rpc: () => delayed.promise } });
  const pending = ctx.loadCTasks();
  ctx.S.page = 'sv-dash';
  delayed.resolve({ data: taskPayload(), error: null });
  await assert.rejects(pending, isAbort);
  assert.equal(dom.innerHTML, 'loading');
  ctx.S.page = 'c-tasks';
  ctx.sb.rpc = async () => ({ data: null, error: { code: '42501', message: 'denied' } });
  await assert.rejects(ctx.loadCTasks(), error => error.code === '42501');
  assert.equal(dom.innerHTML, 'loading');
});
