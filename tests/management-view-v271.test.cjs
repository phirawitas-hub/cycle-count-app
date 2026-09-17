'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {productionContext,deferred,html}=require('./production-harness.cjs');
const payload=(extra={})=>({schema_version:1,actor_id:'a',actor_role:'admin',session_id:'s',tab:'team',unchanged:true,revision:5,catalog_revision:2,...extra});
function context(extra={}) {
 return productionContext(['managementErrorV263','readManagementViewVersionV271','verifyManagementFallbackV271','paintVerifiedManagementCacheV263'],{
  _managementViewRpcMissingV271:false,_activePageRequestController:new AbortController(),
  me:{id:'a'},prof:{role:'admin'},S:{page:'sv-dash',_dashSid:'s',_dashTab:'team'},_dashTab:'team',
  selectedDateFrom:'',selectedDateTo:'',_dashboardViewCacheStore:new Map(),
  dashboardViewCacheKey:()=> 'key',paintDashboardView:()=>true,
  sb:{rpc:async()=>({data:payload(),error:null})},...extra,
 });
}
test('metadata RPC verifies exact actor, role, Session, tab and complete revision contract',async()=>{
 const ctx=context(); assert.equal((await ctx.readManagementViewVersionV271('s','team'))._unchangedV263,true);
 for(const bad of [{actor_id:'b'},{actor_role:'counter'},{session_id:'other'},{tab:'summary'},{unchanged:false},{revision:null},{catalog_revision:-1}]) {
  ctx.sb.rpc=async()=>({data:payload(bad),error:null});
  await assert.rejects(ctx.readManagementViewVersionV271('s','team'),e=>e.code==='MANAGEMENT_READ_INVALID');
 }
});
test('metadata denial/timeout cannot reuse HTML; only missing exact RPC uses old complete path',async()=>{
 const ctx=context();
 for(const code of ['42501','57014']) {
  ctx.sb.rpc=async()=>({data:null,error:{code,message:'read failed'}});
  await assert.rejects(ctx.readManagementViewVersionV271('s','team'),e=>e.code===code);
  assert.equal(ctx._managementViewRpcMissingV271,false);
 }
 ctx.sb.rpc=async()=>({data:null,error:{code:'PGRST202',message:'get_management_view_version_v271 missing'}});
 assert.equal(await ctx.readManagementViewVersionV271('s','team'),null);
 assert.equal(ctx._managementViewRpcMissingV271,true);
});
test('late metadata is discarded on navigation, Session, tab, user or role change',async()=>{
 for(const change of [c=>c.S.page='c-tasks',c=>c.S._dashSid='other',c=>c.S._dashTab='summary',c=>c.me.id='b',c=>c.prof.role='counter',c=>c._activePageRequestController=new AbortController()]) {
  const wait=deferred(),ctx=context({sb:{rpc:()=>wait.promise}});
  const pending=ctx.readManagementViewVersionV271('s','team');change(ctx);wait.resolve({data:payload(),error:null});
  await assert.rejects(pending,e=>e.name==='AbortError');
 }
});
test('complete fallback can be certified only if all reads were between identical revisions',async()=>{
 const ctx=context();assert.equal((await ctx.verifyManagementFallbackV271(payload(),'s','team')).revision,5);
 for(const field of ['revision','catalog_revision']) {
  ctx.sb.rpc=async()=>({data:payload({[field]:10}),error:null});
  await assert.rejects(ctx.verifyManagementFallbackV271(payload(),'s','team'),e=>e.code==='DASHBOARD_SCOPE_CHANGED');
 }
 assert.equal(await ctx.verifyManagementFallbackV271(null,'s','team'),null);
});
test('verified fallback HTML can be reused without a cached large raw dataset',async()=>{
 const ctx=context();
 ctx._dashboardViewCacheStore.set('key',{userId:'a',role:'admin',sessionId:'s',dateFrom:'',dateTo:'',views:{team:'complete'},_revisionV263:5,_catalogRevisionV263:2});
 const version=await ctx.readManagementViewVersionV271('s','team');
 assert.equal(ctx.paintVerifiedManagementCacheV263(version,'team','s','fresh options'),true);
 assert.equal(ctx.paintVerifiedManagementCacheV263({...version,revision:6},'team','s','fresh options'),false);
});
test('editable/operational tabs never use the static view metadata shortcut',async()=>{
 const ctx=context({sb:{rpc:()=>{throw Error('must not call')}}});
 for(const tab of ['wms','tracker','layout','detail']) assert.equal(await ctx.readManagementViewVersionV271('s',tab),null);
});
test('fallback final verification precedes view-cache publication in production loader',()=>{
 const begin=html.indexOf('async function loadSvDashCoreV262()');
 const end=html.indexOf('function toggleCounterDetail',begin);
 const loader=html.slice(begin,end);
 assert.ok(loader.indexOf('readManagementViewVersionV271(curSid,tab)') < loader.indexOf('loadManagementBundleV263(curSid,tab)'));
 assert.ok(loader.indexOf('verifyManagementFallbackV271(viewVersionV271,curSid,tab)') < loader.indexOf('_dashboardViewCache = {'));
 assert.match(loader,/_revisionV263:managementBundle\?\.revision \?\? fallbackVersionV271\?\.revision/);
});

