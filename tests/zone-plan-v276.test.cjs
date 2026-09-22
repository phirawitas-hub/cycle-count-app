'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {productionContext}=require('./production-harness.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
function ctx(extra={}){return productionContext(['buildSummaryZoneProgressV276','assignmentPhysicalCountFinished','computeItemStatus',
 'summaryZonePlanModeV276','setSummaryZonePlanModeV276','dashboardViewCacheKey'],{
  planLocationForZone:zone=>zone==='A'?100:200,varianceReviewState:row=>row.review_status||'confirmed',
  me:{id:'admin'},prof:{role:'admin'},S:{page:'sv-dash',_dashTab:'summary'},_dashTab:'summary',APP_BUILD_ID:'test',
  selectedDateFrom:'',selectedDateTo:'',localStorage:{getItem:()=>null,setItem(){}},...extra});}
test('import plan counts unique Location + Item pairs, not locations or count rounds',()=>{
 const c=ctx(),a=[{id:'a',location_id:'l',status:'in_progress',locations:{zone:'A'}}];
 const s=Array.from({length:5},(_,i)=>({location_id:'l',item_id:'i'+i,onhand_qty:10}));
 const rows=c.buildSummaryZoneProgressV276(a,[...s,s[0]],{a:{i0:{1:10},i1:{1:8,2:8,3:8},i2:{1:8},unimported:{1:10}}},[],{},'imported');
 assert.deepEqual(plain(rows),[{zone:'A',total:5,assigned:5,done:2,unit:'งาน'}]);
});
test('imports not assigned or started remain planned, and zones without imports do not appear',()=>{
 const c=ctx(),a=[{id:'a',location_id:'empty',status:'completed',locations:{zone:'B'}}];
 const rows=c.buildSummaryZoneProgressV276(a,[{location_id:'new',item_id:'i',locations:{zone:'A'}}],{},[],{},'imported');
 assert.deepEqual(plain(rows),[{zone:'A',total:1,assigned:1,done:0,unit:'งาน'}]);
 assert.equal(c.buildSummaryZoneProgressV276(a,[],{},[],{},'imported').length,0);
});
test('historical completed work stays done after OH changes; new uncounted imported items do not',()=>{
 const c=ctx();for(const status of ['completed','approved','round3_done']){
 const a=[{id:'a',location_id:'l',status,_storedStatus:status,locations:{zone:'A'}}];
 const s=['old','new'].map(item_id=>({location_id:'l',item_id,onhand_qty:999}));
 const rows=c.buildSummaryZoneProgressV276(a,s,{a:{old:{1:0}}},[],{},'imported');assert.equal(rows[0].done,1);
 }
});
test('confirmed approval is completion evidence; drafts and repeated rows never inflate completed work',()=>{
 const c=ctx(),a=[{id:'a',location_id:'l',status:'pending',locations:{zone:'A'}}],s=['i','j'].map(item_id=>({location_id:'l',item_id}));
 const approvals=[{assignment_id:'a',item_id:'i',review_status:'confirmed'},{assignment_id:'a',item_id:'j',review_status:'draft'}];
 const rows=c.buildSummaryZoneProgressV276(a,s,{},[...approvals,approvals[0]],{},'imported');assert.equal(rows[0].done,1);assert.equal(rows[0].total,2);
});
test('central mode preserves original Location plan and whole-location completion',()=>{
 const c=ctx(),a=[{id:'a',location_id:'l1',status:'completed',locations:{zone:'A'}},{id:'b',location_id:'l2',status:'in_progress',locations:{zone:'A'}},
 {id:'c',location_id:'l3',status:'round3_done',locations:{zone:'B'}}];
 const old=Object.entries(a.reduce((map,row)=>{const z=map[row.locations.zone]??={all:new Set(),done:new Set()};z.all.add(row.location_id);if(c.assignmentPhysicalCountFinished(row))z.done.add(row.location_id);return map;},{}))
  .map(([zone,z])=>({zone,total:c.planLocationForZone(zone),assigned:z.all.size,done:z.done.size,unit:'Location'}));
 assert.deepEqual(plain(c.buildSummaryZoneProgressV276(a,[],{},[],{},'central')),old);
});
test('session mode and rendered cache are separated per session and actor; preference has no server write',()=>{
 const storage=new Map(),calls=[];const c=ctx({localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
 invalidateDashboardCache:tab=>calls.push(tab),refreshDashboardData:()=>calls.push('refresh')});
 const dmg='c6cc3bfe-2536-4e20-8569-a4b3389ba640';assert.equal(c.summaryZonePlanModeV276(dmg),'imported');
 assert.equal(c.summaryZonePlanModeV276('cycle'),'central');c.S._dashSid='cycle';
 const before=c.dashboardViewCacheKey('summary','cycle');c.setSummaryZonePlanModeV276('imported');
 assert.equal(c.summaryZonePlanModeV276('cycle'),'imported');assert.notEqual(c.dashboardViewCacheKey('summary','cycle'),before);
 assert.deepEqual(calls,['summary','refresh']);c.me.id='another-user';assert.equal(c.summaryZonePlanModeV276('cycle'),'central');
});
