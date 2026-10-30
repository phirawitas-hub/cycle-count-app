'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');const {indexedDB}=require('fake-indexeddb');
const {productionContext,deferred}=require('./production-harness.cjs');
function setupBox(extra={}){
 let actor='u',reads=0,leases=0;const sent=[];
 const ctx=productionContext(['createCountOutboxV279'],{structuredClone,crypto:{randomUUID}});
 const options={indexedDB,databaseName:randomUUID(),actor:()=>actor,validatePrepared:()=>{},validateRecord:()=>{},
   locks:{request:async(key,opts,fn)=>{leases++;return fn({})}},
   rpc:async(name,args)=>{if(name.startsWith('get_')){reads++;return {data:{actor_id:actor,assignment_id:args.p_assignment_id,scope_token:'a'.repeat(64),state_token:'b'.repeat(64)}};}
    sent.push(structuredClone(args));return {error:{code:'CC409',message:'scope changed'}};},...extra};
 const box=ctx.createCountOutboxV279(options);return {box,options,ctx,sent,actor:v=>actor=v,stats:()=>({reads,leases})};
}
const record={item_id:'i',round:1,count_qty:0,actual_counter_name:'Counter'};
test('scoped IndexedDB reads contain only this assignment and this account',async()=>{
 const s=setupBox();try{
  for(const id of ['a','b']){await s.box.prepare(id);await s.box.enqueue(id,record,null);}
  const one=await s.box.list('a');assert.equal(one.jobs.length,1);assert.equal(one.operations.length,1);assert.equal(one.operations[0].request.assignment_id,'a');
  s.actor('other');assert.equal((await s.box.list('a')).operations.length,0);assert.equal((await s.box.list('a')).jobs.length,0);
 }finally{await s.box.close();}
});
test('sync visits only pending jobs, not hundreds of cached jobs or rejected jobs',async()=>{
 const s=setupBox();try{
  for(let i=0;i<100;i++)await s.box.prepare(String(i));
  await s.box.enqueue('4',record,null);await s.box.sync(true);assert.equal(s.stats().leases,1);
  await s.box.sync(true);assert.equal(s.stats().leases,1);assert.equal((await s.box.list('4')).operations[0].state,'review');
 }finally{await s.box.close();}
});
test('retry review preserves original ID, scope and values across reopening; cannot bypass conflict',async()=>{
 const s=setupBox();try{
  await s.box.prepare('a');await s.box.enqueue('a',record,null);await s.box.sync(true);
  const before=(await s.box.list('a')).operations[0];await s.box.close();const reopened=s.ctx.createCountOutboxV279(s.options);
  try{await reopened.retryRejected('a');const after=(await reopened.list('a')).operations[0];
   assert.equal(after.state,'review');assert.equal(after.key,before.key);assert.deepEqual(after.request,before.request);assert.deepEqual(s.sent[0],s.sent[1]);
   assert.equal((await reopened.list()).operations.length,1);
  }finally{await reopened.close();}
 }finally{await s.box.close();}
});
test('in-flight background preparation cannot replace a currently edited generation',async()=>{
 const s=setupBox();try{
  const original=await s.box.prepare('a');s.options.isJobInUse=job=>job.generation===original.generation;
  const newer=await s.box.prepare('a');assert.equal(newer.generation,original.generation);
  await s.box.enqueue('a',record,null,null,original.generation);assert.equal((await s.box.list('a')).operations.length,1);
 }finally{await s.box.close();}
});
test('network loss stops this sync pass instead of issuing one failing request per queued location',async()=>{
 const s=setupBox();try{
  for(let i=0;i<100;i++){await s.box.prepare(String(i));await s.box.enqueue(String(i),record,null);}
  const transport=s.options.rpc;s.options.rpc=async()=>({error:{code:'REQUEST_TIMEOUT',message:'network offline'}});
  // RPC is captured at creation; reopen the same database with the failed transport.
  await s.box.close();const offline=s.ctx.createCountOutboxV279(s.options);
  try{await offline.sync(true);const state=await offline.list();assert.equal(state.operations.length,100);
    assert.equal(state.operations.filter(op=>op.attempts===1).length,1);assert.equal(state.operations.filter(op=>op.state==='pending').length,99);
  }finally{await offline.close();}
 }finally{await s.box.close();}
});
function reader(){
 let reads=0;const job={key:'u|a',assignmentId:'a',generation:'g',preparedAt:Date.now()-86400000,envelope:{bundle:{assignment:{assigned_at:'2026-10-28T09:00:00Z'}}}};
 const state={owner:'u',jobs:[job],operations:[],drafts:[]};
 const c=productionContext(['obtainCountJobV280','transientCountConnectionV280'],{me:{id:'u'},S:{page:'c-count',aid:'a',_preparedCountV281:'a'},navigator:{onLine:true},_myTasks:[],
  countOutboxV279:()=>({list:async aid=>{assert.equal(aid,'a');return state;}}),prepareCountJobV281:async()=>{reads++;return {...job,generation:'fresh'};}});
 return {c,job,state,reads:()=>reads};
}
test('online next-location opening refreshes stale prepared work instead of reusing yesterday forever',async()=>{
 const s=reader();assert.equal((await s.c.obtainCountJobV280('a')).generation,'fresh');assert.equal(s.reads(),1);
});
test('known reassignment invalidates fresh cache and cannot fall back to it on network failure',async()=>{
 const s=reader();s.job.preparedAt=Date.now();s.c._myTasks=[{id:'a',assigned_at:'2026-10-29T09:00:00Z'}];
 s.c.navigator.onLine=false;await assert.rejects(s.c.obtainCountJobV280('a'),/ถูกจ่ายใหม่/);
 s.c.navigator.onLine=true;s.c.prepareCountJobV281=async()=>{throw Object.assign(Error('offline'),{code:'REQUEST_TIMEOUT'})};
 await assert.rejects(s.c.obtainCountJobV280('a'),/offline/);
});
test('reassignment never deletes or replaces existing pending results or drafts',async()=>{
 for(const field of ['operations','drafts']){
  const s=reader();s.c._myTasks=[{id:'a',assigned_at:'2026-10-29T09:00:00Z'}];
  s.state[field]=field==='operations'?[{jobKey:'u|a',state:'review'}]:[{jobKey:'u|a',generation:'g',value:{qty:'0'}}];
  assert.equal((await s.c.obtainCountJobV280('a')).generation,'g');assert.equal(s.reads(),0);assert.equal(s.state[field].length,1);
 }
});
test('pending recovery rows show zero, archived copies and missing server values without converting absence to zero',()=>{
 const c=productionContext(['countReviewRowsV285']);const state={jobs:[{key:'u|a',envelope:{bundle:{assignment:{assigned_at:'2026-10-28T00:00:00Z',locations:{code:'A01'}},snapshots:[]}}}],operations:[{key:'o',jobKey:'u|a',state:'review',request:{assignment_id:'a',record}}]};
 const before=JSON.stringify(state);let rows=c.countReviewRowsV285(state,'a',{assignment:{assigned_at:'2026-10-29T00:00:00Z'},counts:[]});
 assert.equal(rows[0].qty,0);assert.equal(rows[0].serverQty,null);assert.equal(rows[0].reissued,true);assert.equal(JSON.stringify(state),before);
 state.operations[0].state='archived';rows=c.countReviewRowsV285(state,'a');assert.equal(rows[0].state,'archived');
 state.operations[0].state='synced';assert.equal(c.countReviewRowsV285(state,'a').length,0);
});
test('status notifications coalesce and a late update triggers another bounded refresh',async()=>{
 let reads=0;const gate=deferred();const c=productionContext(['refreshCountOfflineStatusV279'],{setTimeout,refreshCountOfflineStatusNowV285:async()=>{reads++;if(reads===1)await gate.promise;}});
 const first=c.refreshCountOfflineStatusV279();for(let i=0;i<50;i++)void c.refreshCountOfflineStatusV279();
 await new Promise(r=>setTimeout(r,80));assert.equal(reads,1);gate.resolve();await first;
 await new Promise(r=>setTimeout(r,90));assert.equal(reads,2);
});
