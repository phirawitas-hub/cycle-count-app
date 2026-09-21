'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {productionContext,extractFunction}=require('./production-harness.cjs');
function fixture(extra={}) {
 const element={style:{display:'none'},innerHTML:'',replaceChildren(){this.innerHTML=''}};
 const cache={userId:'a',role:'admin',sessionId:'s',dateFrom:'',dateTo:'',teamDetailGroupsV272:[[{id:'1',status:'completed',locations:{code:'A1',zone:'Z'}}]]};
 let paints=0,translations=0;
 const ctx=productionContext(['toggleCounterDetail'],{
  S:{page:'sv-dash',_dashTab:'team',_dashSid:'s'},_dashTab:'team',me:{id:'a'},prof:{role:'admin'},
  selectedDateFrom:'',selectedDateTo:'',_dashboardViewCache:cache,Q:()=>element,
  renderTeamDetailRowsV272:rows=>{paints++;return rows.map(x=>x.locations.code).join(',')},queueUiTranslation:()=>translations++,
  ...extra,
 });
 return {ctx,element,cache,paints:()=>paints,translations:()=>translations};
}
test('Team details build only on expansion and release DOM on collapse',()=>{
 const f=fixture();assert.equal(f.paints(),0);
 f.ctx.toggleCounterDetail('0');assert.equal(f.element.innerHTML,'A1');assert.equal(f.element.style.display,'block');assert.equal(f.translations(),1);
 f.ctx.toggleCounterDetail('0');assert.equal(f.element.innerHTML,'');assert.equal(f.element.style.display,'none');assert.equal(f.paints(),1);
 f.ctx.toggleCounterDetail('0');assert.equal(f.paints(),2);assert.equal(f.element.innerHTML,'A1');
 assert.equal(f.cache.teamDetailGroupsV272[0].length,1);
});
test('Team details fail closed for mismatched actor, role, Session, date or navigation',()=>{
 for(const change of [
  c=>c.me.id='other',c=>c.prof.role='counter',c=>c.S._dashSid='other',c=>c.S.page='c-tasks',c=>c.S._dashTab='summary',
  c=>c.selectedDateFrom='2026-09-17',c=>c.selectedDateTo='2026-09-18',c=>c._dashboardViewCache=null,
 ]) {
  const f=fixture();change(f.ctx);f.ctx.toggleCounterDetail('0');assert.equal(f.paints(),0);assert.equal(f.element.style.display,'none');
 }
});
test('Team rejects invalid or absent groups without reading another cache',()=>{
 for(const index of ['bad',-1,1,0.5,Infinity]) {const f=fixture();f.ctx.toggleCounterDetail(index);assert.equal(f.paints(),0)}
 const f=fixture({Q:()=>null});assert.doesNotThrow(()=>f.ctx.toggleCounterDetail('0'));
});
test('actual detail renderer preserves all 1994 rows without truncation',()=>{
 const ctx=productionContext(['renderTeamDetailRowsV272'],{
  sortRowsByLocation:rows=>[...rows],tagInfo:status=>({cls:'tag-green',lbl:status}),escapeWmsText:x=>x,
 });
 const rows=Array.from({length:1994},(_,i)=>({id:String(i),status:i%2?'completed':'pending',locations:{code:`A-${i}`,zone:'Z',row_no:'1',level:'G'}}));
 const before=JSON.stringify(rows),html=ctx.renderTeamDetailRowsV272(rows);
 assert.equal((html.match(/data-location-sort-code=/g)||[]).length,1994);
 assert.match(html,/A-1993/);assert.match(html,/pending/);assert.match(html,/completed/);assert.equal(JSON.stringify(rows),before);
});
test('detail expansion follows current location sort direction on each reopen',()=>{
 let reverse=false;
 const ctx=productionContext(['renderTeamDetailRowsV272'],{
  sortRowsByLocation:rows=>reverse?[...rows].reverse():[...rows],tagInfo:()=>({cls:'',lbl:'done'}),escapeWmsText:x=>x,
 });
 const rows=[{locations:{code:'A1'}},{locations:{code:'B2'}}];
 let html=ctx.renderTeamDetailRowsV272(rows);assert.ok(html.indexOf('A1')<html.indexOf('B2'));
 reverse=true;html=ctx.renderTeamDetailRowsV272(rows);assert.ok(html.indexOf('B2')<html.indexOf('A1'));
});
test('initial Team HTML has empty detail containers and data stays in the verified view cache',()=>{
 const {code:loader}=extractFunction('loadSvDashCoreV262');
 const {code:team}=extractFunction('buildTeamProgressViewV274');
 assert.match(team,/teamDetailGroupsV272\[idx\] = u\.items\.map/);
 assert.doesNotMatch(team,/\$\{u\.items\.map/);
 assert.match(loader,/teamDetailGroupsV272:team\.teamDetailGroupsV272/);
 assert.ok(loader.indexOf('verifyManagementFallbackV271(viewVersionV271,curSid,tab)')<loader.indexOf('teamDetailGroupsV272:team.teamDetailGroupsV272'));
});
