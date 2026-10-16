'use strict';
// Isolated integration test: real Chromium IndexedDB + PGlite + production UI.
// The only HTTP server is loopback. Production Supabase is never contacted.
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');const {html,extractFunction,extractDeclaration}=require('./production-harness.cjs');
const {chromium}=require(process.argv[2]||'playwright');
const output=path.resolve(process.argv[3]||path.join(__dirname,'../../..','outputs'));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [actor,sid,loc,aid,item,loc2,aid2,item2]=[1,3,4,5,6,8,9,7].map(uuid);
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const functions=['createCountOutboxV279','countOfflineViewV279','validateCountOfflinePreparedV279','countPhotoDigestV279','countOutboxV279',
  'updateCountOfflineLauncherV279','countOfflineMessageV279','refreshCountOfflineStatusV279','openCountOfflineV279','closeCountOfflineV279',
  'countOfflineFormValueV279','persistCountOfflineDraftV279','paintCountOfflineV279','exportCountOfflineV279','countOfflineActionV279',
  'computeItemStatus','determineItemNextRequiredRound','stockSnapshotItemKind','operationalStockSnapshotRows','wmsCountBaselineKey',
  'wmsCountBaselineMap','wmsBaselineStartedAtV254','applyWmsCountBaselines','determineNextRequiredCountRound','deriveAssignmentWorkflowStatus',
  'validateDashboardRulesV252','validateCountReadBundleV261','countReadErrorV261','isEmptyLocationItem','normalizeImportText',
  'assignmentPhysicalCountFinished','escapeWmsText','prepareCountPhoto'];
const declarations=['WMS_COUNT_BASELINE_ACTION','_countOutboxV279','_countOfflineUiV279','_countOfflineDraftChainV279',
  '_countOfflineDraftErrorV279','_countOfflinePhotoV279','_countOfflinePaintV279','_countOfflineTimerV279','_countOfflineAutoActorV279'];
const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const fixtureScript=`var me={id:${JSON.stringify(actor)}},S={page:'c-tasks'};
  window._myTasks=[{id:${JSON.stringify(aid)},status:'pending',locations:{code:'DEMO-A01'},count_sessions:{name:'DEMO Cycle Count'}},
    {id:${JSON.stringify(aid2)},status:'pending',locations:{code:'DEMO-A02'},count_sessions:{name:'DEMO Cycle Count'}}];
  var sb={rpc:async(name,args)=>{try{const response=await fetch('/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});return await response.json();}
    catch(error){return {data:null,error:{message:error.message,code:'REQUEST_TIMEOUT'}};}}};`;
const pageHtml=`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DEMO — Offline Count Verification</title><style>${styles}</style><body><p style="padding:24px">ข้อมูลจำลองสำหรับทดสอบเท่านั้น</p><script>
  ${fixtureScript}\n${declarations.map(n=>extractDeclaration(n).code).join('\n')}\n${functions.map(n=>extractFunction(n).code).join('\n')}
  updateCountOfflineLauncherV279();</script></body></html>`;

