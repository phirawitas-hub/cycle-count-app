'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {productionContext}=require('./production-harness.cjs');
test('legacy save fallback requires the exact missing-function code and function',()=>{
  const ctx=productionContext(['isMissingCountSaveRpcV122']);
  assert.equal(ctx.isMissingCountSaveRpcV122({code:'PGRST202',message:'Could not find save_count_records_v122'}),true);
  assert.equal(ctx.isMissingCountSaveRpcV122({code:'42883',message:'function save_count_records_v122 does not exist'}),true);
  for(const error of [{code:'42501',message:'permission denied for save_count_records_v122'},
    {code:'REQUEST_TIMEOUT',message:'save_count_records_v122 timed out'},
    {code:'PGRST202',message:'could not find other_function'},
    {message:'save_count_records_v122 schema cache failed'}])assert.equal(ctx.isMissingCountSaveRpcV122(error),false);
});
test('a timed-out count write remains uncertain and cannot be treated as a confirmed rejection',async()=>{
  const state={};const ctx=productionContext(['protectCountWriteV256'],{currentCountSaveV256:()=>state});
  const guarded=ctx.protectCountWriteV256(async()=>({error:{code:'REQUEST_TIMEOUT',message:'timeout'}}));
  await guarded([{assignment_id:'a',item_id:'i',round:1,count_qty:0}]);assert.equal(state.uncertain,true);
});
test('current read RPCs retry transient responses, while the new write RPC never retries in fetch',async()=>{
  for(const name of ['get_management_read_bundle_v273','get_wms_read_bundle_v275','get_my_tasks_read_bundle_v270','submit_count_operation_v279']) {
    let calls=0;const ctx=productionContext(['supabaseFetchWithTimeout'],{
      SUPA_URL:'https://example.invalid',SUPABASE_REQUEST_TIMEOUT_MS:2000,_activePageRequestController:new AbortController(),
      navigator:{onLine:true},Request,fetch:async()=>{calls++;return new Response('',{status:calls===1?503:200});},
    });
    const response=await ctx.supabaseFetchWithTimeout(`https://example.invalid/rest/v1/rpc/${name}`,{method:'POST'});
    assert.equal(calls,name.startsWith('get_')?2:1);assert.equal(response.status,name.startsWith('get_')?200:503);
  }
});
