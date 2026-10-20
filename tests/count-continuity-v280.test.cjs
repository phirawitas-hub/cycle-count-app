'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const {productionContext,extractFunction,deferred}=require('./production-harness.cjs');
function setup({jobs=[],operations=[],drafts=[],prepare=async()=>({assignmentId:'a',key:'u|a',generation:'g',tailId:null}),enqueue=async()=>({key:'op',request:{record:{photo_url:null}}})}={}) {
  let reads=0,writes=0,syncs=0;
  const box={list:async()=>({owner:'u',jobs,operations,drafts}),prepare:async(...a)=>{reads++;return prepare(...a)},enqueue:async(...a)=>{writes++;return enqueue(...a)},sync:async()=>{syncs++}};
  const c=productionContext(['countContinuityActiveV280','transientCountConnectionV280','obtainCountJobV280','prepareCountJobV281','enqueueNormalCountV280'],{
    me:{id:'u'},S:{page:'c-count'},navigator:{onLine:true},countOutboxV279:()=>box,
  },['_countContinuityV280','_countNormalDraftChainV280','_countNormalStorageErrorV280','_countPreparingV281']);
  c.job=jobs[0]||{key:'u|a',assignmentId:'a',generation:'g',tailId:null};
  vm.runInContext("_countContinuityV280={owner:'u',aid:'a',job,photos:{}}",c);
  return {c,box,stats:()=>({reads,writes,syncs})};
}
const job={key:'u|a',assignmentId:'a',generation:'g',tailId:null};
const record={assignment_id:'a',item_id:'i',round:1,count_qty:0,actual_counter_name:'Counter',type_issue:null,remark:null,photo_url:null};
test('normal entry prepares automatically; there is no manual offline launcher',async()=>{
  const {c,stats}=setup();await c.obtainCountJobV280('a');assert.equal(stats().reads,1);
  const source=extractFunction('updateCountOfflineLauncherV279').code;
  assert.doesNotMatch(source,/createElement\('button'\)|งานในเครื่อง \/ พื้นที่อับสัญญาณ/);
  assert.match(extractFunction('loadCCount').code,/loadCountEntryV280\(aid\)/);
});
test('only this device cached work remains usable with network down; unknown work fails closed',async()=>{
  const {c,stats}=setup({jobs:[job]});c.navigator.onLine=false;
  assert.equal((await c.obtainCountJobV280('a')).key,job.key);
  await assert.rejects(c.obtainCountJobV280('unknown'),/ยังไม่ได้รับข้อมูล/);assert.equal(stats().reads,0);
});
test('pending V2.79 jobs and unconfirmed drafts are never replaced by an automatic read',async()=>{
  for(const extra of [{operations:[{jobKey:job.key,state:'retry'}]},{drafts:[{jobKey:job.key,generation:'g',value:{qty:'0'}}]}]) {
    const {c,stats}=setup({jobs:[job],...extra});await c.obtainCountJobV280('a');assert.equal(stats().reads,0);
  }
});
test('network timeout may reuse the same cached job; authorization and malformed data never do',async()=>{
  for(const code of ['REQUEST_TIMEOUT','42501','COUNT_READ_INVALID','CC409']) {
    const {c}=setup({jobs:[job],prepare:async()=>{throw Object.assign(Error('failed'),{code})}});
    if(code==='REQUEST_TIMEOUT')assert.equal((await c.obtainCountJobV280('a')).key,job.key);
    else await assert.rejects(c.obtainCountJobV280('a'),e=>e.code===code);
  }
});
test('normal count persists before background sending and keeps original request id on repeated OK',async()=>{
  const gate=deferred();const {c,stats}=setup({jobs:[job],enqueue:()=>gate.promise});
  const pending=c.enqueueNormalCountV280(record);await new Promise(r=>setTimeout(r,5));assert.equal(stats().syncs,0);
  gate.resolve({key:'same-op',state:'pending',request:{record}});await pending;assert.equal(stats().syncs,1);
  const duplicate=setup({jobs:[job],operations:[{key:'same-op',generation:'g',state:'retry',request:{record}}]});
  assert.equal((await duplicate.c.enqueueNormalCountV280(record)).key,'same-op');assert.equal(duplicate.stats().writes,0);
  await assert.rejects(duplicate.c.enqueueNormalCountV280({...record,count_qty:1}),/ข้อมูลไม่ตรงกัน/);
});
test('a new account or unsupported workflow cannot enqueue through a previous normal form',async()=>{
  const {c,stats}=setup();c.me={id:'other'};
  await assert.rejects(c.enqueueNormalCountV280(record));assert.equal(stats().writes,0);
  c.me={id:'u'};vm.runInContext('_countContinuityV280.unsupported=true',c);assert.equal(c.countContinuityActiveV280('a'),false);
});
test('normal handlers intercept legacy writes and local workflow does not run count-start write',()=>{
  const save=extractFunction('saveCountItemFromKeypad').code;
  assert.ok(save.indexOf('saveNormalCountV280(input,record)')<save.indexOf("sb.from('count_records')"));
  assert.match(extractFunction('submitCount').code,/countContinuityActiveV280\(aid\).*submitNormalCountV280/);
  assert.match(extractFunction('loadCCount').code,/!countReadV261\._continuityV280 && asgn.status === 'pending'/);
  assert.match(extractFunction('resolveCountWorkflowAfterSave').code,/normalCountViewBundleV280\(aid\)/);
  assert.match(extractFunction('resolveCountWorkflowAfterSave').code,/ยังรอส่งขึ้นระบบ/);
});
test('quota error cannot be converted to queued success',async()=>{
  const {c,stats}=setup();vm.runInContext("_countNormalStorageErrorV280='quota exceeded'",c);
  await assert.rejects(c.enqueueNormalCountV280(record),/quota/);assert.equal(stats().writes,0);
});

test('normal form rejects a replaced generation before reusing an old operation',async()=>{
  const jobs=[{...job}];const {c,stats}=setup({jobs,operations:[{key:'old-op',generation:'g',state:'synced',request:{record}}]});
  jobs[0]={...job,generation:'refreshed'};
  await assert.rejects(c.enqueueNormalCountV280(record),/ชุดงานถูกโหลดใหม่/);
  assert.equal(stats().writes,0);
});
