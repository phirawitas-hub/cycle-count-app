'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {indexedDB,IDBObjectStore}=require('fake-indexeddb');
const {productionContext}=require('./production-harness.cjs');
const ctx=productionContext(['createCountOutboxV279'],{structuredClone,crypto:{randomUUID}});
function setup(extra={}){
  let actor='actor-a';const databaseName=randomUUID();
  const envelope={schema_version:1,actor_id:actor,assignment_id:'job-a',scope_token:'a'.repeat(64),state_token:'b'.repeat(64)};
  const options={indexedDB,databaseName,actor:()=>actor,uuid:randomUUID,
    rpc:async(name,args)=>name.startsWith('get_')?{data:structuredClone(envelope)}:{data:ack(args)},
    validatePrepared:(env,aid,id)=>{if(env.actor_id!==id||env.assignment_id!==aid)throw Error('wrong scope');},
    validateRecord:()=>{},upload:async()=>{},photoUrl:(id,op)=>`https://example.invalid/${id}/${op}.jpg`,...extra};
  const create=()=>ctx.createCountOutboxV279(options);
  const box=create();
  return {box,create,options,envelope,setActor:id=>{actor=id;}};
}
function ack(args){const req=args.p_request;return {schema_version:1,operation_id:args.p_operation_id,actor_id:'actor-a',
  assignment_id:req.assignment_id,scope_token:req.scope_token,state_token:'c'.repeat(64),status:'in_progress',
  record:{...req.record,assignment_id:req.assignment_id,counted_at:'2026-10-16T02:00:00Z'}};}
const record=(qty=0)=>({item_id:'item-a',round:1,count_qty:qty,actual_counter_name:'Counter',type_issue:null,remark:null,photo_url:null});

test('refresh in another tab invalidates old forms even when both tails are null',async()=>{
  const s=setup();const two=s.create();const old=await s.box.prepare('job-a');
  const fresh=await two.prepare('job-a');assert.notEqual(old.generation,fresh.generation);
  await assert.rejects(s.box.enqueue('job-a',record(9),null,null,old.generation),e=>e.code==='LOCAL_CONFLICT');
  await assert.rejects(s.box.saveDraft('job-a','item-a',1,{qty:9},null,old.generation),e=>e.code==='LOCAL_CONFLICT');
  assert.equal((await two.list()).operations.length,0);assert.equal((await two.list()).drafts.length,0);
  await two.enqueue('job-a',record(0),null,null,fresh.generation);
  assert.equal((await two.list()).operations.length,1);await s.box.close();await two.close();
});

