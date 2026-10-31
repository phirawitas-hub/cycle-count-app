'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,preview,cancel,uuid,other,sid}=require('./assignment-fixture-v286.cjs');
const {productionContext}=require('./production-harness.cjs');
test('expired pending and in-progress normal work can be cancelled without affecting other locations',async()=>{
 const db=await setup();try{
  await db.query("update assignments set assigned_to=null,assigned_at=null,expired_at=now(),expired_from=$1,status=case when id=$2 then 'in_progress' else 'pending' end where id=any($3)",[other,uuid(10001),[uuid(10000),uuid(10001),uuid(10002)]]);
  const ids=[uuid(100),uuid(101)],p=await preview(db,'normal',ids);assert.deepEqual(p.location_ids,ids);
  const r=await cancel(db,'normal',ids,p);assert.equal(r.released_assignments,2);
  const rows=(await db.query('select * from assignments order by id')).rows;
  for(const a of rows.slice(0,2)){assert.equal(a.assigned_to,null);assert.equal(a.expired_at,null);assert.equal(a.expired_from,null);}
  assert.equal(rows[1].status,'in_progress');assert.ok(rows[2].expired_at);assert.equal(rows[2].expired_from,other);assert.equal(rows[3].assigned_to,other);
  assert.equal((await preview(db,'normal',ids)).location_ids.length,0);
  assert.equal((await db.query("select count(*)::int n from audit_log where action='assignment_cancel_selected_v286'")).rows[0].n,2);
 }finally{await db.close();}
});
test('expired normal work with count evidence or completed/WMS closed work is still protected',async()=>{
 const db=await setup();try{
  await db.query('update assignments set assigned_to=null,expired_at=now(),expired_from=$1',[other]);
  await db.query('insert into count_records(assignment_id,item_id,round,count_qty) values($1,$2,1,0)',[uuid(10000),uuid(4)]);
  await db.query("update assignments set status='completed' where id=$1",[uuid(10001)]);
  await db.query('update assignments set wms_closed_at=now() where id=$1',[uuid(10002)]);
  const ids=[100,101,102,103].map(uuid),p=await preview(db,'normal',ids);assert.deepEqual(p.location_ids,[uuid(103)]);
  await cancel(db,'normal',ids,p);assert.equal((await db.query('select count_qty from count_records')).rows[0].count_qty,'0');
  assert.ok((await db.query('select expired_at from assignments where id=$1',[uuid(10000)])).rows[0].expired_at);
 }finally{await db.close();}
});
test('expired work reassigned after preview rejects cancellation atomically',async()=>{
 const db=await setup();try{
  await db.query('update assignments set assigned_to=null,expired_at=now(),expired_from=$1 where id=$2',[other,uuid(10000)]);
  const ids=[uuid(100),uuid(101)],p=await preview(db,'normal',ids);
  await db.query('update assignments set assigned_to=$1,assigned_at=now(),expired_at=null,expired_from=null where id=$2',[other,uuid(10000)]);
  await assert.rejects(cancel(db,'normal',ids,p),/ข้อมูลเปลี่ยน/);
  assert.equal((await db.query('select count(*)::int n from assignments where assigned_to is not null')).rows[0].n,8);
 }finally{await db.close();}
});
test('expired JOB dropdown remains supported; cancel only selected Location and retain other expired items',async()=>{
 const db=await setup();try{
  await db.query('insert into annual_count_jobs(id,session_id,job_code,expired_at,expired_from) values($1,$2,$3,now(),$4)',[uuid(50),sid,'JOB-EXPIRED',other]);
  for(const n of [100,101])await db.query('insert into annual_count_job_items(job_id,session_id,location_id,item_id) values($1,$2,$3,$4)',[uuid(50),sid,uuid(n),uuid(4)]);
  await db.query('update assignments set assigned_to=null,expired_at=now(),expired_from=$1 where id=any($2)',[other,[uuid(10000),uuid(10001)]]);
  assert.equal((await preview(db,'normal',[uuid(100)])).location_ids.length,0);
  const p=await preview(db,'annual',[uuid(100)]);await cancel(db,'annual',[uuid(100)],p);
  assert.deepEqual((await db.query('select location_id from annual_count_job_items')).rows.map(r=>r.location_id),[uuid(101)]);
  assert.equal((await db.query('select expired_from from annual_count_jobs')).rows[0].expired_from,other);
 }finally{await db.close();}
});
test('cancellation UI includes expired normal locations while excluding free, completed and JOB-owned locations',()=>{
 const c=productionContext(['assignmentCancellationRowsV286','isExpiredWaitingAssignment'],{
  annualLatestAssignmentsByLocation:rows=>new Map(rows.map(r=>[r.location_id,r])),assignmentCountingFinished:s=>['completed','approved','round3_done'].includes(s),sortRowsByLocation:r=>r});
 const assignments=[{location_id:'expired',status:'in_progress',assigned_to:null,expired_from:'u',expired_at:'2026-10-31'},
  {location_id:'issued',status:'pending',assigned_to:'u'},{location_id:'free',status:'pending'},
  {location_id:'done',status:'completed',expired_from:'u',expired_at:'2026-10-31'},
  {location_id:'job',status:'pending',expired_from:'u',expired_at:'2026-10-31'}];
 const ws={assignments,locationById:new Map(assignments.map(a=>[a.location_id,{id:a.location_id,code:a.location_id}])),jobs:[{id:'j',status:'pending'}],items:[{job_id:'j',location_id:'job'}]};
 assert.deepEqual(Array.from(c.assignmentCancellationRowsV286(ws,'normal'),r=>r.location.id),['expired','issued']);
 assert.deepEqual(Array.from(c.assignmentCancellationRowsV286(ws,'annual'),r=>r.location.id),['job']);
});
