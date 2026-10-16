'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {productionContext}=require('./production-harness.cjs');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [actor,other,sid,loc,aid,item,item2]=[1,2,3,4,5,6,7].map(uuid);
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');

test('V2.79 real PostgreSQL count transaction and production-rule equivalence',async t=>{
  const db=new PGlite();
  try {
    await db.exec(read('fixtures/count-sync-schema.sql'));
    await db.exec(read('fixtures/count-rpcs-v278.sql'));
    await db.exec(read('../supabase/migrations/20261016011649_count_sync_receipts_v279.sql'));
    async function reset(oh=10){
      await db.exec('RESET ROLE; TRUNCATE private.count_sync_receipts_v279,public.count_records,public.audit_log,public.stock_snapshot,public.assignments,public.count_sessions,public.profiles,public.items,public.locations,public.annual_count_job_items;');
      await db.query('INSERT INTO profiles VALUES($1,\'counter\'),($2,\'counter\')',[actor,other]);
      await db.query('INSERT INTO count_sessions(id,name) VALUES($1,\'Test\')',[sid]);
      await db.query('INSERT INTO locations(id,code) VALUES($1,\'A01\')',[loc]);
      await db.query('INSERT INTO items(id,code,description) VALUES($1,\'SKU1\',\'one\'),($2,\'SKU2\',\'two\')',[item,item2]);
      await db.query('INSERT INTO assignments(id,session_id,location_id,assigned_to) VALUES($1,$2,$3,$4)',[aid,sid,loc,actor]);
      await db.query('INSERT INTO stock_snapshot(session_id,location_id,item_id,onhand_qty) VALUES($1,$2,$3,$4)',[sid,loc,item,oh]);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
    }
    async function prepare(){return (await db.query('SELECT public.get_count_offline_bundle_v279($1) AS data',[aid])).rows[0].data;}
    const request=(env,qty=10,round=1,previous=null)=>({assignment_id:aid,scope_token:env.scope_token,state_token:env.state_token,
      previous_operation_id:previous,counted_at_client:'2026-10-16T02:00:00.000Z',
      record:{item_id:item,round,count_qty:qty,actual_counter_name:'Counter A',type_issue:null,remark:null,photo_url:null}});
    async function submit(id,req){return (await db.query('SELECT public.submit_count_operation_v279($1,$2::jsonb) AS data',[id,JSON.stringify(req)])).rows[0].data;}
    async function totals(){return (await db.query("SELECT (SELECT count(*)::int FROM count_records) AS counts,(SELECT count(*)::int FROM audit_log WHERE action='count_recorded') AS audits,(SELECT count(*)::int FROM private.count_sync_receipts_v279) AS receipts,(SELECT status FROM assignments WHERE id=$1) AS status",[aid])).rows[0];}
    await t.test('authenticated assignee prepares and commits quantity, audit and terminal status',async()=>{
      await reset(); await db.exec('SET ROLE authenticated');
      const env=await prepare(); const ack=await submit(uuid(100),request(env));
      assert.equal(ack.status,'completed'); assert.equal(ack.actor_id,actor); assert.equal(ack.record.count_qty,10);
      await assert.rejects(db.query('SELECT * FROM private.count_sync_receipts_v279'),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      assert.deepEqual(await totals(),{counts:1,audits:1,receipts:1,status:'completed'});
    });
    await t.test('lost ACK retries return exact original receipt after closure and reassignment',async()=>{
      await reset(); const env=await prepare(); const req=request(env);const op=uuid(101);
      const ack=await submit(op,req);
      await db.query('UPDATE assignments SET assigned_to=$1,wms_closed_at=now() WHERE id=$2',[other,aid]);
      assert.deepEqual(await submit(op,req),ack);assert.deepEqual(await submit(op,req),ack);
      assert.deepEqual(await totals(),{counts:1,audits:1,receipts:1,status:'completed'});
      await assert.rejects(submit(op,{...req,record:{...req.record,count_qty:9}}),e=>e.code==='CC409');
    });
    await t.test('zero and decimals are quantities, blank and negatives are rejected',async()=>{
      for(const qty of [0,1.25]){await reset(qty);const env=await prepare();const ack=await submit(uuid(102),request(env,qty));assert.equal(ack.record.count_qty,qty);}
      await reset();const env=await prepare();
      await assert.rejects(submit(uuid(103),request(env,-1)),e=>e.code==='22023');
      await assert.rejects(submit(uuid(104),request(env,'')),e=>e.code==='22P02');
      assert.equal((await totals()).counts,0);
    });
    await t.test('queued rounds chain their versions; no extra count or changed receipt on retry',async()=>{
      await reset();const env=await prepare();
      const req1=request(env,7,1);const req2=request(env,8,2,uuid(110));const req3=request(env,9,3,uuid(111));
      await assert.rejects(submit(uuid(111),req2),e=>e.code==='CC409');
      assert.equal((await submit(uuid(110),req1)).status,'round1_done');
      assert.equal((await submit(uuid(111),req2)).status,'round2_done');
      assert.equal((await submit(uuid(112),req3)).status,'round3_done');
      await submit(uuid(110),req1);
      assert.deepEqual(await totals(),{counts:3,audits:3,receipts:3,status:'round3_done'});
    });
    await t.test('concurrent-looking clients with one base version cannot both overwrite',async()=>{
      await reset();const env=await prepare();await submit(uuid(120),request(env,7));
      await assert.rejects(submit(uuid(121),request(env,8)),e=>e.code==='CC409');
      assert.equal((await db.query('SELECT count_qty FROM count_records')).rows[0].count_qty,'7');
    });
    await t.test('OH, rules, assignment and session changes require review',async()=>{
      for(const change of ["UPDATE stock_snapshot SET onhand_qty=11","UPDATE count_sessions SET max_rounds=2",`UPDATE assignments SET assigned_to='${other}'`,"UPDATE count_sessions SET status='closed'"]){
        await reset();const env=await prepare();await db.exec(change);
        await assert.rejects(submit(uuid(130),request(env)),e=>e.code==='CC409');
        assert.equal((await totals()).counts,0);
      }
    });
    await t.test('unrelated assignment does not invalidate a prepared job',async()=>{
      await reset();const env=await prepare();await db.query('INSERT INTO assignments(id,session_id,location_id,assigned_to) VALUES($1,$2,$3,$4)',[uuid(90),sid,uuid(91),other]);
      assert.equal((await submit(uuid(131),request(env))).status,'completed');
    });
    await t.test('audit failure rolls back quantity, status and receipt together',async()=>{
      await reset();const env=await prepare();
      await db.exec("CREATE FUNCTION public.reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER test_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_test_audit();");
      await assert.rejects(submit(uuid(140),request(env)),/test audit failure/);
      assert.deepEqual(await totals(),{counts:0,audits:0,receipts:0,status:'pending'});
      await db.exec('DROP TRIGGER test_audit ON audit_log; DROP FUNCTION reject_test_audit();');
      assert.equal((await submit(uuid(140),request(env))).status,'completed');
    });
    await t.test('wrong actor, anonymous role and unsupported work fail closed',async()=>{
      await reset();const env=await prepare();await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);
      await assert.rejects(prepare(),e=>e.code==='42501');await assert.rejects(submit(uuid(150),request(env)),e=>e.code==='CC409');
      await db.exec('SET ROLE anon');await assert.rejects(prepare(),e=>e.code==='42501');await db.exec('RESET ROLE');
      await reset();await db.exec("UPDATE count_sessions SET count_mode='annual'");await assert.rejects(prepare(),e=>e.code==='0A000');
      await reset();await db.exec("UPDATE items SET code='' WHERE code='SKU1'");await assert.rejects(prepare(),e=>e.code==='0A000');
    });
    await t.test('cannot skip rounds or attach remarks without issue classification',async()=>{
      await reset();const env=await prepare();await assert.rejects(submit(uuid(160),request(env,8,2)),e=>e.code==='CC409');
      const req=request(env);req.record.remark='damaged';await assert.rejects(submit(uuid(161),req),e=>e.code==='22023');
      assert.equal((await totals()).counts,0);
    });
    await t.test('partial locations remain in progress; complete scope is retained',async()=>{
      await reset();await db.query('INSERT INTO stock_snapshot(session_id,location_id,item_id,onhand_qty) VALUES($1,$2,$3,20)',[sid,loc,item2]);
      const env=await prepare();assert.equal((await submit(uuid(170),request(env))).status,'in_progress');
      assert.equal((await totals()).counts,1);
    });
    await t.test('SQL item rules match production JS for 576 zero/sparse/repeat/round combinations',async()=>{
      const js=productionContext(['computeItemStatus']);const values=[null,0,3,5];let cases=0;
      for(const max of [1,2,3])for(const repeat of ['recount','auto_pass','send_variance'])for(const r1 of values)for(const r2 of values)for(const r3 of values){
        const expected=js.computeItemStatus(5,r1,r2,r3,{maxRounds:max,repeatMatchAction:repeat});
        const actual=(await db.query('SELECT private.count_item_status_v279(5,$1::numeric[],$2,$3) AS status',[[r1,r2,r3],max,repeat])).rows[0].status;
        assert.equal(actual,expected,JSON.stringify({max,repeat,r1,r2,r3}));cases++;
      }assert.equal(cases,576);
    });
    await t.test('frozen OH excludes items added after baseline and preserves old OH',async()=>{
      await reset();await db.exec("UPDATE stock_snapshot SET created_at='2026-01-01',onhand_qty=99");
      await db.query("INSERT INTO audit_log(assignment_id,item_id,action,old_value,created_at) VALUES($1,$2,'wms_import_count_baseline','10','2026-02-01')",[aid,item]);
      await db.query("INSERT INTO stock_snapshot(session_id,location_id,item_id,onhand_qty,created_at) VALUES($1,$2,$3,20,'2026-03-01')",[sid,loc,item2]);
      const env=await prepare();assert.equal(env.workflow.items.length,1);assert.equal(env.workflow.items[0].onhand_qty,10);
      assert.equal((await submit(uuid(180),request(env,10))).status,'completed');
    });
  } finally {await db.close();}
});
