'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {productionContext,deferred,syntaxCheck}=require('./production-harness.cjs');
function fixture(before=false,after=true){
 let reads=0,prepares=0;
 const job={key:'u|a',assignmentId:'a',generation:'old',preparedAt:Date.now(),envelope:{scope_token:'original',bundle:{assignment:{session_id:'s'},session:{show_oh:before}}}};
 const state={jobs:[job],operations:[],drafts:[]};
 const q={select:()=>q,eq:(key,value)=>{assert.equal(key,'id');assert.equal(value,'s');return q;},single:async()=>{reads++;return {data:{id:'s',show_oh:after},error:null};}};
 const c=productionContext(['obtainCountJobV280','refreshPreparedOHV288','transientCountConnectionV280','normalCountViewBundleV280'],{
  me:{id:'u'},S:{page:'c-count',aid:'a',_preparedCountV281:'a'},navigator:{onLine:true},_activePageRequestController:{},
  assertCountReadScopeV261:(scope,owner)=>{if(owner!==c.me.id||scope!==c._activePageRequestController)throw Error('stale page');},
  sb:{from:table=>{assert.equal(table,'count_sessions');return q;}},countOutboxV279:()=>({list:async()=>({...state,owner:'u'})}),
  prepareCountJobV281:async()=>{prepares++;return {...job,generation:'new',envelope:{scope_token:'new',bundle:{...job.envelope.bundle,session:{show_oh:after}}}};},
  countOfflineViewV279:job=>({bundle:structuredClone(job.envelope.bundle),pending:[],workflow:{effectiveStatus:'pending'}})
 });return {c,job,state,q,stats:()=>({reads,prepares})};
}
test('prepared next Location follows both OH enable and disable instead of reverting to its cached setting',async()=>{
 for(const before of [false,true]){const s=fixture(before,!before);const job=await s.c.obtainCountJobV280('a');
  assert.equal(job.envelope.bundle.session.show_oh,!before);assert.equal(job.generation,'new');assert.deepEqual(s.stats(),{reads:1,prepares:1});}
});
test('unchanged OH keeps the prepared bundle with only a single-field Session read',async()=>{
 const s=fixture(true,true);assert.equal(await s.c.obtainCountJobV280('a'),s.job);assert.deepEqual(s.stats(),{reads:1,prepares:0});
});
test('a prefetch started before the setting change cannot reintroduce the old OH value',async()=>{
 const s=fixture();const fresh=s.c.prepareCountJobV281;let calls=0;
 s.c.prepareCountJobV281=async()=>++calls===1?s.job:fresh();
 assert.equal((await s.c.obtainCountJobV280('a')).envelope.bundle.session.show_oh,true);assert.equal(calls,2);
});
test('OH refresh never rewrites pending UUID, tokens, quantities or draft generation; display uses current value',async()=>{
 for(const field of ['operations','drafts']){const s=fixture();
  s.state[field]=field==='operations'?[{jobKey:s.job.key,state:'retry',key:'original-uuid',request:{scope_token:'original',record:{count_qty:0}}}]:[{jobKey:s.job.key,generation:'old',value:{qty:'0'}}];
  const before=JSON.stringify(s.state);const job=await s.c.obtainCountJobV280('a');
  s.c._countContinuityV280={owner:'u',aid:'a',job};const bundle=await s.c.normalCountViewBundleV280('a');
  assert.equal(bundle.session.show_oh,true);assert.equal(JSON.stringify(s.state),before);assert.equal(job.generation,'old');assert.equal(s.stats().prepares,0);
 }
});
test('offline and prefetch remain network-free; transient failures retain prepared work',async()=>{
 for(const mode of ['offline','prefetch','timeout']){const s=fixture();
  if(mode==='offline')s.c.navigator.onLine=false;
  if(mode==='timeout')s.q.single=async()=>({error:{code:'REQUEST_TIMEOUT'}});
  assert.equal(await s.c.obtainCountJobV280('a',{prefetch:mode==='prefetch'}),s.job);assert.equal(s.stats().prepares,0);
 }
});
test('authorization, malformed Session and changed account/page cannot fall back to stale OH',async()=>{
 for(const result of [{error:{code:'42501'}},{data:null},{data:{id:'wrong',show_oh:true}},{data:{id:'s',show_oh:null}}]){
  const s=fixture();s.q.single=async()=>result;await assert.rejects(s.c.obtainCountJobV280('a'));
 }
 const s=fixture(),gate=deferred();s.q.single=()=>gate.promise;const pending=s.c.obtainCountJobV280('a');
 await new Promise(r=>setTimeout(r,0));s.c.me={id:'other'};gate.resolve({data:{id:'s',show_oh:true}});await assert.rejects(pending,/stale page/);
});
test('toggle success requires database to return the selected Session and persisted OH',async()=>{
 for(const mode of ['ok','zero-rows','mismatch','throw']){
  const option={value:'s',dataset:{showOh:'false'}},toggle={checked:true},paints=[],alerts=[],toasts=[];
  const select={value:'s',options:[option]};const q={update:()=>q,eq:()=>q,select:()=>q,single:async()=>{if(mode==='throw')throw Error('network');return {data:mode==='zero-rows'?null:{id:'s',show_oh:mode==='mismatch'?false:true},error:null};}};
  const c=productionContext(['toggleOH'],{Q:id=>id==='as-sess'?select:toggle,_ohSyncRequestId:0,sb:{from:()=>q},paintOHToggle:(...v)=>paints.push(v),alert:v=>alerts.push(v),showActionSuccessToast:v=>toasts.push(v)});
  await c.toggleOH();assert.equal(toasts.length,mode==='ok'?1:0);assert.equal(alerts.length,mode==='ok'?0:1);assert.equal(option.dataset.showOh,mode==='ok'?'true':'false');assert.deepEqual(paints.at(-1),[mode==='ok',false]);
 }
});
test('all inline scripts parse',()=>{assert.ok(syntaxCheck().length);});
