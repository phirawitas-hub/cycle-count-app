'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {productionContext,extractFunction}=require('./production-harness.cjs');
const previous=require('./fixtures/read-path-v273.json');
const plain=x=>JSON.parse(JSON.stringify(x));

function teamContext(){
 const ctx=productionContext(['buildTeamProgressViewV274','assignmentPhysicalCountFinished','assignmentPendingVarianceReview'],{
  sortRowsByLocation:(rows,get)=>[...rows].sort((a,b)=>String(get(a)).localeCompare(String(get(b)),undefined,{numeric:true})),
  uiCopy:x=>x,escapeWmsText:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 });
 vm.runInContext('function oldTeam(dashboardAssignments){'+previous.teamBody+'}',ctx);
 return ctx;
}
test('Team extracted renderer equals V2.73 HTML and complete details, including duplicate assignee names',()=>{
 const ctx=teamContext();
 for(const n of [0,1,13,1994]){
  const rows=Array.from({length:n},(_,i)=>({id:String(i),status:['pending','completed','round3_done','approved'][i%4],
   _storedStatus:i%4===2?'round3_done':undefined,profiles:{name:i%3?'ทีม A':'<ทีม B>'},locations:{code:`B-${n-i}`,zone:'Z',row_no:i%5,level:'A'}}));
  const before=JSON.stringify(rows);
  const old=ctx.oldTeam(rows),now=ctx.buildTeamProgressViewV274(rows);
  assert.equal(now.html,old.html);assert.deepEqual(plain(now.teamDetailGroupsV272),plain(old.teamDetailGroupsV272));
  assert.equal(now.teamDetailGroupsV272.flat().length,n);assert.equal(JSON.stringify(rows),before);
 }
});

test('Team physical-finished and historic pending review are unchanged',()=>{
 const ctx=teamContext();
 const rows=[
  {id:'a',status:'completed',_storedStatus:'round3_done',_workflow:{itemStatuses:['OK']}},
  {id:'b',status:'approved',_storedStatus:'approved',_workflow:{itemStatuses:['Diff']}},
  {id:'c',status:'in_progress',_workflow:{itemStatuses:['OK','PENDING']}},
 ].map((x,i)=>({...x,profiles:{name:'เดียวกัน'},locations:{code:`L${i}`}}));
 assert.equal(ctx.buildTeamProgressViewV274(rows).html,ctx.oldTeam(rows).html);
 assert.match(ctx.buildTeamProgressViewV274(rows).html,/2\/3/);
 assert.match(ctx.buildTeamProgressViewV274(rows).html,/1 DIFF/);
});

test('Layout returned HTML is unchanged and unused legacy renderers are never called',()=>{
 let legacy=0;
 const zone={id:'z',name:'Zone',elements:[{type:'rack',id:'r'},{type:'object',id:'o'}]};
 const runtime={config:{zones:[zone],isMaster:true,masterRevision:2},completeness:100,unmatchedImported:[],statusCounts:{},
  totalLayout:3,matched:3,missingImport:[],totalImported:3};
 for(const s of ['not_imported','imported','counting','history_review','variance','wms_pending','completed'])runtime.statusCounts[s]=s==='completed'?3:0;
 const ctx=productionContext(['warehouseLayoutViewHtml','warehouseLayoutIndexRacksV274'],{
  S:{},prof:{role:'supervisor'},warehouseLocationKey:x=>x,uiLocale:()=> 'en-US',escapeWmsText:x=>String(x),
  warehouseLayoutRuntimeForZone:r=>r,navIconSvg:()=>'<icon>',warehouseLayoutLiveStatusHtml:()=>'<live>',
  warehouseLayoutEmptyHtml:()=>'<empty>',warehouseLayoutRackHtml:()=>{legacy++;return '<legacy-rack>'},
  warehouseLayoutObjectHtml:()=>{legacy++;return '<legacy-object>'},warehouseLayoutKpiHtml:(...a)=>JSON.stringify(a),
  planLocationMetrics:()=>({countPercent:100,plan:3,counted:3}),warehouseLayoutMatrixZoneHtml:()=>'<matrix>',warehouseLayoutLegendHtml:()=>'<legend>',
 });
 vm.runInContext(previous.warehouseLayoutViewHtml.replace('function warehouseLayoutViewHtml','function oldLayout'),ctx);
 const old=ctx.oldLayout(runtime);assert.equal(legacy,2);legacy=0;
 assert.equal(ctx.warehouseLayoutViewHtml(runtime),old);assert.equal(legacy,0);
 const empty={...runtime,config:{zones:[]}};assert.equal(ctx.warehouseLayoutViewHtml(empty),ctx.oldLayout(empty));
});

test('metadata shortcut candidate is actor/role/session/date/tab/revision scoped',()=>{
 const cache={userId:'a',role:'admin',sessionId:'s',dateFrom:'',dateTo:'',views:{team:'html'},_revisionV263:0,_catalogRevisionV263:3};
 const ctx=productionContext(['hasManagementViewCandidateV274'],{me:{id:'a'},prof:{role:'admin'},selectedDateFrom:'',selectedDateTo:'',
  _dashboardViewCacheStore:new Map([['key',cache]]),dashboardViewCacheKey:()=> 'key'});
 assert.equal(ctx.hasManagementViewCandidateV274('team','s'),true);
 for(const patch of [{userId:'b'},{role:'counter'},{sessionId:'b'},{dateFrom:'other'},{dateTo:'other'},{views:{}},{_revisionV263:null},{_catalogRevisionV263:-1}]){
  ctx._dashboardViewCacheStore.set('key',{...cache,...patch});assert.equal(ctx.hasManagementViewCandidateV274('team','s'),false);
 }
 ctx._dashboardViewCacheStore.set('key',cache);
 for(const tab of ['wms','layout','tracker','detail'])assert.equal(ctx.hasManagementViewCandidateV274(tab,'s'),false);
});