test('required fallback arrays fail closed on errors, partial failure or malformed data',()=>{
 const ctx=productionContext(['managementErrorV263','requireManagementRowsV271']);
 assert.doesNotThrow(()=>ctx.requireManagementRowsV271({data:[],error:null},{data:[{id:'1'}],error:null}));
 for(const code of ['42501','57014','PGRST301']) {
  const error={code,message:'read failed'};
  assert.throws(()=>ctx.requireManagementRowsV271({data:[],error:null},{data:[{id:'partial'}],error}),e=>e===error);
 }
 for(const data of [null,undefined,{},'']) {
  assert.throws(()=>ctx.requireManagementRowsV271({data,error:null}),e=>e.code==='MANAGEMENT_READ_INVALID');
 }
});

test('production loader guards every formerly swallowed required fallback failure before publishing',()=>{
 const {code:loader}=require('./production-harness.cjs').extractFunction('loadSvDashCoreV262');
 for(const guard of [
  'requireManagementRowsV271(countResult,snapshotResult,detailResult,annualJobsResult,annualJobItemsResult,varianceApprovalResult,baselineAuditResult,paperResult)',
  'requireManagementRowsV271(itemMasterResult,foundIssueResult)',
  'requireManagementRowsV271(foundMasterResult)',
  'requireManagementRowsV271({data:itemsData,error:itemsError},{data:approversData,error:approversError},{data:wmsNoteRows,error:wmsNoteError})',
  'requireManagementRowsV271({data:pendingItems,error:pendingItemsError})',
  'if (vaError) throw vaError;',
 ]) {
  assert.ok(loader.includes(guard),guard);
  assert.ok(loader.indexOf(guard)<loader.indexOf('_dashboardViewCache = {'),guard);
 }
 assert.match(loader,/data: pendingItems, error:pendingItemsError/);
 assert.match(loader,/data: itemsData, error:itemsError/);
 assert.match(loader,/data: approversData, error:approversError/);
});

test('pending found items are paged and fallback ordering has unique tie breakers',()=>{
 const {code:loader}=require('./production-harness.cjs').extractFunction('loadSvDashCoreV262');
 assert.match(loader,/fetchPagedSupabaseRows\('found_items',[\s\S]*?eq\('status','pending_review'\)[\s\S]*?order\('discovered_at',\{ ascending:true \}\)\.order\('id'\)/);
 assert.match(loader,/eq\('source_type','paper_form'\)\.order\('id'\)/);
 assert.match(loader,/eq\('session_id',curSid\)\.order\('discovered_at',\{ ascending:true \}\)\.order\('id'\)/);
 assert.match(loader,/allApproverIds,query => query\.order\('id'\)/);
 assert.match(loader,/allItemIds,query => query\.order\('id'\)/);
 assert.match(loader,/foundOnlyCodes,query => query\.order\('item_code'\)/);
});

test('actual loader refuses failed paper read before any fallback view can be cached',async()=>{
 const {productionContext}=require('./production-harness.cjs');
 const ok={data:[],error:null};
 const failure={code:'57014',message:'paper timeout'};
 const query={select(){return this},order(){return this},then(resolve){resolve({data:[{id:'s',name:'Session'}],error:null})}};
 const ctx=productionContext(['loadSvDashCoreV262','requireManagementRowsV271','managementErrorV263'],{
  prof:{role:'admin'},me:{id:'a'},S:{page:'sv-dash',_dashTab:'executive',_dashSid:'s'},_dashTab:'executive',
  _activePageRequestController:new AbortController(),sb:{from:()=>query},
  readRememberedDashboardSession:()=> 's',resolveDashboardSessionId:()=> 's',rememberDashboardSession(){},
  sessionOptionLabel:()=> 'Session',escapeWmsText:x=>x,uiCopy:x=>x,
  readManagementViewVersionV271:async()=>payload({tab:'executive'}),paintVerifiedManagementCacheV263:()=>false,
  loadManagementBundleV263:async()=>null,
  managementRowsV263:async(_bundle,key)=>key==='paper'?{data:null,error:failure}:ok,
  dashboardBundleRowsV252:async()=>ok,loadDashboardReadBundleV252:async()=>null,loadDashboardRulesV252:async()=>({}),
  assignmentPhysicalCountFinished:()=>false,assignmentPendingVarianceReview:()=>false,
  _dashboardViewCache:null,_dashboardViewCacheStore:new Map(),
 });
 await assert.rejects(ctx.loadSvDashCoreV262(),e=>e===failure);
 assert.equal(ctx._dashboardViewCache,null);
 assert.equal(ctx._dashboardViewCacheStore.size,0);
});
