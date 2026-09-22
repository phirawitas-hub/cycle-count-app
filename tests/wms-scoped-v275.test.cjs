'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const {productionContext,extractFunction,deferred}=require('./production-harness.cjs');
const columns=require('./fixtures/management-columns-v273.json'),keys=Object.keys(columns);
const plain=x=>JSON.parse(JSON.stringify(x));
function packet(extra={}){return {schema_version:1,actor_id:'actor',session_id:'session',tab:'wms',revision:10,catalog_revision:2,
  read_contract:'wms-candidates-v1',unchanged:false,delta:false,location_ids:[],rules:{max_rounds:3,repeat_match_action:'recount'},
  row_counts:Object.fromEntries(keys.map(k=>[k,0])),...Object.fromEntries(keys.map(k=>[k,[]])),...extra};}
function context(rpc){return productionContext(['readWmsWireV275','readManagementWireV273','managementErrorV263',
  'dashboardReadErrorV252','validateDashboardRulesV252','decodeManagementWireV273','validateManagementBundleV263',
  'managementCacheKeyV263','mergeManagementBundleV263','cloneManagementBundleV263','isStatementTimeoutErrorV264','loadManagementBundleV263'],{
  me:{id:'actor'},prof:{role:'admin'},APP_BUILD_ID:'v275',MANAGEMENT_ARRAYS_V263:keys,
  _activePageRequestController:new AbortController(),_managementRawCacheV263:new Map(),_managementMetricsV263:[],
  _managementRpcMissingV263:false,updateDashboardTimeoutLoadingV264(){},sb:{rpc}},['MANAGEMENT_COLUMNS_V273']);}