(async()=>{
  const db=new PGlite();let browser,context,page;let dropNextAck=false,submitCalls=0,allowSubmits=false;
  const errors=[];const timers=[];
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.method==='GET'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(pageHtml);return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Error('Request too big');}
      const args=JSON.parse(body);const name=req.url.split('/').pop();let data;
      if(name==='get_count_offline_bundle_v279')data=(await db.query('SELECT public.get_count_offline_bundle_v279($1) AS data',[args.p_assignment_id])).rows[0].data;
      else if(name==='submit_count_operation_v279'){
        if(!allowSubmits){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{code:'REQUEST_TIMEOUT',message:'Simulated dead spot'}}));return;}
        submitCalls++;data=(await db.query('SELECT public.submit_count_operation_v279($1,$2::jsonb) AS data',[args.p_operation_id,JSON.stringify(args.p_request)])).rows[0].data;
        if(dropNextAck){dropNextAck=false;req.socket.destroy();return;}
      } else throw Error('Unexpected endpoint');
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}));
    }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{code:error.code||'TEST_ERROR',message:error.message}}));}
  });
  try{
    await db.exec(read('fixtures/count-sync-schema.sql'));await db.exec(read('fixtures/count-rpcs-v278.sql'));
    await db.exec(read('../supabase/migrations/20261016011649_count_sync_receipts_v279.sql'));
    await db.query("INSERT INTO profiles VALUES($1,'counter')",[actor]);
    await db.query("INSERT INTO count_sessions(id,name) VALUES($1,'DEMO Cycle Count')",[sid]);
    await db.query("INSERT INTO locations(id,code) VALUES($1,'DEMO-A01'),($2,'DEMO-A02')",[loc,loc2]);
    await db.query("INSERT INTO items(id,code,description) VALUES($1,'DEMO-SKU01','สินค้าทดสอบ A'),($2,'DEMO-SKU02','สินค้าทดสอบ B')",[item,item2]);
    await db.query('INSERT INTO assignments(id,session_id,location_id,assigned_to) VALUES($1,$2,$3,$4),($5,$2,$6,$4)',[aid,sid,loc,actor,aid2,loc2]);
    await db.query('INSERT INTO stock_snapshot(session_id,location_id,item_id,onhand_qty) VALUES($1,$2,$3,10),($1,$4,$5,0)',[sid,loc,item,loc2,item2]);
    await db.exec("INSERT INTO counter_names(name) VALUES('ผู้ทดสอบ'); INSERT INTO type_issue_options(value,label,sort_order) VALUES('damaged','สินค้าเสียหาย',1);");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('SET ROLE authenticated');
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/`;
    browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}:{})});
    context=await browser.newContext({viewport:{width:1100,height:900}});
    await context.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
    page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.getByRole('button',{name:'งานในเครื่อง / พื้นที่อับสัญญาณ'}).click();
    await page.getByRole('button',{name:'เตรียมงาน',exact:true}).click();
    await page.locator('[name="cc-offline-prepare"]').nth(0).check();await page.locator('[name="cc-offline-prepare"]').nth(1).check();
    await page.getByRole('button',{name:'ดาวน์โหลดชุดงานที่เลือก'}).click();
    await page.waitForFunction(()=>document.getElementById('cc-offline-message')?.textContent.includes('เตรียมสำเร็จ 2'));
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'v279-offline-form-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.getElementById('cc-offline-panel').scrollWidth<=390),true);
    await page.setViewportSize({width:1100,height:900});
    await context.setOffline(true);
    await page.locator('#cc-offline-counters').selectOption('ผู้ทดสอบ');await page.locator('#cc-offline-qty').fill('7');
    await page.getByRole('button',{name:'เก็บผลนับและทำรายการถัดไป'}).click();
    await page.waitForFunction(()=>_countOfflineUiV279?.item?.nextRound===2);
    await page.locator('#cc-offline-qty').fill('8');
    await page.evaluate(()=>_countOfflineDraftChainV279);
    // Reload after regaining coverage: persisted drafts belong to the same login.
    await context.setOffline(false);await page.reload();
    await page.getByRole('button',{name:'งานในเครื่อง / พื้นที่อับสัญญาณ'}).click();
    await page.waitForFunction(()=>document.getElementById('cc-offline-qty')?.value==='8');
    await context.setOffline(true);
    await page.getByRole('button',{name:'เก็บผลนับและทำรายการถัดไป'}).click();
    await page.waitForFunction(()=>_countOfflineUiV279?.item?.nextRound===3);
    await page.locator('#cc-offline-qty').fill('9');await page.getByRole('button',{name:'เก็บผลนับและทำรายการถัดไป'}).click();
    await page.waitForFunction(aid=>_countOfflineUiV279?.aid===aid,aid2);
    await page.locator('#cc-offline-qty').fill('0');await page.getByRole('button',{name:'เก็บผลนับและทำรายการถัดไป'}).click();
    await page.waitForFunction(()=>document.getElementById('cc-offline-status')?.textContent==='รอส่ง 4 รายการ');
    const stored=await page.evaluate(()=>countOutboxV279().list());assert.equal(stored.operations.length,4);
    const countsBefore=(await db.query('SELECT count(*)::int AS n FROM count_records')).rows[0].n;assert.equal(countsBefore,0);
    // Inspect a still-editable prepared form in a second isolated test context.
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'v279-offline-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.getElementById('cc-offline-panel').scrollWidth<=390),true);
    dropNextAck=true;allowSubmits=true;
    await context.setOffline(false); // online event starts synchronization
    await page.waitForFunction(async()=>{
      const ops=(await countOutboxV279().list()).operations;
      return ops.some(op=>op.state==='retry') && ops.some(op=>op.state==='synced');
    });
    await page.getByRole('button',{name:'ส่งงานตอนนี้',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('cc-offline-status')?.textContent==='รอส่ง 0 รายการ');
    await page.waitForFunction(()=>document.getElementById('cc-offline-job-progress')?.textContent.includes('ไม่มีผลรอส่ง'));
    await page.setViewportSize({width:1100,height:900});await page.screenshot({path:path.join(output,'v279-offline-synced.png'),fullPage:true});
    await db.exec('RESET ROLE');
    const result=(await db.query("SELECT (SELECT count(*)::int FROM count_records) AS counts,(SELECT count(*)::int FROM audit_log WHERE action='count_recorded') AS audits,(SELECT count(*)::int FROM private.count_sync_receipts_v279) AS receipts")).rows[0];
    assert.deepEqual(result,{counts:4,audits:4,receipts:4});assert.equal(submitCalls,5);assert.deepEqual(errors,[]);
    const statuses=(await db.query('SELECT status FROM assignments ORDER BY id')).rows.map(row=>row.status);
    assert.deepEqual(statuses,['round3_done','completed']);
    console.log(JSON.stringify({passed:true,preparedLocations:2,offlineCounts:4,draftRestoredAfterReload:true,submitCalls,...result,statuses,browserErrors:errors},null,2));
  }catch(error){
    if(page){console.error('Browser diagnostics:',await page.locator('body').innerText().catch(()=>''),errors);await page.screenshot({path:path.join(output,'v279-offline-failure.png'),fullPage:true}).catch(()=>{});}
    throw error;
  }finally{
    for(const timer of timers)clearTimeout(timer);
    await context?.close();await browser?.close();await new Promise(resolve=>server.close(resolve));await db.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