test('outbox commits locally and survives closing/reopening before any network request',async()=>{
  const {box,create}=setup();await box.prepare('job-a');
  const op=await box.enqueue('job-a',record(0),null);await box.close();
  const next=create();const data=await next.list();
  assert.equal(data.operations[0].request.record.count_qty,0);assert.equal(data.operations[0].state,'pending');
  assert.equal(data.jobs[0].tailId,op.key);await next.close();
});
test('retry after a lost server response uses exactly the same operation and payload',async()=>{
  let sends=0;let saved;const calls=[];
  const s=setup();s.options.rpc=async(name,args)=>{
    if(name.startsWith('get_'))return {data:s.envelope};calls.push(structuredClone(args));
    if(++sends===1){saved=ack(args);throw Object.assign(Error('network response lost'),{code:'REQUEST_TIMEOUT'});}
    return {data:saved};
  };
  // Factory captures transport, so instantiate after assigning the test transport.
  const box=s.create();await box.prepare('job-a');await box.enqueue('job-a',record(4),null);
  await box.sync(true);assert.equal((await box.list()).operations[0].state,'retry');
  await box.close();const next=s.create();await next.sync(true);
  assert.deepEqual(calls[0],calls[1]);assert.equal((await next.list()).operations[0].state,'synced');await next.close();
});
test('later queued values stay pending when only an earlier receipt arrives',async()=>{
  let resolveFirst,entered;const ready=new Promise(r=>entered=r);const gate=new Promise(r=>resolveFirst=r);
  const s=setup();s.options.rpc=async(name,args)=>{
    if(name.startsWith('get_'))return {data:s.envelope};
    if(args.p_request.record.count_qty===1){entered();await gate;return {data:ack(args)};}
    throw Error('offline');
  };
  const box=s.create();await box.prepare('job-a');const first=await box.enqueue('job-a',record(1),null);
  const syncing=box.sync(true);await ready;
  await box.enqueue('job-a',{...record(2),round:2},first.key);resolveFirst();await syncing;
  const ops=(await box.list()).operations.sort((a,b)=>a.sequence-b.sequence);
  assert.equal(ops[0].state,'synced');assert.equal(ops[1].state,'retry');
  assert.equal(ops[1].request.previous_operation_id,first.key);await box.close();
});
test('two tabs cannot both claim the same assignment sender lease',async()=>{
  let release,entered;const ready=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);let sends=0;
  const s=setup();s.options.rpc=async(name,args)=>{if(name.startsWith('get_'))return {data:s.envelope};sends++;entered();await gate;return {data:ack(args)};};
  const one=s.create(),two=s.create();await one.prepare('job-a');await one.enqueue('job-a',record(),null);
  const active=one.sync(true);await ready;await two.sync(true);assert.equal(sends,1);release();await active;await one.close();await two.close();
});
test('a stale form in another tab cannot append using an old local tail',async()=>{
  const s=setup();const two=s.create();await s.box.prepare('job-a');await s.box.enqueue('job-a',record(),null);
  await assert.rejects(two.enqueue('job-a',record(9),null),e=>e.code==='LOCAL_CONFLICT');
  assert.equal((await two.list()).operations.length,1);await s.box.close();await two.close();
});
test('server conflict preserves payload and blocks its dependent operations',async()=>{
  let sends=0;const s=setup();s.options.rpc=async(name)=>name.startsWith('get_')?{data:s.envelope}:(sends++,{error:{code:'CC409',message:'changed'}});
  const box=s.create();await box.prepare('job-a');const first=await box.enqueue('job-a',record(3),null);
  await box.enqueue('job-a',{...record(4),round:2},first.key);await box.sync(true);await box.sync(true);
  const ops=(await box.list()).operations.sort((a,b)=>a.sequence-b.sequence);
  assert.equal(sends,1);assert.equal(ops[0].state,'review');assert.equal(ops[1].state,'pending');
  assert.equal(ops[0].request.record.count_qty,3);await assert.rejects(box.prepare('job-a'),/รอส่ง/);await box.close();
});
test('auth expiry retains work; another actor cannot view or send it',async()=>{
  const s=setup();s.options.rpc=async(name)=>name.startsWith('get_')?{data:s.envelope}:{error:{code:'PGRST301',message:'expired'}};
  const box=s.create();await box.prepare('job-a');await box.enqueue('job-a',record(),null);await box.sync(true);
  assert.equal((await box.list()).operations[0].state,'auth');s.setActor('actor-b');
  assert.equal((await box.list()).operations.length,0);await box.sync(true);
  s.setActor('actor-a');assert.equal((await box.list()).operations.length,1);await box.close();
});
test('invalid or mismatched receipts never mark a count as synced',async()=>{
  const s=setup();s.options.rpc=async(name,args)=>name.startsWith('get_')?{data:s.envelope}:{data:{...ack(args),actor_id:'someone-else'}};
  const box=s.create();await box.prepare('job-a');await box.enqueue('job-a',record(),null);await box.sync(true);
  assert.equal((await box.list()).operations[0].state,'retry');await box.close();
});
test('quota failure preserves the draft and does not advance local progress',async()=>{
  const s=setup();await s.box.prepare('job-a');await s.box.saveDraft('job-a','item-a',1,{qty:'5'},null);
  const original=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(...args){if(this.name==='operations')throw new DOMException('quota','QuotaExceededError');return original.apply(this,args);};
  try{await assert.rejects(s.box.enqueue('job-a',record(5),null),e=>e.name==='QuotaExceededError');}
  finally{IDBObjectStore.prototype.add=original;}
  const data=await s.box.list();assert.equal(data.operations.length,0);assert.equal(data.jobs[0].tailId,null);assert.equal(data.drafts[0].value.qty,'5');
  await s.box.close();
});
test('quantity blanks cannot become zero and a pending draft prevents replacement',async()=>{
  const {box}=setup();await box.prepare('job-a');await assert.rejects(box.enqueue('job-a',record(''),null),/จำนวน/);
  await box.saveDraft('job-a','item-a',1,{qty:'0'},null);await assert.rejects(box.prepare('job-a'),/กรอกค้าง/);await box.close();
});
test('photo upload failure retains attachment and does not submit incomplete count',async()=>{
  let submits=0;const s=setup({upload:async()=>{throw Error('upload offline');}});
  s.options.rpc=async(name,args)=>name.startsWith('get_')?{data:s.envelope}:(submits++,{data:ack(args)});
  const box=s.create();await box.prepare('job-a');
  await box.enqueue('job-a',{...record(),type_issue:'damage'},null,{blob:new Blob(['photo']),digest:'hash'});
  await box.sync(true);const op=(await box.list()).operations[0];assert.equal(submits,0);assert.equal(op.attachment.blob.size,5);assert.equal(op.state,'retry');await box.close();
});
test('confirmed payloads can be refreshed; rejected work is retained in recovery history',async()=>{
  const s=setup();await s.box.prepare('job-a');await s.box.enqueue('job-a',record(),null);
  await assert.rejects(s.box.archiveRejected('job-a'),/ไม่ทราบผล/);await s.box.sync(true);
  const refreshed=await s.box.prepare('job-a');assert.equal(refreshed.tailId,null);assert.equal((await s.box.list()).operations.length,1);await s.box.close();
});