test('WMS uses its own contract and unchanged revision only after a validated candidate read',async()=>{
 const calls=[];let response=packet();const c=context(async(name,params)=>{calls.push({name,params});return {data:response};});
 await c.loadManagementBundleV263('session','wms');response=packet({unchanged:true});
 const value=await c.loadManagementBundleV263('session','wms');
 assert.equal(calls[0].name,'get_wms_read_bundle_v275');assert.equal(calls[0].params.p_since_revision,null);
 assert.equal(calls[1].params.p_since_revision,10);assert.equal(value._unchangedV263,true);
});
test('missing WMS endpoint falls back with null revisions; full-session cache is never sent to candidate endpoint',async()=>{
 const calls=[];let missing=true;const c=context(async(name,params)=>{
  calls.push({name,params});if(name==='get_wms_read_bundle_v275'&&missing)return {error:{code:'PGRST202',message:name+' missing'}};
  const data=packet();if(name!=='get_wms_read_bundle_v275')delete data.read_contract;return {data};
 });
 await c.loadManagementBundleV263('session','wms');
 assert.equal(calls[1].name,'get_management_read_bundle_v273');assert.equal(calls[1].params.p_since_revision,null);
 missing=false;await c.loadManagementBundleV263('session','wms');assert.equal(calls[2].params.p_since_revision,null);
});
test('fallback never merges full-session delta or unchanged metadata with a narrower cache',async()=>{
 const calls=[];let missing=false;const c=context(async(name,params)=>{
  calls.push({name,params});if(missing&&name==='get_wms_read_bundle_v275')return {error:{code:'42883',message:name+' missing'}};
  const data=packet();if(name!=='get_wms_read_bundle_v275')delete data.read_contract;return {data};
 });
 await c.loadManagementBundleV263('session','wms');missing=true;
 await c.loadManagementBundleV263('session','wms');
 assert.equal(calls[1].params.p_since_revision,10);assert.equal(calls[2].params.p_since_revision,null);
 const old=packet();delete old.read_contract;
 assert.throws(()=>c.mergeManagementBundleV263(packet(),{...old,delta:true,location_ids:['a']}),/different management read contracts/);
});
test('WMS errors and invalid contracts fail closed without compatibility retry',async()=>{
 for(const result of [{error:{code:'42501',message:'denied'}},{error:{code:'57014',message:'statement timeout'}},
  {error:{code:'PGRST202',message:'other_rpc missing'}},{data:{...packet(),read_contract:undefined}}]){
  let calls=0;const c=context(async()=>{calls++;return result;});
  if(result.data)await assert.rejects(c.readWmsWireV275({},c._activePageRequestController),/Invalid WMS read contract/);
  else assert.equal(await c.readWmsWireV275({},c._activePageRequestController),result);
  assert.equal(calls,1);
 }
});
test('navigation and role changes prevent fallback from an obsolete WMS request',async()=>{
 for(const change of [c=>{c._activePageRequestController=new AbortController()},c=>{c.prof={role:'counter'}}]){
  const pending=deferred();let calls=0;const c=context(()=>{calls++;return pending.promise});
  const run=c.readWmsWireV275({},c._activePageRequestController);change(c);
  pending.resolve({error:{code:'PGRST202',message:'get_wms_read_bundle_v275 missing'}});
  await assert.rejects(run,e=>e.name==='AbortError');assert.equal(calls,1);
 }
});
test('candidate location leaving queue deletes all child rows; later return adds current records',()=>{
 const c=context(()=>{});const old=packet();old.assignments=[{id:'a',location_id:'loc'},{id:'b',location_id:'other'}];
 old.counts=[{id:'c',assignment_id:'a'}];old.audit=[{id:'n',assignment_id:'a'}];old.approvals=[{id:'v',assignment_id:'a'}];
 old.snapshots=[{id:'s',location_id:'loc'}];old.details=[{id:'d',location_id:'loc'}];
 const gone=c.mergeManagementBundleV263(old,packet({revision:11,delta:true,location_ids:['loc']}));
 assert.deepEqual(plain(gone.assignments),[{id:'b',location_id:'other'}]);
 for(const key of ['counts','audit','approvals','snapshots','details'])assert.equal(gone[key].length,0);
 const incoming=packet({revision:12,delta:true,location_ids:['loc'],assignments:[{id:'a',location_id:'loc',status:'round3_done'}]});
 const back=c.mergeManagementBundleV263(gone,incoming);assert.equal(back.assignments.length,2);
 assert.equal(back.assignments[1].status,'round3_done');
});
test('exact production pending-queue gate excludes completed history under every workflow result',()=>{
 const source=extractFunction('loadSvDashCoreV262').code;
 const loop=source.slice(source.indexOf('  const diffAssignments = [];'),source.indexOf('  let wmsRows = [];'));
 for(const hasDiff of [false,true])for(const status of ['completed','approved','round3_done','pending','future_status']){
  const c=vm.createContext({asgns:[{id:'a',location_id:'l',status,_storedStatus:status}],snapshotsByLocation:{l:[]},sessionCountByAsgn:{},rules:{},
   deriveAssignmentWorkflowStatus:()=>({hasDiff})});
  vm.runInContext(loop+'\nresult=diffAssignments;',c);
  assert.equal(c.result.length,['completed','approved'].includes(status)?0:status==='round3_done'||hasDiff?1:0);
 }
 // Recovery may mark an assignment completed, but cannot turn persisted
 // completed work into a different stored status.
 const recovery=extractFunction('recoverCompletedAssignmentStatusesInMemory').code;
 assert.match(recovery,/assignment\._historicalStatus = 'completed'/);
 assert.doesNotMatch(recovery,/assignment\.status\s*=/);
});
test('SQL preserves whole locations, all approvals, recovery gates and delta tombstones',()=>{
 const dir=path.join(__dirname,'../supabase/migrations');
 const sql=fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(p=>p.endsWith('_wms_scoped_read_v275.sql'))),'utf8');
 assert.match(sql,/SECURITY INVOKER/);assert.match(sql,/SET search_path TO ''/);assert.doesNotMatch(sql,/SECURITY DEFINER/);
 assert.match(sql,/p_tab IS DISTINCT FROM 'wms'/);assert.match(sql,/FROM PUBLIC, anon/);
 assert.match(sql,/a.status IS DISTINCT FROM 'completed'/);assert.match(sql,/OR v.assignment_id IS NOT NULL/);
 assert.match(sql,/JOIN candidate_locations l ON l.location_id=a.location_id/);
 assert.match(sql,/s.onhand_qty IS NULL OR s.onhand_qty=0/);assert.match(sql,/b.old_value IS NULL OR b.old_value !~/);
 assert.match(sql,/'location_ids',COALESCE\(to_jsonb\(changed_locations\)/);
 assert.match(sql,/WHERE p_location_id IS NOT NULL OR/);
 assert.equal((sql.match(/jsonb_agg\(jsonb_build_array/g)||[]).length,16);
 assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE public\.|DELETE FROM)\b/);
});
