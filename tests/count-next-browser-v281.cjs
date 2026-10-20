'use strict';
// Two independent browser contexts exercise the production normal save handler,
// workflow, IndexedDB and real SQL receipt transaction; all traffic is loopback.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {html,extractFunction,extractDeclaration}=require('./production-harness.cjs');
const {chromium}=require(process.argv[2]||'playwright');
const output=path.resolve(process.argv[3]||path.join(__dirname,'../../..','outputs'));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [actor,sid,loc,aid,item,loc2,aid2,item2]=[1,3,4,5,6,8,9,7].map(uuid);
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
async function waitAsync(page,predicate){const until=Date.now()+40000;while(Date.now()<until){if(await page.evaluate(predicate))return;await new Promise(r=>setTimeout(r,100));}throw Error('Async browser condition timed out');}
const names=['createCountOutboxV279','countOfflineViewV279','validateCountOfflinePreparedV279','countPhotoDigestV279','countOutboxV279',
 'updateCountOfflineLauncherV279','countOfflineMessageV279','refreshCountOfflineStatusV279','closeCountOfflineV279',
 'computeItemStatus','determineItemNextRequiredRound','stockSnapshotItemKind','operationalStockSnapshotRows','wmsCountBaselineKey',
 'wmsCountBaselineMap','wmsBaselineStartedAtV254','applyWmsCountBaselines','determineNextRequiredCountRound','deriveAssignmentWorkflowStatus',
 'validateDashboardRulesV252','validateCountReadBundleV261','countReadErrorV261','isEmptyLocationItem','normalizeImportText',
 'assignmentPhysicalCountFinished','escapeWmsText','countContinuityActiveV280','transientCountConnectionV280','obtainCountJobV280',
 'loadCountEntryV280','normalCountViewBundleV280','normalCountDraftValueV280','queueNormalCountDraftsV280','restoreNormalCountDraftsV280',
 'prefetchNormalCountV280','enqueueNormalCountV280','saveNormalCountV280','submitNormalCountV280','paintCountConnectionV280',
 'saveCountItemFromKeypad','resolveCountWorkflowAfterSave','confirmAndAdvanceCountInput','immediateCountRouteExtra'];
const declarations=['WMS_COUNT_BASELINE_ACTION','_countOutboxV279','_countOfflineUiV279','_countOfflineDraftChainV279',
 '_countOfflineDraftErrorV279','_countOfflinePhotoV279','_countOfflinePaintV279','_countOfflineTimerV279','_countOfflineAutoActorV279',
 '_countContinuityV280','_countNormalDraftChainV280','_countNormalStorageErrorV280','_countPrefetchV280'];
