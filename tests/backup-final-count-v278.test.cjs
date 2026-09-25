'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {productionContext,extractDeclaration}=require('./production-harness.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));

function backupContext(){
  return productionContext([
    'backupHasValue','repeatTeamBackupItemFieldsForEveryLpn','backupNumber','backupDateForTeam',
    'backupLatestRecord','backupTeamSheetColumns','buildTeamBackupData',
    'backupCanonicalValue','backupCanonicalValueV1','backupRowsChecksum','backupSplitExcelText',
    'backupRowsForExcel','backupRowsFromExcel',
  ],{
    COUNT_TYPE_ISSUES:[],
    normalizeImportText:value=>String(value??'').trim(),
    importCodeKey:value=>String(value??'').trim().toUpperCase(),
    varianceReviewState:approval=>approval?.review_status||'',
    isEmptyLocationItem:()=>false,
    paperFormLocationParts:()=>({rowNo:'',level:''}),
    paperArray:value=>Array.isArray(value)?value:[],
    PAPER_FORM_SOURCE_LABEL:'Paper Form',
  },[
    'BACKUP_FORMAT_VERSION','BACKUP_EXCEL_CELL_LIMIT','BACKUP_EXCEL_CHUNK_SIZE',
    'BACKUP_CHUNK_MARKER','BACKUP_JSON_VALUE_PREFIX','BACKUP_JSON_COLUMNS',
    'TEAM_BACKUP_ITEM_FIELDS_PER_LPN',
  ]);
}

test('Data_Count places the three requested Final Count columns immediately after Count 3 Time',()=>{
  const c=backupContext();
  const cols=plain(c.backupTeamSheetColumns().Data_Count);
  const start=cols.findIndex(column=>column.header==='Count 3 Time');
  assert.ok(start>=0);
  assert.deepEqual(cols.slice(start,start+4).map(column=>[column.key,column.header]),[
    ['count3Time','Count 3 Time'],
    ['finalCount','Final Count'],
    ['finalCountCounter','Actual Final Count'],
    ['finalCountTime','Final Count Time'],
  ]);
});

test('Final Count uses the confirmed final quantity and attributes the latest physical round counter and time',()=>{
  const c=backupContext();
  const data=c.buildTeamBackupData({
    Sessions:[{id:'s',name:'Session',status:'active'}],
    Locations:[{id:'l',code:'L01',zone:'A'}],
    Items:[{id:'i',code:'ITEM',description:'Item',uom:'EA'}],
    Assignments:[{id:'a',session_id:'s',location_id:'l',assigned_to:'p',status:'completed'}],
    Annual_Jobs:[],Annual_Job_Items:[],
    Stock:[{id:'st',session_id:'s',location_id:'l',item_id:'i',onhand_qty:10,al_qty:1}],
    Stock_Detail:[
      {id:'d1',session_id:'s',location_id:'l',item_id:'i',license_plate:'P1',qty:5,uom:'EA'},
      {id:'d2',session_id:'s',location_id:'l',item_id:'i',license_plate:'P2',qty:5,uom:'EA'},
    ],
    Counts:[
      {id:'c1',assignment_id:'a',item_id:'i',round:1,count_qty:9,counted_by:'p',actual_counter_name:'Counter 1',counted_at:'2026-08-04T09:00:00Z'},
      {id:'c2',assignment_id:'a',item_id:'i',round:2,count_qty:11,counted_by:'p',actual_counter_name:'Counter 2',counted_at:'2026-08-04T10:00:00Z'},
    ],
    Approvals:[{id:'ap',assignment_id:'a',item_id:'i',final_qty:12,variance:2,review_status:'confirmed',approved_by:'p',approved_at:'2026-08-04T11:00:00Z'}],
    Found_Items:[],Paper_Count_Raw:[],Data_Info:[],Audit:[],Counters:[],Remarks:[],Type_Issues:[],
    Profiles:[{id:'p',name:'Recorder'}],
  });
  const rows=plain(data.Data_Count);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.finalCount),[5,7]);
  assert.deepEqual(rows.map(row=>row.physicalCount),[5,7]);
  assert.deepEqual(rows.map(row=>row.finalCountCounter),['Counter 2','Counter 2']);
  assert.deepEqual(rows.map(row=>row.finalCountTime),['2026-08-04 17:00:00','2026-08-04 17:00:00']);
  assert.equal(rows[0].count3,null);
});

test('raw Counts restore payload still round-trips exactly with checksum under backup format 11',()=>{
  const c=backupContext();
  const columns=['id','assignment_id','item_id','round','count_qty','counted_by','counted_at','actual_counter_id','type_issue','remark','photo_url','actual_counter_name'];
  const rows=[{
    id:'c',assignment_id:'a',item_id:'i',round:3,count_qty:0,counted_by:'p',counted_at:'2026-08-04T10:00:00Z',
    actual_counter_id:null,type_issue:'DAMAGE',remark:'หมายเหตุ '.repeat(5000),photo_url:'https://example.test/photo.jpg',actual_counter_name:'Counter 3',
  }];
  const prepared=c.backupRowsForExcel(rows,columns,'11');
  const restored=c.backupRowsFromExcel(prepared.rows,columns,'11');
  assert.deepEqual(plain(restored),rows);
  assert.equal(c.backupRowsChecksum(restored,columns,'11'),c.backupRowsChecksum(rows,columns,'11'));
});

test('restore source schema stays on raw Counts; Data_Count remains a readable non-restore sheet',()=>{
  const declaration=extractDeclaration('BACKUP_SHEET_SPECS').code;
  assert.match(declaration,/sheet:'Counts', table:'count_records'/);
  assert.doesNotMatch(declaration,/sheet:'Data_Count'/);
  assert.match(extractDeclaration('BACKUP_FORMAT_VERSION').code,/['"]11['"]/);
});
