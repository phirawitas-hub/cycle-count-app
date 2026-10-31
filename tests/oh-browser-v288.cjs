'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require(process.argv[2]||'playwright');
const {html}=require('./production-harness.cjs');
const output=path.resolve(process.argv[3]||'../../outputs');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=uuid(1),sid=uuid(3),aids=[uuid(20),uuid(21),uuid(22)];
(async()=>{
 const db=new PGlite();let browser,server;const errors=[];
 try{
  for(const p of ['fixtures/count-sync-schema.sql','fixtures/count-rpcs-v278.sql','../supabase/migrations/20261016011649_count_sync_receipts_v279.sql','../supabase/migrations/20261029012358_empty_location_zero_count_v284.sql'])await db.exec(fs.readFileSync(path.join(__dirname,p),'utf8'));
  await db.query("insert into profiles values($1,'counter')",[actor]);await db.query("insert into count_sessions(id,name,show_oh) values($1,'Session OH test',false)",[sid]);
  await db.query("insert into items(id,code) values($1,'SKU-OH')",[uuid(4)]);
  for(let i=0;i<3;i++){
   await db.query('insert into locations(id,code) values($1,$2)',[uuid(10+i),'TEST-A0'+(i+1)]);
   await db.query('insert into assignments(id,session_id,location_id,assigned_to) values($1,$2,$3,$4)',[aids[i],sid,uuid(10+i),actor]);
   await db.query('insert into stock_snapshot(session_id,location_id,item_id,onhand_qty) values($1,$2,$3,10)',[sid,uuid(10+i),uuid(4)]);
  }
  // Local fixture permits the management control to update this synthetic Session.
  await db.exec("insert into counter_names(name) values('ผู้ทดสอบ'); grant select,update on count_sessions to authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
  const boot=`boot=async()=>{
   me={id:${JSON.stringify(actor)}};prof={role:'admin',full_name:'ผู้ทดสอบ'};S={page:'c-count',aid:${JSON.stringify(aids[0])}};
   sb={rpc:async(name,args)=>fetch('/rpc',{method:'POST',body:JSON.stringify({name,args})}).then(r=>r.json()),from:table=>{
    const filters=[];let one=false,values=null;const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},in:()=>q,order:()=>q,range:()=>q,maybeSingle:()=>{one=true;return q;},single:()=>{one=true;return q;},update:v=>{values=v;return q;},then:(a,b)=>fetch('/table',{method:'POST',body:JSON.stringify({table,filters,one,values})}).then(r=>r.json()).then(a,b)};return q;}};
   window._myTasks=[];window._lastPickedCounterNames=['ผู้ทดสอบ'];
   document.getElementById('app').innerHTML='<div class="main-wrapper"><main id="cnt" class="page-content"></main></div>';
   beginPageRequestScope();await loadCCount();window.fixtureReady=true;
  };\n`;
  const source=html.replace(/<script\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>\s*<\/script>/gi,'').replace('// Start Application',boot+'// Start Application');
  server=http.createServer(async(req,res)=>{try{
   res.setHeader('Content-Type',req.method==='GET'?'text/html;charset=utf-8':'application/json');if(req.method==='GET'){res.end(source);return;}
   let raw='';for await(const b of req)raw+=b;const x=JSON.parse(raw);let data;
   if(req.url==='/table'){
    if(x.values){assert.equal(x.table,'count_sessions');assert.deepEqual(Object.keys(x.values),['show_oh']);assert.deepEqual(x.filters,[['id',sid]]);await db.query('update count_sessions set show_oh=$1 where id=$2',[x.values.show_oh,sid]);}
    const rows=x.table==='count_sessions'?(await db.query('select * from count_sessions')).rows:x.table==='profiles'?[{id:actor,role:'counter',full_name:'ผู้ทดสอบ'}]:[];
    const filtered=rows.filter(r=>x.filters.every(([k,v])=>r[k]===v));data=x.one?(filtered[0]||null):filtered;
   }else if(x.name==='get_count_offline_bundle_v279')data=(await db.query('select public.get_count_offline_bundle_v279($1) data',[x.args.p_assignment_id])).rows[0].data;
   else if(x.name==='get_count_read_bundle_v261')data=(await db.query('select public.get_count_read_bundle_v261($1,$2) data',[x.args.p_assignment_id,x.args.p_include_entry])).rows[0].data;
   else throw Error('Unexpected RPC '+x.name);
   res.end(JSON.stringify({data,error:null}));
  }catch(e){res.end(JSON.stringify({data:null,error:{code:e.code||'TEST_ERROR',message:e.message}}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const ctx=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});await ctx.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);
  assert.equal(await page.evaluate(()=>window._countEntryShowOH),false);
  await page.evaluate(async ids=>{for(const aid of ids)await obtainCountJobV280(aid,{prefetch:true});},aids.slice(1));
  // This reproduces an admin turning OH on while counters have the next jobs cached.
  await db.query('update count_sessions set show_oh=true where id=$1',[sid]);
  await page.evaluate(async aid=>{S={page:'c-count',aid,_preparedCountV281:aid};beginPageRequestScope();await loadCCount();},aids[1]);
  assert.equal(await page.evaluate(()=>window._countEntryShowOH),true);assert.equal(await page.locator('.cqty').count(),1);
  await page.screenshot({path:path.join(output,'v288-count-oh-on.png'),fullPage:true});
  // Prepare with OH on, then turn it off: stale cache must not reveal OH.
  await page.evaluate(async aid=>prepareCountJobV281(aid),aids[2]);await db.query('update count_sessions set show_oh=false where id=$1',[sid]);
  await page.evaluate(async aid=>{S={page:'c-count',aid,_preparedCountV281:aid};beginPageRequestScope();await loadCCount();},aids[2]);
  assert.equal(await page.evaluate(()=>window._countEntryShowOH),false);
  await ctx.setOffline(true);await page.evaluate(async aid=>{S={page:'c-count',aid};beginPageRequestScope();await loadCCount();},aids[2]);assert.equal(await page.locator('.cqty').count(),1);await ctx.setOffline(false);
  // Actual management markup, native keyboard switch and returned DB state.
  await page.evaluate(async sid=>{clearHandheldCountFocusTimers();closeCountNumericKeypad();S={page:'ad-assign'};beginPageRequestScope();await renderManageAssign(Q('cnt'));Q('as-sess').value=sid;await syncOHToggle();},sid);
  assert.equal(await page.locator('#zoneDashDetails').count(),0);await page.locator('#oh-toggle').focus();await page.keyboard.press('Space');
  await page.waitForFunction(()=>!Q('oh-toggle').disabled&&Q('oh-toggle').checked);assert.equal((await db.query('select show_oh from count_sessions where id=$1',[sid])).rows[0].show_oh,true);
  await page.locator('#assign-step-session').screenshot({path:path.join(output,'v288-oh-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('#assign-step-session').screenshot({path:path.join(output,'v288-oh-mobile.png')});
  const layout=await page.locator('.assign-oh-card').evaluate(el=>{const parts=[...el.children].map(e=>e.getBoundingClientRect());return {overflow:el.scrollWidth>el.clientWidth+1,overlap:parts[1].right>parts[2].left};});assert.deepEqual(layout,{overflow:false,overlap:false});
  assert.deepEqual(errors,[]);console.log('PASS: actual count forms OH off→on→off, cached next Locations, offline reopening, keyboard toggle + persisted DB state, desktop/mobile layout; no page errors.');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