names.push('prepareCountJobV281','readyCountJobsV281','countTaskTargetsV281','openNextPreparedCountV281','renderPreparedTaskListV281','openNextCountFromCachedTasks','buildNextCountNavigationRequest','latestMyTaskNavigationState','myTaskNavigationFilterSnapshot','orderedCycleCountNavigationTargets','myTaskNavigationUsesAnnualJobs','myCycleTaskMatchesNavigationFilters','myTaskFilterMatches','normalizeMultiFilterValues','assignmentCanOpenCount','assignmentNextCountRound','syncCachedAssignmentStatusV246');
declarations.push('MY_TASK_FILTER_FIELDS');
declarations.push('_myTasksOwnerV281','_countPrefetchPlanV281','_countPreparingV281');
const fixture=`var me={id:${JSON.stringify(actor)}},S={page:'c-count'},_activePageRequestController={};
 var device=new URL(location.href).searchParams.get('device');var currentAid=device==='C'?${JSON.stringify(uuid(200))}:device==='B'?${JSON.stringify(aid2)}:${JSON.stringify(aid)};
 var _myTasks=[],_selectedCounters=new Set(['ผู้ทดสอบ']),_photoMap={},_countEntryRules={},_countEntryRoundsByItem={};
 var sb={from:()=>{throw Error('Legacy write/read unexpectedly used')},rpc:async(name,args)=>{try{
   const response=await fetch('/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Device':device},body:JSON.stringify(args)});return await response.json();
 }catch(error){return {data:null,error:{message:error.message,code:'REQUEST_TIMEOUT'}}}}};
 var Q=id=>document.getElementById(id),getCountTypeIssue=()=>'',getSelectedCountRemarks=()=>[],refreshCountEntrySummary=()=>{},renderCounterPicker=()=>{},refreshCountRemarkSummary=()=>{};
 var setCountEntryItemResult=(id,state,text)=>{Q('result').textContent=text;},currentCountSaveV256=()=>null;
 var recordCountSaveErrorV256=(aid,box,message)=>{box.textContent=message;},errBox=message=>message;
 var normalizeCountQtyInput=()=>{},countDecisionBatchSoundKindV260=()=>null,countDecisionReceiptKeyV260=()=>'',markCountTerminalV256=()=>{};
 var captureCountViewportAnchorV128=()=>{},showCountResultPopup=async()=>{};
 var _navStack=[],_myAnnualJobs=[],locationSortDirection='asc',myTaskLevelSortEnabled=false;
 var readMyTaskFilters=()=>({}),refreshCachedCountWorkProgressV246=()=>{},myTaskMatchesDate=()=>true,cnt=()=>Q('content');
 var sortMyTaskCycleRows=(rows,direction)=>[...rows].sort((a,b)=>a.locations.code.localeCompare(b.locations.code)*(direction==='desc'?-1:1));
 var returnToMyTasksAndOpenNextCount=()=>go('c-tasks'),countEntryVarianceText=String,assertCountReadScopeV261=(scope,owner)=>{if(owner!==me.id||scope!==_activePageRequestController)throw Error('stale scope');};
 var loadCountReadBundleV261=()=>{throw Error('Unexpected legacy fallback')};
 var go=(page,extra={})=>{S={page,...extra};if(page==='c-count')void renderFixture(extra.aid);else if(device==='C'){void renderPreparedTaskListV281();}else {Q('content').innerHTML='<h2>งานที่ได้รับมอบหมาย</h2>';void refreshCountOfflineStatusV279();}};
 async function renderFixture(aid=currentAid){
  S={page:'c-count',aid};const bundle=await loadCountEntryV280(aid);const view=countOfflineViewV279(_countContinuityV280.job,(await countOutboxV279().list()).operations);
  const row=view.items.find(r=>r.nextRound);if(!row){go('c-tasks');return;}
  _countFoundContext={assignmentId:aid,sessionId:bundle.assignment.session_id,locationId:bundle.assignment.location_id};
  _countEntryRound=row.nextRound;_countEntryRoundsByItem=view.rounds;_countEntryShowOH=true;_countEntryAnnualJobId='';_photoMap={};
  Q('content').innerHTML='<div class="count-handheld-page"><h2>บันทึกการนับ · '+bundle.assignment.locations.code+'</h2><p>'+row.items.code+' · Count '+row.nextRound+'</p><label>จำนวนที่นับ <input class="cqty" id="q_'+row.item_id+'" data-item-id="'+row.item_id+'" data-count-round="'+row.nextRound+'" type="number"></label><p id="result"></p><div id="ca"></div><button id="cb" type="button">ยืนยันยอด</button></div>';
  Q('cb').onclick=()=>confirmAndAdvanceCountInput(Q('q_'+row.item_id));
  await restoreNormalCountDraftsV280(aid);
 }
`;
const pageHtml=`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V2.80 — isolated normal counting test</title>
 <style>body{margin:0;font:16px sans-serif;background:#f7fafb;color:#243041}.main-wrapper{height:100vh;overflow:auto}#content{padding:20px}input{display:block;width:85%;font-size:24px;padding:12px;margin:10px 0}button{padding:12px;border-radius:12px;border:1px solid #d0d5dd;background:white}</style>
 <body><main class="main-wrapper"><div id="content"></div></main><script>${fixture}\n${declarations.map(n=>extractDeclaration(n).code).join('\n')}\n${names.map(n=>extractFunction(n).code).join('\n')}
 updateCountOfflineLauncherV279();void renderFixture();</script></body></html>`;
