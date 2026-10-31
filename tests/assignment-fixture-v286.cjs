'use strict';
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor=uuid(1),sid=uuid(2),other=uuid(3);
async function setup(size=8){
 const db=new PGlite();
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/count-sync-schema.sql'),'utf8'));
 await db.exec(`alter table profiles add column name text;
 alter table assignments add column created_at timestamptz default now(),add column expired_at timestamptz,add column expired_from uuid;
 create table annual_count_jobs(id uuid primary key default gen_random_uuid(),session_id uuid references count_sessions(id),job_no int,job_code text,assigned_to uuid,status text default 'pending',assigned_at timestamptz,expired_at timestamptz,expired_from uuid,created_at timestamptz default now());
 alter table annual_count_job_items add column job_id uuid references annual_count_jobs(id),add column stock_snapshot_id uuid,add column item_id uuid,add column sort_order int;
 create table found_items(id uuid primary key default gen_random_uuid(),assignment_id uuid references assignments(id));
 create table variance_approvals(id uuid primary key default gen_random_uuid(),assignment_id uuid references assignments(id));
 alter table count_records add foreign key(assignment_id) references assignments(id);
 grant select,insert,update,delete on all tables in schema public to authenticated;
 create policy management_a on assignments for all to authenticated using (exists(select 1 from profiles where id=auth.uid() and role in ('admin','supervisor')));
 create policy management_c on count_records for all to authenticated using (exists(select 1 from profiles where id=auth.uid() and role in ('admin','supervisor')));
 insert into profiles(id,role,name) values('${actor}','admin','Admin'),('${other}','counter','Counter');
 insert into count_sessions(id,name,status) values('${sid}','Fixture','active');
 insert into items(id,code) values('${uuid(4)}','ITEM');`);
 await db.query("insert into locations(id,code,zone,row_no,level) select ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'B-GA-'||lpad(i::text,5,'0')||'-A',case when i%2=1 then 'B' else 'A' end,'GA','A' from generate_series(0,$1::int-1) i",[size]);
 await db.query("insert into assignments(id,session_id,location_id,assigned_to) select ('00000000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,$1,('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,$2 from generate_series(0,$3::int-1) i",[sid,other,size]);
 await db.query('insert into stock_snapshot(session_id,location_id,item_id,onhand_qty) select $1,id,$2,10 from locations',[sid,uuid(4)]);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261031032412_assignment_workspace_v286.sql'),'utf8'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
 return db;
}
async function rpc(db,name,args){
 const cols=Object.keys(args),values=Object.values(args);
 return (await db.query('select public.'+name+'('+cols.map((k,i)=>k+'=> $'+(i+1)).join(',')+') as result',values)).rows[0].result;
}
async function preview(db,mode,ids){return rpc(db,'preview_assignment_cancel_v286',{p_session_id:sid,p_mode:mode,p_location_ids:ids});}
async function cancel(db,mode,ids,p){return rpc(db,'cancel_assignment_locations_v286',{p_session_id:sid,p_mode:mode,p_location_ids:ids,p_token:p.token});}
module.exports={setup,rpc,preview,cancel,uuid,actor,sid,other};
