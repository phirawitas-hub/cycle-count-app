'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {productionContext,extractFunction,deferred}=require('./production-harness.cjs');
function setup(){
  const calls=[],routes=[],jobs=[];let active=0,maxActive=0;
  const c=productionContext(['prefetchNormalCountV280','countTaskTargetsV281','prepareCountJobV281','openNextPreparedCountV281','readyCountJobsV281','transientCountConnectionV280'],{
    me:{id:'u'},S:{page:'c-tasks'},navigator:{onLine:true},_activePageRequestController:{},
    _myTasks:Array.from({length:7},(_,i)=>({id:String(i),status:'pending'})),
    buildNextCountNavigationRequest:(id)=>({assignmentId:id,filters:{zone:'A'},sortDirection:'desc',levelFirst:true}),
    myTaskNavigationFilterSnapshot:()=>({zone:'A'}),
    orderedCycleCountNavigationTargets:(filters,direction,level)=>{assert.equal(filters.zone,'A');assert.equal(direction,'desc');assert.equal(level,true);return c._myTasks.map(row=>({assignmentId:row.id,canOpen:row.status==='pending'}));},
    refreshCountOfflineStatusV279:async()=>{},
    obtainCountJobV280:async(id)=>{calls.push(id);active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,2));active--;},
    countOutboxV279:()=>({list:async()=>({owner:'u',jobs,operations:[]}),prepare:async id=>({id})}),
    countOfflineViewV279:(job)=>job.view,
    go:(page,extra)=>routes.push({page,...extra})
  },['_countPrefetchV280','_myTasksOwnerV281','_countPrefetchPlanV281','_countPreparingV281']);
  vm.runInContext("_myTasksOwnerV281='u'",c);
  return {c,calls,routes,jobs,maxActive:()=>maxActive};
}
function readyJob(id,extra={}) {return {owner:'u',assignmentId:id,envelope:{actor_id:'u'},view:{items:[{nextRound:1}],pending:[]},...extra};}
test('compact assigned rows without assigned_to prepare all seven route locations, at most two concurrently',async()=>{
  const s=setup();await s.c.prefetchNormalCountV280('');assert.deepEqual(s.calls,['0','1','2','3','4','5','6']);assert.equal(s.maxActive(),2);
});
test('prefetch starts immediately after current location in navigation order and excludes completed work',async()=>{
  const s=setup();s.c.S.page='c-count';s.c._myTasks[4].status='completed';await s.c.prefetchNormalCountV280('2');
  assert.deepEqual(s.calls,['3','5','6','0','1']);
});
test('no downloads from another account list and background work stops on account switch',async()=>{
  const s=setup();s.c.me={id:'other'};await s.c.prefetchNormalCountV280('');assert.equal(s.calls.length,0);
  s.c.me={id:'u'};s.c.obtainCountJobV280=async id=>{s.calls.push(id);s.c.me={id:'other'}};await s.c.prefetchNormalCountV280('');assert.ok(s.calls.length<=2);
});
test('a network interruption stops further preparation; a later pass resumes',async()=>{
  const s=setup();s.c.obtainCountJobV280=async id=>{s.calls.push(id);throw Object.assign(Error('offline'),{code:'REQUEST_TIMEOUT'})};
  await s.c.prefetchNormalCountV280('');assert.equal(s.calls.length,2);
  s.c.obtainCountJobV280=async id=>s.calls.push(id);await s.c.prefetchNormalCountV280('');assert.equal(s.calls.length,9);
});
test('an empty route does not leave prefetch permanently locked',async()=>{
  const s=setup();s.c._myTasks=[];await s.c.prefetchNormalCountV280('');assert.equal(vm.runInContext('_countPrefetchV280',s.c),false);
  s.c._myTasks=[{id:'new',status:'pending'}];await s.c.prefetchNormalCountV280('');assert.deepEqual(s.calls,['new']);
});
test('offline navigation updates remaining readiness without making any network reads',async()=>{
  const s=setup();s.c.navigator.onLine=false;s.c.S.page='c-count';s.c._myTasks[0].status='completed';
  await s.c.prefetchNormalCountV280('1');assert.equal(s.calls.length,0);
  assert.equal(vm.runInContext('_countPrefetchPlanV281.targets.length',s.c),5);
  assert.equal(vm.runInContext('_countPrefetchPlanV281.loading',s.c),false);
});
test('foreground open shares an in-flight preparation with prefetch',async()=>{
  const s=setup(),gate=deferred();let calls=0;s.c.countOutboxV279=()=>({prepare:()=>{calls++;return gate.promise}});
  const one=s.c.prepareCountJobV281('1'),two=s.c.prepareCountJobV281('1');assert.equal(one,two);gate.resolve({id:'1'});await two;assert.equal(calls,1);
});
test('offline continuation opens the next ready location and not an unprepared form',async()=>{
  const s=setup();s.c.navigator.onLine=false;s.jobs.push(readyJob('1'));assert.equal(await s.c.openNextPreparedCountV281({assignmentId:'0'}),true);
  assert.equal(s.routes[0].aid,'1');assert.equal(s.routes[0]._preparedCountV281,'1');
});
test('unprepared next work falls through to another ready location; no ready work shows an honest cached list',async()=>{
  const s=setup();s.c.navigator.onLine=false;s.jobs.push(readyJob('3'));await s.c.openNextPreparedCountV281({assignmentId:'0'});assert.equal(s.routes[0].aid,'3');
  s.jobs.length=0;await s.c.openNextPreparedCountV281({assignmentId:'0'});assert.equal(s.routes[1].page,'c-tasks');assert.equal(s.routes[1]._countCachedListV281,true);
});
test('reviewed, completed, malformed and other-actor jobs are never offered as ready',()=>{
  const s=setup();const jobs=[readyJob('ok'),readyJob('review',{view:{items:[{nextRound:1}],pending:[{state:'review'}]}}),readyJob('done',{view:{items:[{nextRound:null}],pending:[]}}),readyJob('bad',{view:null}),readyJob('other',{owner:'other'}),readyJob('archived',{reviewArchived:true})];
  assert.deepEqual([...s.c.readyCountJobsV281({owner:'u',jobs,operations:[]}).keys()],['ok']);
});
test('production list and next-navigation are wired to readiness, not assigned_to on compact rows',()=>{
  assert.match(extractFunction('renderMyTasks').code,/prefetchNormalCountV280/);
  assert.match(extractFunction('loadCTasksCoreV270').code,/_myTasksOwnerV281=me.id/);
  assert.match(extractFunction('openNextCountFromCachedTasks').code,/openNextPreparedCountV281/);
  assert.match(extractFunction('loadCTasks').code,/renderPreparedTaskListV281/);
  assert.doesNotMatch(extractFunction('prefetchNormalCountV280').code,/assigned_to|slice\(0,3\)/);
});
