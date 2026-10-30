'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');const {html}=require('./production-harness.cjs');
const output=path.resolve(process.argv[3]||'../../outputs');
const envelope=JSON.parse(fs.readFileSync(path.join(output,'v285-synthetic-pending-recovery.json'),'utf8')).jobs[0].envelope;
const source=html.replace(/<script\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>\s*<\/script>/gi,'').replace('// Start Application',`boot=async()=>{
 me={id:${JSON.stringify(envelope.actor_id)}};prof={role:'counter'};S={page:'c-count'};
 document.getElementById('app').innerHTML='<main class="main-wrapper"><div id="cnt"></div></main>';
 window.stressReady=true;
};\n// Start Application`);
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(source)});let browser;
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.stressReady);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  await page.evaluate(async base=>{
   window.stressNotify=false;window.stressOffline=false;window.stressSent=new Map();window.stressHeartbeat=[];
   let last=performance.now();window.stressTimer=setInterval(()=>{const now=performance.now();stressHeartbeat.push(now-last);last=now;},20);
   window.stressBox=createCountOutboxV279({indexedDB,actor:()=>me.id,databaseName:'synthetic-volume-v285',validatePrepared:()=>{},validateRecord:()=>{},
    notify:()=>{if(stressNotify)void refreshCountOfflineStatusV279();},
    rpc:async(name,args)=>{
     if(name.startsWith('get_')){const env=structuredClone(base);env.assignment_id=args.p_assignment_id;env.bundle.assignment.id=args.p_assignment_id;env.bundle.assignment.locations.code=args.p_assignment_id;return {data:env};}
     if(stressOffline)return {error:{code:'REQUEST_TIMEOUT',message:'network offline'}};
     const req=args.p_request;let ack=stressSent.get(args.p_operation_id);
     if(!ack){ack={schema_version:1,operation_id:args.p_operation_id,actor_id:me.id,assignment_id:req.assignment_id,scope_token:req.scope_token,state_token:'c'.repeat(64),status:'completed',record:{...req.record,assignment_id:req.assignment_id,counted_at:new Date().toISOString()}};stressSent.set(args.p_operation_id,ack);}
     return {data:ack};
    }});_countOutboxV279=stressBox;
   window.stressJobs=[];
   for(let i=0;i<600;i++)stressJobs.push(await stressBox.prepare('VOLUME-'+i));
   window._myTasks=stressJobs.map(j=>j.envelope.bundle.assignment);_myTasksOwnerV281=me.id;
   _countPrefetchPlanV281={owner:me.id,targets:stressJobs.map(j=>({assignmentId:j.assignmentId})),loading:false};
  },envelope);
  await context.setOffline(true);
  const offline=await page.evaluate(async()=>{
   stressOffline=true;stressNotify=true;stressHeartbeat.length=0;const started=performance.now();
   for(const job of stressJobs){const item=job.envelope.bundle.snapshots[0];await stressBox.enqueue(job.assignmentId,{item_id:item.item_id,round:1,count_qty:0,actual_counter_name:'Synthetic'},null);}
   await refreshCountOfflineStatusV279();const state=await stressBox.list();
   const t=performance.now();let scopedRows=0;for(let i=0;i<50;i++)scopedRows+=(await stressBox.list('VOLUME-'+i)).jobs.length;
   await stressBox.sync(true);
   return {jobs:state.jobs.length,pending:state.operations.length,unique:new Set(state.operations.map(o=>o.key)).size,enqueueMs:Math.round(t-started),scoped50Ms:Math.round(performance.now()-t),scopedRows,maxHeartbeatGapMs:Math.round(Math.max(...stressHeartbeat)),heapMB:Math.round((performance.memory?.usedJSHeapSize||0)/1048576)};
  });
  assert.equal(offline.jobs,600);assert.equal(offline.pending,600);assert.equal(offline.unique,600);assert.equal(offline.scopedRows,50);
  const result=await page.evaluate(async()=>{
   stressOffline=false;await stressBox.close();
   // Reopening the same IndexedDB connection must retain every pending result.
   const retained=(await stressBox.list()).operations.length;const t=performance.now();await stressBox.sync(true);await stressBox.sync(true);
   const state=await stressBox.list();clearInterval(stressTimer);
   return {retained,synced:state.operations.filter(o=>o.state==='synced').length,serverUnique:stressSent.size,syncMs:Math.round(performance.now()-t),maxHeartbeatGapMs:Math.round(Math.max(...stressHeartbeat))};
  });
  assert.equal(result.retained,600);assert.equal(result.synced,600);assert.equal(result.serverUnique,600);assert.deepEqual(errors,[]);
  const report={cpuThrottle:6,transport:'synthetic acknowledgements; no production requests',offline,reconnect:result,browserErrors:errors};
  fs.writeFileSync(path.join(output,'v285-volume-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
