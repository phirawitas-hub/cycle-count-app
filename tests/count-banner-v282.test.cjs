'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {productionContext}=require('./production-harness.cjs');
function setup(){
  const nodes=new Map();
  const element=()=>({style:{},children:[],setAttribute(){},replaceChildren(...rows){this.children=rows},appendChild(row){this.children.push(row)},remove(){nodes.delete(this.id)},prepend(row){nodes.set(row.id,row);row.parentElement=this}});
  const host=element(),doc={getElementById:id=>nodes.get(id)||null,querySelector:()=>host,body:host,createElement:element,createTextNode:text=>({text})};
  const c=productionContext(['paintCountConnectionV280'],{me:{id:'u'},S:{page:'c-count'},navigator:{onLine:true},document:doc,readyCountJobsV281:()=>new Map(),showCountPendingV280:()=>{}},['_countNormalStorageErrorV280','_countPrefetchPlanV281','_countContinuityV280']);
  return {c,nodes,state:{owner:'u',jobs:[],drafts:[],operations:[]}};
}
test('online counting, pending sends and drafts do not show the connection banner',()=>{
  const s=setup();s.c.paintCountConnectionV280(s.state);assert.equal(s.nodes.size,0);
  s.state.operations=[{state:'pending'}];s.c.paintCountConnectionV280(s.state);assert.equal(s.nodes.size,0);
  s.state.jobs=[{key:'j',generation:'g'}];s.state.drafts=[{jobKey:'j',generation:'g',value:{qty:'0'}}];
  s.c.paintCountConnectionV280(s.state);assert.equal(s.nodes.size,0);
});
test('offline shows banner; reconnect hides it without discarding pending work',()=>{
  const s=setup();s.state.operations=[{state:'pending'}];s.c.navigator.onLine=false;s.c.paintCountConnectionV280(s.state);
  assert.equal(s.nodes.has('count-sync-banner-v280'),true);
  s.c.navigator.onLine=true;s.c.paintCountConnectionV280(s.state);assert.equal(s.nodes.has('count-sync-banner-v280'),false);assert.equal(s.state.operations.length,1);
});
test('Wi-Fi without working internet shows the banner until retry recovers',()=>{
  const s=setup();s.state.operations=[{state:'retry',error:'Failed to fetch'}];s.c.paintCountConnectionV280(s.state);
  assert.equal(s.nodes.has('count-sync-banner-v280'),true);
  s.state.operations[0].state='synced';s.c.paintCountConnectionV280(s.state);assert.equal(s.nodes.size,0);
});
test('online rejection/auth/invalid receipt remains actionable without the connectivity banner',()=>{
  for(const op of [{state:'review'},{state:'auth'},{state:'retry',error:'Invalid receipt'}]){
    const s=setup();s.state.operations=[op];s.c.paintCountConnectionV280(s.state);
    assert.equal(s.nodes.has('count-sync-banner-v280'),false);assert.equal(s.nodes.has('count-sync-problem-v282'),true);
    s.state.operations[0].state='synced';s.c.paintCountConnectionV280(s.state);assert.equal(s.nodes.size,0);
  }
});