const fullPageHtml=html.replace(/<script\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>\s*<\/script>/gi,'')
 .replace('// Start Application',`boot=async()=>{
   me={id:${JSON.stringify(actor)}};prof={role:'counter',full_name:'ผู้ทดสอบ'};S={page:'c-count',aid:${JSON.stringify(aid)}};
   sb={from:()=>{throw Error('Unexpected legacy read/write from actual form')},rpc:async(name,args)=>{
     const response=await fetch('/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Device':'FULL'},body:JSON.stringify(args)});return response.json();}};
   window._myTasks=[];window._lastPickedCounterNames=['ผู้ทดสอบ'];
   document.getElementById('app').innerHTML='<div class="main-wrapper"><header class="topbar">บันทึกการนับ (ข้อมูลจำลอง)</header><main id="cnt" class="page-content"></main></div>';
   beginPageRequestScope();await loadCCount();
 };\n// Start Application`);
(async()=>{
 const db=new PGlite(),errors=[];let browser,contextA,contextB,pageA,pageB,contextC,pageC,contextFull,dropAck=false,calls=0;const permitted=new Set(['B']);
 const server=http.createServer(async(req,res)=>{try{
  if(req.method==='GET'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url.startsWith('/full')?fullPageHtml:pageHtml);return;}
  let body='';for await(const chunk of req)body+=chunk;const args=JSON.parse(body),name=req.url.split('/').pop();let data;
  if(name==='get_count_offline_bundle_v279')data=(await db.query('select public.get_count_offline_bundle_v279($1) as data',[args.p_assignment_id])).rows[0].data;
  else if(name==='submit_count_operation_v279'){
   if(!permitted.has(req.headers['x-device'])){res.end(JSON.stringify({data:null,error:{code:'REQUEST_TIMEOUT',message:'Device A lost coverage'}}));return;}
   calls++;data=(await db.query('select public.submit_count_operation_v279($1,$2::jsonb) as data',[args.p_operation_id,JSON.stringify(args.p_request)])).rows[0].data;
   if(dropAck&&req.headers['x-device']==='A'){dropAck=false;req.socket.destroy();return;}
  }else throw Error('Unexpected RPC '+name);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}));
 }catch(error){res.end(JSON.stringify({data:null,error:{code:error.code||'TEST_ERROR',message:error.message}}));}});
 try {
  await db.exec(read('fixtures/count-sync-schema.sql'));await db.exec(read('fixtures/count-rpcs-v278.sql'));await db.exec(read('../supabase/migrations/20261016011649_count_sync_receipts_v279.sql'));
  await db.query("insert into profiles values($1,'counter')",[actor]);await db.query("insert into count_sessions(id,name) values($1,'DEMO')",[sid]);
  await db.query("insert into locations(id,code) values($1,'DEMO-A01'),($2,'DEMO-A02')",[loc,loc2]);await db.query("insert into items(id,code) values($1,'SKU-A'),($2,'SKU-B')",[item,item2]);
  await db.query('insert into assignments(id,session_id,location_id,assigned_to) values($1,$2,$3,$4),($5,$2,$6,$4)',[aid,sid,loc,actor,aid2,loc2]);
  await db.query('insert into stock_snapshot(session_id,location_id,item_id,onhand_qty) values($1,$2,$3,10),($1,$4,$5,0)',[sid,loc,item,loc2,item2]);
  await db.exec("insert into counter_names(name) values('ผู้ทดสอบ')");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}:{})});
  contextFull=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await contextFull.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  const fullPage=await contextFull.newPage();fullPage.on('pageerror',e=>errors.push('Actual form: '+e.message));
  await fullPage.goto(url+'full');
  try{await fullPage.locator('.cqty').first().waitFor({timeout:15000});}catch(error){console.error('Actual form:',await fullPage.locator('body').innerText(),errors);throw error;}
  assert.equal(await fullPage.locator('#count-offline-launcher-v279').count(),0);
  await contextFull.setOffline(true);
  await fullPage.waitForFunction(()=>document.getElementById('count-sync-banner-v280')?.textContent.includes('เครื่องนี้เชื่อมต่อไม่ได้'));
  await fullPage.screenshot({path:path.join(output,'v280-actual-count-form-mobile.png'),fullPage:true});
  assert.equal(await fullPage.evaluate(()=>document.documentElement.scrollWidth<=390),true);
  await contextFull.close();contextFull=null;
  contextA=await browser.newContext({viewport:{width:390,height:844}});contextB=await browser.newContext({viewport:{width:1100,height:900}});
  for(const c of [contextA,contextB])await c.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  pageA=await contextA.newPage();pageB=await contextB.newPage();for(const p of [pageA,pageB]){p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(40000);}
  await pageA.goto(url+'?device=A');await pageB.goto(url+'?device=B');await pageA.locator('.cqty').waitFor();await pageB.locator('.cqty').waitFor();
  assert.equal(await pageA.locator('#count-offline-launcher-v279').count(),0);
  await contextA.setOffline(true);await pageA.locator('.cqty').fill('7');await pageA.locator('#cb').click();
  await pageA.waitForFunction(()=>document.querySelector('.cqty')?.dataset.countRound==='2');
  await pageB.locator('.cqty').fill('0');await pageB.locator('#cb').click();
  await waitAsync(pageB,async()=>(await countOutboxV279().list()).operations.some(op=>op.state==='synced'));
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from count_records')).rows[0].n,1);
  await db.exec('set role authenticated');
  await pageA.locator('.cqty').fill('8');await pageA.evaluate(()=>_countNormalDraftChainV280);
  await contextA.setOffline(false);await pageA.reload();await pageA.waitForFunction(()=>document.querySelector('.cqty')?.value==='8');
  await contextA.setOffline(true);await pageA.locator('#cb').click();await pageA.waitForFunction(()=>document.querySelector('.cqty')?.dataset.countRound==='3');
  await pageA.locator('.cqty').fill('9');await pageA.locator('#cb').click();
  await pageA.waitForFunction(()=>document.getElementById('count-sync-banner-v280')?.textContent.includes('รอส่ง 3'));
  await pageA.screenshot({path:path.join(output,'v280-normal-count-pending-mobile.png'),fullPage:true});
  assert.equal(await pageA.evaluate(()=>document.documentElement.scrollWidth<=390),true);
  permitted.add('A');dropAck=true;await contextA.setOffline(false);
  // No manual sync button: online + scheduled retry must recover the lost ACK.
  await waitAsync(pageA,async()=>{const s=await countOutboxV279().list();return s.operations.length===3&&s.operations.every(op=>op.state==='synced')});
  await pageA.waitForFunction(()=>!document.getElementById('count-sync-banner-v280'));
  await db.exec('reset role');const result=(await db.query("select (select count(*)::int from count_records) as counts,(select count(*)::int from audit_log where action='count_recorded') as audits,(select count(*)::int from private.count_sync_receipts_v279) as receipts")).rows[0];
  assert.deepEqual(result,{counts:4,audits:4,receipts:4});assert.equal(calls,5);assert.deepEqual(errors,[]);
  
  const routeRows=[];
  for(let i=0;i<6;i++){
    await db.query('insert into locations(id,code) values($1,$2)',[uuid(300+i),'ROUTE-'+i]);
    await db.query('insert into assignments(id,session_id,location_id,assigned_to) values($1,$2,$3,$4)',[uuid(200+i),sid,uuid(300+i),actor]);
    await db.query('insert into stock_snapshot(session_id,location_id,item_id,onhand_qty) values($1,$2,$3,10)',[sid,uuid(300+i),item]);
    routeRows.push({id:uuid(200+i),status:'pending',session_id:sid,location_id:uuid(300+i),assigned_at:new Date().toISOString(),locations:{code:'ROUTE-'+i},count_sessions:{name:'DEMO'}});
  }
  await db.exec('set role authenticated');
  contextC=await browser.newContext({viewport:{width:1024,height:768}});
  await contextC.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  pageC=await contextC.newPage();pageC.on('pageerror',e=>errors.push('C: '+e.message));pageC.setDefaultTimeout(40000);
  await pageC.goto(url+'?device=C');await pageC.locator('.cqty').waitFor();
  // Compact verified task rows intentionally have NO assigned_to field.
  await pageC.evaluate(async rows=>{window._myTasks=rows;_myTasksOwnerV281=me.id;await prefetchNormalCountV280(currentAid);},routeRows);
  assert.equal(await pageC.evaluate(async()=>(await countOutboxV279().list()).jobs.length),6);
  await contextC.setOffline(true);
  await pageC.evaluate(()=>window._myTasks.push({id:'not-downloaded',status:'pending',locations:{code:'ROUTE-9'}}));
  for(let i=0;i<6;i++){
    await pageC.waitForFunction(id=>window._countFoundContext?.assignmentId===id&&document.querySelector('.cqty'),uuid(200+i));
    await pageC.locator('.cqty').fill('10');await pageC.locator('#cb').click();
    await waitAsync(pageC,async()=>(await countOutboxV279().list()).operations.length>0);
    if(i===1){
      await pageC.waitForFunction(id=>window._countFoundContext?.assignmentId===id,uuid(202));
      await pageC.evaluate(()=>go('c-tasks',{_countCachedListV281:true}));
      await pageC.getByRole('heading',{name:'งานที่พร้อมนับต่อในเครื่อง'}).waitFor();
      assert.match(await pageC.locator('body').innerText(),/พร้อมนับ 4 Location/);
      await pageC.getByRole('button',{name:'ROUTE-2',exact:true}).click();
    }
  }
  await pageC.getByRole('heading',{name:'งานที่พร้อมนับต่อในเครื่อง'}).waitFor();
  assert.match(await pageC.locator('body').innerText(),/ยังไม่มีงานถัดไปที่พร้อม/);
  assert.equal(await pageC.evaluate(async()=>(await countOutboxV279().list()).operations.length),6);
  assert.equal(await pageC.evaluate(()=>S.page),'c-tasks');
  await pageC.screenshot({path:path.join(output,'v281-offline-route-complete.png'),fullPage:true});
  permitted.add('C');await contextC.setOffline(false);
  await waitAsync(pageC,async()=>{const state=await countOutboxV279().list();return state.operations.length===6&&state.operations.every(op=>op.state==='synced')});
  await db.exec('reset role');
  const finalTotals=(await db.query("select (select count(*)::int from count_records) as counts,(select count(*)::int from audit_log where action='count_recorded') as audits,(select count(*)::int from private.count_sync_receipts_v279) as receipts")).rows[0];
  assert.deepEqual(finalTotals,{counts:10,audits:10,receipts:10});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,offlineLocations:6,compactRowsWithoutAssignedTo:true,offlineList:true,automaticNextLocation:true,unpreparedWorkNotOpened:true,...finalTotals,browserErrors:errors},null,2));
 }catch(error){if(pageC)console.error('Device C',await pageC.locator('body').innerText().catch(()=>''));if(pageA){console.error(await pageA.locator('body').innerText().catch(()=>''),errors);console.error(await pageA.evaluate(async()=>(await countOutboxV279().list()).operations.map(o=>({state:o.state,error:o.error,attempts:o.attempts}))).catch(()=>[]));await pageA.screenshot({path:path.join(output,'v280-normal-count-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
 finally{await contextC?.close();await contextFull?.close();await contextA?.close();await contextB?.close();await browser?.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

