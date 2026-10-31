'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {productionContext}=require('./production-harness.cjs');
test('JOB dropdown includes only jobs with unfinished cancellable locations and deduplicates location totals',()=>{
 const c=productionContext(['assignmentCancellationRowsV286','assignmentCancellationJobOptionsV287'],{
  annualLatestAssignmentsByLocation:rows=>new Map(rows.map(a=>[a.location_id,a])),
  assignmentCountingFinished:s=>['completed','round3_done','approved'].includes(s),sortRowsByLocation:r=>r,
  compareLocationCodes:(a,b)=>a.localeCompare(b,'en',{numeric:true})});
 const workspace={locationById:new Map(['a','b','c','d'].map(id=>[id,{id,code:id}])),
  assignments:[{location_id:'c',status:'completed'},{location_id:'d',wms_closed_at:'2026-10-31'}],
  jobs:[{id:'j2',job_code:'JOB-2',status:'pending'},{id:'j1',job_code:'JOB-1',status:'in_progress'},
   {id:'finished',status:'completed'},{id:'empty',status:'pending'},{id:'done-locations',status:'pending'}],
  items:[{job_id:'j2',location_id:'a'},{job_id:'j2',location_id:'a'},{job_id:'j2',location_id:'b'},
   {job_id:'j1',location_id:'a'},{job_id:'finished',location_id:'b'},
   {job_id:'done-locations',location_id:'c'},{job_id:'done-locations',location_id:'d'}]};
 const rows=c.assignmentCancellationRowsV286(workspace,'annual');
 const options=c.assignmentCancellationJobOptionsV287(workspace,rows);
 assert.deepEqual(JSON.parse(JSON.stringify(options)),[{id:'j1',code:'JOB-1',locations:1},{id:'j2',code:'JOB-2',locations:2}]);
 assert.deepEqual([...rows[0].jobIds],['j2','j1']);
 assert.equal(c.assignmentCancellationJobOptionsV287(workspace,[]).length,0);
});
test('JOB filtering uses exact job ID together with Zone/Row/Level; normal mode keeps Location search',()=>{
 const values={'cancel-job-v287':{value:'j1'},'cancel-zone-v286':{value:'A'}};
 const c=productionContext(['filteredAssignmentCancellationV286'],{Q:id=>values[id]});
 const rows=[{location:{id:'a',code:'LOC-1',zone:'A'},jobIds:['j1'],jobs:['DUPLICATE']},
  {location:{id:'b',code:'LOC-2',zone:'A'},jobIds:['j10'],jobs:['DUPLICATE']},
  {location:{id:'c',code:'LOC-3',zone:'B'},jobIds:['j1'],jobs:['DUPLICATE']}];
 assert.deepEqual(c.filteredAssignmentCancellationV286({mode:'annual',rows}).map(r=>r.location.id),['a']);
 values['cancel-job-v287'].value='';assert.equal(c.filteredAssignmentCancellationV286({mode:'annual',rows}).length,2);
 values['cancel-search-v286']={value:'loc-2'};assert.deepEqual(c.filteredAssignmentCancellationV286({mode:'normal',rows}).map(r=>r.location.id),['b']);
});