async function replaceLease(databaseName,protocol,until){
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(databaseName,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('jobs','readwrite'),s=tx.objectStore('jobs'),r=s.get('actor-a|job-a');
    r.onsuccess=()=>s.put({...r.result,leaseOwner:'crashed-tab',leaseUntil:until,leaseProtocol:protocol});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
}
test('V2.80 browser lock recovers a crashed sender immediately without changing operation ID',async()=>{
  let sends=0;const locks={request:async(name,options,work)=>work({name})};
  const s=setup({locks});s.options.rpc=async(name,args)=>name.startsWith('get_')?{data:s.envelope}:(sends++,{data:ack(args)});
  const box=s.create();await box.prepare('job-a');const original=await box.enqueue('job-a',record(),null);
  await replaceLease(s.options.databaseName,'web-lock-v280',Date.now()+60000);
  await box.sync(true);const op=(await box.list()).operations[0];assert.equal(sends,1);assert.equal(op.state,'synced');assert.equal(op.key,original.key);await box.close();
});
test('V2.80 respects old V2.79 leases and an occupied browser lock',async()=>{
  let time=1000,available=true;const locks={request:async(name,options,work)=>work(available?{name}:null)};
  const s=setup({locks,now:()=>time});await s.box.prepare('job-a');await s.box.enqueue('job-a',record(),null);
  await replaceLease(s.options.databaseName,undefined,61000);await s.box.sync(true);
  assert.equal((await s.box.list()).operations[0].state,'pending');
  time=62000;available=false;await s.box.sync(true);assert.equal((await s.box.list()).operations[0].state,'pending');
  available=true;await s.box.sync(true);assert.equal((await s.box.list()).operations[0].state,'synced');await s.box.close();
});
