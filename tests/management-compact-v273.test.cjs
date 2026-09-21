'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {productionContext, deferred} = require('./production-harness.cjs');
const columns = require('./fixtures/management-columns-v273.json');
const keys = Object.keys(columns);
const plain = value => JSON.parse(JSON.stringify(value));
function packed() {
  return {schema_version:1,actor_id:'actor',session_id:'session',tab:'summary',revision:10,
    catalog_revision:2,unchanged:false,delta:false,location_ids:[],rules:{max_rounds:3,repeat_match_action:'recount'},
    wire_format:'columns-v1',columns:plain(columns),row_counts:Object.fromEntries(keys.map(k=>[k,0])),
    ...Object.fromEntries(keys.map(k=>[k,[]]))};
}
function ctx(extra={}, loader=false) {
  return productionContext(['managementErrorV263','decodeManagementWireV273','readManagementWireV273',
    ...(loader ? ['dashboardReadErrorV252','validateDashboardRulesV252','validateManagementBundleV263',
      'managementCacheKeyV263','mergeManagementBundleV263','cloneManagementBundleV263',
      'isStatementTimeoutErrorV264','loadManagementBundleV263'] : [])], {
    MANAGEMENT_ARRAYS_V263:keys, me:{id:'actor'},prof:{role:'admin'},APP_BUILD_ID:'v273-test',
    _activePageRequestController:new AbortController(), _managementRawCacheV263:new Map(),
    _managementMetricsV263:[],_managementRpcMissingV263:false,updateDashboardTimeoutLoadingV264(){},
    sb:{rpc:async()=>({data:packed(),error:null})},...extra}, ['MANAGEMENT_COLUMNS_V273']);
}
const invalid = e => e.code === 'MANAGEMENT_READ_INVALID';
test('column contract in actual app equals reviewed SQL wire schema',()=> {
  const c=ctx();
  const p=packed();
  for(const key of keys) {
    const values=columns[key].map((name,i)=>name==='id' ? key+'-id' : [null,0,false,'ข้อความทดสอบ',-1.25,{nested:['a',null,4]},'2026-09-21T08:00:00+00:00'][i%7]);
    p[key]=[values];p.row_counts[key]=1;
  }
  const before=plain(p),result=c.decodeManagementWireV273(p);
  for(const key of keys) assert.deepEqual(plain(result[key][0]),Object.fromEntries(columns[key].map((name,i)=>[name,p[key][0][i]])));
  assert.deepEqual(p,before);assert.equal(result.wire_format,undefined);assert.equal(result.columns,undefined);
  assert.deepEqual(plain(result.rules),p.rules);assert.equal(result.revision,10);
});
test('decode rejects truncated rows, missing sets, column reorder, unknown formats and prototype keys',()=> {
  const mutations=[p=>{p.wire_format='columns-v2';},p=>{delete p.columns.items;},
    p=>{p.columns.items.reverse();},p=>{p.columns.items[1]='__proto__';},
    p=>{p.columns.extra=['id'];},p=>{p.items=null;},p=>{p.row_counts.items=1;},
    p=>{p.items=[['id']];p.row_counts.items=1;},
    p=>{p.items=[new Array(columns.items.length)];p.row_counts.items=1;},
    p=>{p.unchanged=true;}];
  for(const change of mutations){const p=packed();change(p);assert.throws(()=>ctx().decodeManagementWireV273(p),invalid);}
});
test('old object response and tiny unchanged metadata remain compatible',()=> {
  const c=ctx(),p={schema_version:1,unchanged:true,revision:10};
  assert.equal(c.decodeManagementWireV273(p),p);
  const old={schema_version:1,unchanged:false,items:[{id:'i'}]};
  assert.equal(c.decodeManagementWireV273(old),old);
});
test('all four targeted tabs use compact endpoint; other menus retain original endpoint',async()=> {
  const calls=[];const c=ctx({sb:{rpc:async(name,params)=>{calls.push({name,params});return {data:packed(),error:null};}}});
  for(const tab of ['summary','team','layout','wms','executive','tracker','log','detail','variance']) {
    const params={p_tab:tab,p_since_revision:10,p_location_id:'loc'};
    await c.readManagementWireV273(tab,params,c._activePageRequestController);
    assert.equal(calls.at(-1).name,['summary','team','layout','wms'].includes(tab)?'get_management_read_bundle_v273':'get_management_read_bundle_v263');
    assert.equal(calls.at(-1).params,params);
  }
});
test('only genuinely missing compact RPC uses old endpoint once; denial and timeout do not',async()=> {
  for(const error of [{code:'PGRST202',message:'get_management_read_bundle_v273 missing'},
    {code:'42501',message:'permission denied'},{code:'57014',message:'statement timeout'},
    {code:'PGRST202',message:'some_other_function missing'}]) {
    const calls=[];const c=ctx({sb:{rpc:async(name)=>{calls.push(name);return {data:null,error};}}});
    await c.readManagementWireV273('summary',{},c._activePageRequestController);
    assert.equal(calls.length,error.message==='get_management_read_bundle_v273 missing'?2:1);
    if(calls.length===2)assert.equal(calls[1],'get_management_read_bundle_v263');
  }
});
test('navigation change prevents compatibility retry from obsolete request',async()=> {
  const pending=deferred();let calls=0;const c=ctx({sb:{rpc:()=>{calls++;return pending.promise;}}});
  const result=c.readManagementWireV273('summary',{},c._activePageRequestController);
  c._activePageRequestController=new AbortController();
  pending.resolve({data:null,error:{code:'PGRST202',message:'get_management_read_bundle_v273 missing'}});
  await assert.rejects(result,e=>e.name==='AbortError');assert.equal(calls,1);
});
test('actual loader decodes before validation/cache and still rejects wrong actors and incomplete data',async()=> {
  let response=packed();const c=ctx({sb:{rpc:async()=>({data:response,error:null})}},true);
  const result=await c.loadManagementBundleV263('session','summary');
  assert.equal(result.revision,10);assert.equal(c._managementRawCacheV263.size,1);
  const cached=c._managementRawCacheV263.values().next().value;
  for(const mutate of [p=>{p.actor_id='other';},p=>{p.session_id='other';},p=>{p.row_counts.counts=2;},
    p=>{p.assignments=[columns.assignments.map(k=>({id:'a',session_id:'other',location_id:'l'}[k]??null))];p.row_counts.assignments=1;}]) {
    response=packed();mutate(response);
    await assert.rejects(c.loadManagementBundleV263('session','summary'),invalid);
    assert.equal(c._managementRawCacheV263.values().next().value,cached);
  }
});
test('large compact set returns all rows and preserves order/zero/null without a 1000-row cap',()=> {
  const p=packed();p.items=Array.from({length:12000},(_,i)=>['i'+i,'SKU'+i,i===0?'ภาษาไทย':null,'EA',null]);p.row_counts.items=12000;
  const result=ctx().decodeManagementWireV273(p);
  assert.equal(result.items.length,12000);assert.equal(result.items[11999].id,'i11999');assert.equal(result.items[0].description,'ภาษาไทย');
});
test('compact location delta removes deleted assignments while retaining other locations',async()=> {
  let response=packed();
  response.assignments=['a','b'].map(id=>columns.assignments.map(k=>({id,session_id:'session',location_id:id}[k]??null)));
  response.row_counts.assignments=2;
  const c=ctx({sb:{rpc:async()=>({data:response,error:null})}},true);
  await c.loadManagementBundleV263('session','summary');
  response=packed();response.revision=11;response.delta=true;response.location_ids=['a'];
  const result=await c.loadManagementBundleV263('session','summary');
  assert.deepEqual(plain(result.assignments.map(r=>r.id)),['b']);
  assert.equal(result.row_counts.assignments,1);assert.deepEqual(plain(result._changedLocationIdsV263),['a']);
});
test('compact full read followed by unchanged metadata reuses only decoded verified cache',async()=> {
  let response=packed();const calls=[];
  const c=ctx({sb:{rpc:async(name,params)=>{calls.push(params);return {data:response,error:null};}}},true);
  await c.loadManagementBundleV263('session','summary');
  response={schema_version:1,actor_id:'actor',session_id:'session',tab:'summary',revision:10,catalog_revision:2,unchanged:true};
  const result=await c.loadManagementBundleV263('session','summary',{metadataWhenUnchanged:true});
  assert.equal(result._unchangedV263,true);assert.equal(calls.length,2);
  assert.equal(calls[1].p_since_revision,10);assert.equal(calls[1].p_since_catalog,2);
});
test('migration preserves invoker security and avoids per-snapshot correlated baseline reads',()=> {
  const dir=path.join(__dirname,'../supabase/migrations');
  const sql=fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(p=>p.endsWith('_management_compact_read_v273.sql'))),'utf8');
  assert.match(sql,/SECURITY INVOKER/);assert.doesNotMatch(sql,/SECURITY DEFINER/);
  assert.match(sql,/REVOKE ALL[\s\S]*FROM PUBLIC, anon/);
  assert.match(sql,/zero_baselines AS MATERIALIZED/);assert.match(sql,/JOIN counted_assignments/);
  assert.match(sql,/wms_import_count_baseline/);assert.match(sql,/btrim\(b.old_value\)=''/);
  assert.equal((sql.match(/jsonb_agg\(jsonb_build_array/g)||[]).length,16);
});
