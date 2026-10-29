'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {productionContext}=require('./production-harness.cjs');
function setup(qty='2') {
  const messages=[],inputs={q_empty:{value:qty,dataset:{itemId:'empty'}},empty_location_empty:{value:'A01'},empty_item_empty:{value:'SKU1'},empty_lpn_empty:{value:'LPN1'}};
  let normal=0,drafts=0,legacy=0;
  const c=productionContext(['submitCount','countContinuityActiveV280','normalCountDraftValueV280'],{
    me:{id:'u'},S:{page:'c-count'},navigator:{onLine:false},Q:id=>inputs[id],
    _emptyCountItemIds:new Set(['empty']),_selectedCounters:new Set(['Counter']),
    _countContinuityV280:{owner:'u',aid:'a',job:{key:'u|a'},unsupported:false,photos:{}},
    _countNormalDraftChainV280:Promise.resolve(),_countNormalStorageErrorV280:null,
    countOutboxV279:()=>({list:async()=>({operations:[]})}),queueNormalCountDraftsV280:()=>drafts++,
    recordCountSaveErrorV256:(aid,box,message)=>messages.push(message),submitNormalCountV280:async()=>normal++,
    document:{querySelector:()=>null},closeCountNumericKeypad:()=>{legacy++;throw Error('entered legacy found workflow')},
    getCountTypeIssue:()=>'',getSelectedCountRemarks:()=>[]
  });
  return {c,inputs,messages,stats:()=>({normal,drafts,legacy})};
}
test('empty positive quantity remains a draft offline, never becomes a placeholder count',async()=>{
  const s=setup();await s.c.submitCount('a',1,'empty');
  assert.deepEqual(s.stats(),{normal:0,drafts:1,legacy:0});assert.match(s.messages[0],/Found Work/);
  const draft=s.c.normalCountDraftValueV280(s.inputs.q_empty);
  assert.equal(draft.qty,'2');assert.equal(draft.emptyFields.item,'SKU1');assert.equal(draft.emptyFields.lpn,'LPN1');
});
test('empty explicit zero uses normal durable path',async()=>{
  const s=setup('0');await s.c.submitCount('a',1,'empty');assert.equal(s.stats().normal,1);assert.equal(s.stats().legacy,0);
});
test('positive Found Work online retains existing workflow and restores continuity after errors',async()=>{
  const s=setup();s.c.navigator.onLine=true;
  await assert.rejects(s.c.submitCount('a',1,'empty'),/entered legacy/);
  assert.equal(s.stats().legacy,1);assert.equal(s.stats().normal,0);assert.equal(s.c._countContinuityV280.unsupported,false);
});
test('pending result for this location blocks Found Work overwrite, another location does not',async()=>{
  const s=setup();s.c.navigator.onLine=true;
  s.c.countOutboxV279=()=>({list:async()=>({operations:[{jobKey:'u|a',state:'retry'}]})});
  await s.c.submitCount('a',1,'empty');assert.equal(s.stats().legacy,0);
  s.c.countOutboxV279=()=>({list:async()=>({operations:[{jobKey:'u|other',state:'retry'}]})});
  await assert.rejects(s.c.submitCount('a',1,'empty'),/entered legacy/);assert.equal(s.stats().legacy,1);
});
test('changing page while saving a found draft cannot enter legacy writes',async()=>{
  const s=setup();s.c.queueNormalCountDraftsV280=()=>{s.c._countContinuityV280=null;};
  await s.c.submitCount('a',1,'empty');assert.equal(s.stats().legacy,0);
});
