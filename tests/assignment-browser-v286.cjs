'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
const {setup,rpc,uuid,actor,sid,other}=require('./assignment-fixture-v286.cjs');
const {html}=require('./production-harness.cjs');
const baseline=process.argv.includes('--baseline');
const inputHtml=baseline?require('node:child_process').execFileSync('git',['show','82ff097:index.html'],{cwd:path.join(__dirname,'..'),encoding:'utf8',maxBuffer:12000000}):html;
const output=path.resolve(process.argv[3]||'../../outputs');
(async()=>{
 console.log('Creating 12000-location fixture');
 const db=await setup(12000);console.log('Fixture ready');let browser,server,page;const errors=[];let reads=0;
 await db.query('insert into annual_count_jobs(id,session_id,job_no,job_code,assigned_to) values($1,$2,1,$3,$4)',[uuid(50),sid,'JOB-1',other]);
 for(const n of [100,101])await db.query('insert into annual_count_job_items(job_id,session_id,location_id,item_id,sort_order) values($1,$2,$3,$4,1)',[uuid(50),sid,uuid(n),uuid(4)]);
 const tables={};for(const name of ['count_sessions','profiles','assignments','stock_snapshot','locations','annual_count_jobs','annual_count_job_items','audit_log'])tables[name]=(await db.query('select * from '+name)).rows;
 const boot=`boot=async()=>{
 me={id:${JSON.stringify(actor)}};prof={role:'admin'};S={page:'ad-assign'};
 window.fixtureTables=${JSON.stringify(tables)};window.calls=[];
 sb={rpc:(name,args)=>{calls.push(name);return fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})}).then(r=>r.json());},from:table=>{
   const state={filters:[],single:false,from:0,to:Infinity,write:false};
   const q={select:()=>q,eq:(k,v)=>{state.filters.push(r=>r[k]===v);return q;},in:(k,v)=>{state.filters.push(r=>v.includes(r[k]));return q;},order:()=>q,range:(a,b)=>{state.from=a;state.to=b;return q;},maybeSingle:()=>{state.single=true;return q;},upsert:()=>{state.write=true;return q;},update:()=>{state.write=true;return q;},then:(resolve,reject)=>{
     calls.push(table);let rows=(fixtureTables[table]||[]).filter(r=>state.filters.every(f=>f(r))).slice(state.from,state.to+1);
     return Promise.resolve({data:state.single?(rows[0]||null):rows,error:state.write&&table!=='app_settings'?{message:'Unexpected fixture write '+table}:null}).then(resolve,reject);
   }};return q;}};
 document.getElementById('app').innerHTML='<main class="main-wrapper"><div id="cnt"></div></main>';
 const original=handleAssignSessionChange;handleAssignSessionChange=async()=>{window.menuReady=false;const t=performance.now();await original();window.loadMs=performance.now()-t;window.menuReady=true;};
 await renderManageAssign(Q('cnt'));window.fixtureReady=true;
};\n`;
 const source=inputHtml.replace(/<script\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>\s*<\/script>/gi,'').replace('// Start Application',boot+'// Start Application');
 server=http.createServer(async(req,res)=>{
  if(req.url==='/rpc'){
   try{let body='';for await(const chunk of req)body+=chunk;const {name,args}=JSON.parse(body);if(name==='get_assignment_workspace_v286')reads++;
    const data=await rpc(db,name,args);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}));
   }catch(e){res.end(JSON.stringify({data:null,error:{message:e.message,code:e.code}}));}return;
  }
  res.setHeader('Content-Type','text/html');res.end(source);
 });
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
  console.log('Opening menu');await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);console.log('Menu booted');
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.selectOption('#as-sess',sid);await page.waitForFunction(()=>window.menuReady&&window._bulkSnaps?.length===12000);console.log('Session loaded');
  if(baseline){const result=await page.evaluate(()=>({version:APP_VERSION,loadMs:Math.round(window.loadMs),requests:window.calls.length,rows:document.querySelectorAll('.assignment-print-row,.normal-free-row').length}));fs.writeFileSync(path.join(output,'v286-before-benchmark.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;}
  assert.equal(reads,1);assert.equal(await page.locator('#al .assignment-print-row').count(),0);
  await page.evaluate(()=>setNormalAssignmentOperationMode('reassign'));
  assert.equal(await page.locator('.normal-free-row').count(),100);
  await page.evaluate(()=>selectNormalFreeLocations('visible'));
  assert.equal(await page.evaluate(()=>_normalFreeSelectedReassignLocationIds.size),12000);
  await page.evaluate(()=>renderNormalFreeLocationList(1));assert.equal(await page.locator('.normal-free-checkbox:checked').count(),100);
  const loadMs=await page.evaluate(()=>window.loadMs);
  await page.locator('.normal-assignment-sticky-panel').screenshot({path:path.join(output,'v287-toolbar.png')});
  await page.evaluate(()=>document.querySelector('.normal-assignment-sticky-panel').classList.add('is-compact'));
  const layout=await page.evaluate(()=>{
    const panel=document.querySelector('.normal-assignment-sticky-panel');
    const status=panel.querySelector('.annual-job-status-row').getBoundingClientRect(),cancel=Q('normal-cancel-unfinished-btn').getBoundingClientRect();
    return {overlap:status.right>cancel.left+1&&status.left<cancel.right&&status.bottom>cancel.top&&status.top<cancel.bottom,overflow:panel.scrollWidth>panel.clientWidth+2};
  });assert.deepEqual(layout,{overlap:false,overflow:false});
  await page.locator('.normal-assignment-sticky-panel').screenshot({path:path.join(output,'v287-toolbar-compact.png')});
  await page.locator('#normal-cancel-unfinished-btn').click();await page.waitForFunction(()=>document.getElementById('assignment-cancel-v286')?.state);
  await page.selectOption('#cancel-zone-v286','A');await page.getByRole('button',{name:'เลือกทั้งหมดตามตัวกรอง',exact:true}).click();
  assert.equal(await page.evaluate(()=>Q('assignment-cancel-v286').state.selected.size),5999);
  await page.selectOption('#cancel-zone-v286','B');assert.equal(await page.evaluate(()=>Q('assignment-cancel-v286').state.selected.size),0);
  await page.locator('#cancel-search-v286').fill('B-GA-00003-A');await page.locator('.cancel-row-v286 input').check();
  page.once('dialog',d=>d.accept());await page.locator('#cancel-confirm-v286').click();await page.locator('#assignment-cancel-v286').waitFor({state:'detached'});
  await page.waitForFunction(()=>window.menuReady);
  assert.equal((await db.query('select assigned_to from assignments where id=$1',[uuid(10003)])).rows[0].assigned_to,null);
  assert.equal((await db.query('select count(*)::int as n from assignments where assigned_to is null')).rows[0].n,1);
  await page.getByRole('button',{name:'เสร็จสิ้น',exact:true}).click();
  await page.evaluate(()=>setRound1AssignMode('annual'));
  await page.locator('#annual-cancel-unfinished-btn').waitFor({state:'visible'});await page.locator('#annual-cancel-unfinished-btn').click();
  await page.waitForFunction(()=>Q('assignment-cancel-v286')?.state);
  assert.equal(await page.locator('#cancel-search-v286').count(),0);
  assert.equal(await page.locator('#cancel-job-v287 option').count(),2);
  await page.selectOption('#cancel-job-v287',uuid(50));
  assert.equal(await page.locator('.cancel-row-v286 input').count(),2);
  assert.equal(await page.locator('.cancel-row-v286 input:checked').count(),0);
  await page.locator('.cancel-row-v286 input[value="'+uuid(100)+'"]').check();
  await page.screenshot({path:path.join(output,'v287-annual-location-cancel.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#assignment-cancel-v286 .assignment-success-modal').evaluate(el=>el.scrollWidth>el.clientWidth+2),false);
  await page.screenshot({path:path.join(output,'v287-mobile-job-dropdown.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  page.once('dialog',d=>d.accept());await page.locator('#cancel-confirm-v286').click();await page.locator('#assignment-cancel-v286').waitFor({state:'detached'});await page.waitForFunction(()=>window.menuReady);
  assert.equal((await db.query('select location_id from annual_count_job_items')).rows[0].location_id,uuid(101));
  await page.getByRole('button',{name:'เสร็จสิ้น',exact:true}).click();
  await page.evaluate(()=>focusAssignmentStep('assign-step-review',{scroll:false}));
  assert.equal(await page.locator('.assignment-print-row').count(),100);
  await page.locator('#assign-print-all-check').check();const printCount=await page.evaluate(()=>selectedAssignedLocationIds().length);assert.equal(printCount,11998);
  await page.evaluate(()=>renderAssignmentReviewList(1,true));assert.equal(await page.locator('.assignment-print-select:checked').count(),100);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>openAssignmentCancellationV286('normal'));await page.waitForFunction(()=>Q('assignment-cancel-v286')?.state);
  const overflow=await page.locator('#assignment-cancel-v286 .assignment-success-modal').evaluate(el=>el.scrollWidth>el.clientWidth+2);assert.equal(overflow,false);
  await page.screenshot({path:path.join(output,'v287-mobile-cancel.png'),fullPage:true});assert.deepEqual(errors,[]);
  const result={passed:true,locations:12000,cpuThrottle:4,loadMs:Math.round(loadMs),initialBundleRequests:1,normalRowsPerPage:100,reviewRowsPerPage:100,selectAllAcrossPages:true,filterPrunesHiddenSelection:true,normalOnlySelected:true,partialJobLocationOnly:true,printCount,mobileOverflow:overflow,browserErrors:errors};
  fs.writeFileSync(path.join(output,'v287-browser-results.json'),JSON.stringify({...result,jobDropdown:true,compactLayout:layout},null,2));console.log(JSON.stringify(result,null,2));
 }catch(e){if(page){console.error(errors,await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(output,'v286-browser-failure.png'),fullPage:true}).catch(()=>{});}throw e;}
 finally{await browser?.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