test('Layout rack index preserves zone-specific cells, rack-only totals and source ordering',()=>{
 const ctx=productionContext(['warehouseLayoutIndexRacksV274','warehouseLayoutRackLocationsV274','warehouseLayoutRackSummary'],{warehouseLayoutCellType:x=>x});
 vm.runInContext(previous.warehouseLayoutRackSummary.replace('function warehouseLayoutRackSummary','function oldSummary'),ctx);
 const locations=[{zoneId:'z1',rackId:'same',code:'a'},{zoneId:'z2',rackId:'same',code:'b'},{zoneId:'z1',rackId:'same',code:'c'},{zoneId:'z1',rackId:'other',code:'d'}];
 const runtime={generatedLocations:locations,detailsByCode:new Map([['a',{status:'completed'}],['b',{status:'history_review'}],['c',{status:'variance'}]])};
 const rack={id:'same',bayCount:3,bayStart:1,skipBays:[3],levels:['A','B'],excludedCells:[{cellType:'pillar'}]};
 const indexed=ctx.warehouseLayoutIndexRacksV274(runtime);
 assert.equal(runtime._rackIndexV274,undefined);
 assert.deepEqual(plain(ctx.warehouseLayoutRackLocationsV274(indexed,'same','z1')),locations.filter(x=>x.rackId==='same'&&x.zoneId==='z1'));
 assert.deepEqual(plain(ctx.warehouseLayoutRackLocationsV274(indexed,'same')),locations.filter(x=>x.rackId==='same'));
 assert.deepEqual(plain(ctx.warehouseLayoutRackSummary(rack,indexed)),plain(ctx.oldSummary(rack,runtime)));
 assert.deepEqual(plain(ctx.warehouseLayoutRackSummary(rack,runtime)),plain(ctx.oldSummary(rack,runtime)));
 const changed={...runtime,generatedLocations:[...locations,{zoneId:'z1',rackId:'same',code:'new'}]};
 assert.equal(ctx.warehouseLayoutRackLocationsV274(ctx.warehouseLayoutIndexRacksV274(changed),'same','z1').length,3);
 assert.equal(ctx.warehouseLayoutRackLocationsV274(indexed,'same','z1').length,2);
});

test('cold full read skips metadata; fallback captures before-version before any paged rows',async()=>{
 for(const fallback of [false,true]){
  const events=[],stop=new Error('end-of-test-boundary');
  const query={select(){return this},order(){return this},eq(){return this},then(resolve){resolve({data:[{id:'s',name:'Session'}],error:null})}};
  const ctx=productionContext(['loadSvDashCoreV262'],{
   prof:{role:'admin'},me:{id:'a'},S:{page:'sv-dash',_dashTab:'team',_dashSid:'s'},_dashTab:'team',_activePageRequestController:new AbortController(),
   sb:{from:()=>query},readRememberedDashboardSession:()=> 's',resolveDashboardSessionId:()=> 's',rememberDashboardSession(){},
   sessionOptionLabel:()=> 'Session',escapeWmsText:x=>x,uiCopy:x=>x,
   hasManagementViewCandidateV274:()=>false,paintVerifiedManagementCacheV263:()=>false,
   readManagementViewVersionV271:async()=>{events.push('metadata');return {revision:1}},
   loadManagementBundleV263:async()=>{events.push('bundle');return fallback?null:{}},applyManagementSettingsV263(){},
   managementRowsV263:()=>{events.push('rows');throw stop},
  });
  await assert.rejects(ctx.loadSvDashCoreV262(),e=>e===stop);
  assert.deepEqual(events,fallback?['bundle','metadata','rows']:['bundle','rows']);
 }
});

test('Team early exit follows recovery and workflow and precedes unrelated WMS calculations',()=>{
 const code=extractFunction('loadSvDashCoreV262').code;
 const start=code.indexOf("  if (tab === 'team') {");
 assert.ok(start>code.indexOf('recoverCompletedAssignmentStatusesInMemory'));
 assert.ok(start>code.indexOf('assignment.status = workflow.effectiveStatus'));
 assert.ok(start<code.indexOf('const diffAssignments'));
 const early=code.slice(start,code.indexOf('const actualCountersByAssignment',start));
 assert.match(early,/verifyManagementFallbackV271/);assert.match(early,/if \(isStaleLoad\(\)\) return/);
 assert.ok(early.indexOf('verifyManagementFallback')<early.indexOf('paintManagementTab'));
 assert.ok(code.indexOf("if (tab === 'layout') {\n    const warehouseLayoutAssignments")>=0 || /if \(tab === 'layout'\) \{\r?\n    const warehouseLayoutAssignments/.test(code));
 assert.doesNotMatch(code,/rawCountByAssignment|sessionWorkflowByAssignment/);
});
