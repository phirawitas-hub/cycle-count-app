'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,rpc,preview,cancel,uuid,actor,sid,other}=require('./assignment-fixture-v286.cjs');
const {productionContext,deferred}=require('./production-harness.cjs');
test('cached Location collators retain legacy natural order and tie breaks in both directions',()=>{
 const c=productionContext(['compareLocationCodes'],{locationSortDirection:'asc',locationCodeOf:v=>String(v||'')});
 const codes=['','B-GA-1-A','B-GA-01-A','B-GA-10-A','B-GA-2-A','a','A','โล-2','โล-10','A-001','A-1'];
 for(const a of codes)for(const b of codes)for(const direction of ['asc','desc']){
  const legacy=(a.localeCompare(b,'en',{numeric:true,sensitivity:'base'})||a.localeCompare(b,'en',{sensitivity:'base'}))*(direction==='desc'?-1:1);
  assert.equal(Math.sign(c.compareLocationCodes(a,b,direction)),Math.sign(legacy));
 }
});
test('compact assignment bundle is complete above 1000 rows and correctly decodes zero',async()=>{
 const db=await setup(1101);try{
  const data=await rpc(db,'get_assignment_workspace_v286',{p_session_id:sid});
  assert.equal(data.snapshots.length,1101);assert.equal(data.assignments.length,1101);assert.equal(data.locations.length,1101);
  data.snapshots[0][4]=0;
  const c=productionContext(['decodeAssignmentWorkspaceV286'],{assignmentLocationWithDerivedMeta:x=>x,operationalStockSnapshotsByLocation:x=>x});
  const decoded=c.decodeAssignmentWorkspaceV286(data,sid);assert.equal(decoded.snapshots[0].onhand_qty,0);assert.equal(decoded.assignments[0].profiles.name,'Counter');
  assert.throws(()=>c.decodeAssignmentWorkspaceV286({...data,items:null},sid),/ไม่ครบ/);
  assert.throws(()=>c.decodeAssignmentWorkspaceV286(data,uuid(999)),/Session/);
 }finally{await db.close();}
});
test('selected normal cancellation preserves counts, completed work, supporting evidence and outside locations',async()=>{
 const db=await setup();try{
  await db.query('insert into count_records(assignment_id,item_id,round,count_qty) values($1,$2,1,0)',[uuid(10001),uuid(4)]);
  await db.query("update assignments set status='completed' where id=$1",[uuid(10002)]);
  await db.query('insert into found_items(assignment_id) values($1)',[uuid(10000)]);
  const ids=[100,101,102].map(uuid),p=await preview(db,'normal',ids);assert.equal(p.location_ids.length,1);
  const result=await cancel(db,'normal',ids,p);assert.equal(result.released_assignments,1);assert.equal(result.skipped,2);
  const rows=(await db.query('select * from assignments order by id')).rows;
  assert.equal(rows[0].assigned_to,null);assert.equal(rows[0].expired_from,null);
  assert.equal(rows[1].assigned_to,other);assert.equal(rows[2].status,'completed');assert.equal(rows[3].assigned_to,other);
  assert.equal((await db.query('select count(*)::int as n from count_records')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int as n from found_items')).rows[0].n,1);
  await assert.rejects(cancel(db,'normal',ids,p),/ข้อมูลเปลี่ยน/);
 }finally{await db.close();}
});
test('new zero count or reassignment after preview rejects all selected cancellation atomically',async()=>{
 const db=await setup();try{
  const ids=[100,101].map(uuid),p=await preview(db,'normal',ids);
  await db.query('insert into count_records(assignment_id,item_id,round,count_qty) values($1,$2,1,0)',[uuid(10001),uuid(4)]);
  await assert.rejects(cancel(db,'normal',ids,p),/ข้อมูลเปลี่ยน/);
  assert.equal((await db.query('select count(*)::int as n from assignments where assigned_to is null')).rows[0].n,0);
  const p2=await preview(db,'normal',[uuid(100)]);await db.query('update assignments set assigned_to=$1 where id=$2',[actor,uuid(10000)]);
  await assert.rejects(cancel(db,'normal',[uuid(100)],p2),/ข้อมูลเปลี่ยน/);
 }finally{await db.close();}
});
test('annual cancellation removes only selected Location in shared JOB, retains partial counts and completed locations',async()=>{
 const db=await setup();try{
  await db.query('insert into annual_count_jobs(id,session_id,job_no,job_code,assigned_to) values($1,$2,1,$3,$4)',[uuid(50),sid,'JOB-1',other]);
  for(const n of [100,101,102])await db.query('insert into annual_count_job_items(job_id,session_id,location_id,item_id,sort_order) values($1,$2,$3,$4,1)',[uuid(50),sid,uuid(n),uuid(4)]);
  await db.query('insert into count_records(assignment_id,item_id,round,count_qty) values($1,$2,1,2)',[uuid(10000),uuid(4)]);
  await db.query("update assignments set status='completed' where id=$1",[uuid(10002)]);
  assert.equal((await preview(db,'normal',[uuid(100)])).location_ids.length,0);
  const ids=[100,102].map(uuid),p=await preview(db,'annual',ids),result=await cancel(db,'annual',ids,p);
  assert.equal(result.removed_job_items,1);assert.equal(result.skipped,1);
  assert.deepEqual((await db.query('select location_id from annual_count_job_items order by location_id')).rows.map(r=>r.location_id),[101,102].map(uuid));
  assert.equal((await db.query('select assigned_to from annual_count_jobs')).rows[0].assigned_to,other);
  const a=(await db.query('select * from assignments where id=$1',[uuid(10000)])).rows[0];assert.equal(a.assigned_to,null);assert.equal(a.expired_from,other);assert.ok(a.expired_at);
  assert.equal((await db.query('select count_qty from count_records')).rows[0].count_qty,'2');
 }finally{await db.close();}
});
test('counter and anonymous roles cannot access management functions; supervisor can cancel without assignment deletes',async()=>{
 const db=await setup();try{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await assert.rejects(rpc(db,'get_assignment_workspace_v286',{p_session_id:sid}),/Management/);
  await assert.rejects(preview(db,'normal',[uuid(100)]),/Management/);
  await assert.rejects(cancel(db,'normal',[uuid(100)],{token:'x'}),/Management/);
  await db.exec('reset role');await db.query("update profiles set role='supervisor' where id=$1",[actor]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
  const p=await preview(db,'normal',[uuid(100)]);assert.equal((await cancel(db,'normal',[uuid(100)],p)).released_assignments,1);
  await assert.rejects(preview(db,'normal',[]),/Select/);await assert.rejects(preview(db,'wrong',[uuid(100)]),/Select/);
  await db.exec('reset role;set role anon');await assert.rejects(rpc(db,'get_assignment_workspace_v286',{p_session_id:sid}),/permission/);
 }finally{await db.close();}
});
test('failed audit rolls back release rather than leaving half-cancelled work',async()=>{
 const db=await setup();try{
  const ids=[uuid(100)],p=await preview(db,'normal',ids);
  await db.exec('reset role;alter table audit_log add constraint test_failure check (false) not valid;set role authenticated');
  await assert.rejects(cancel(db,'normal',ids,p),/test_failure/);
  assert.equal((await db.query('select assigned_to from assignments where id=$1',[uuid(10000)])).rows[0].assigned_to,other);
 }finally{await db.close();}
});
test('workspace requests deduplicate by actor and page scope; failed or stale response is never reused',async()=>{
 let calls=0;const gate=deferred();const c=productionContext(['loadAssignmentWorkspaceData'],{me:{id:'a'},_activePageRequestController:{},_assignWorkspaceCache:null,sb:{rpc:()=>{calls++;return gate.promise;}},decodeAssignmentWorkspaceV286:x=>x});
 const a=c.loadAssignmentWorkspaceData('s'),b=c.loadAssignmentWorkspaceData('s');assert.equal(calls,1);gate.resolve({data:{ok:true}});await Promise.all([a,b]);
 c.me={id:'b'};await c.loadAssignmentWorkspaceData('s');assert.equal(calls,2);
 c._assignWorkspaceCache.loadedAt=Date.now()-11000;await c.loadAssignmentWorkspaceData('s');assert.equal(calls,3);
 c._activePageRequestController={};c.sb.rpc=async()=>({error:Error('offline')});await assert.rejects(c.loadAssignmentWorkspaceData('s'),/offline/);assert.equal(c._assignWorkspaceCache,null);
});
