-- One MVCC snapshot, compact positional rows, no pagination truncation.
-- All functions are invoker functions: existing RLS remains in force.
create index if not exists audit_log_assignment_transfer_v286_idx
  on public.audit_log(session_id,created_at,id) where action='annual_to_normal';
create or replace function public.get_assignment_workspace_v286(p_session_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','supervisor')) then
    raise exception 'Management access required' using errcode='42501';
  end if;
  if not exists(select 1 from public.count_sessions where id=p_session_id) then raise exception 'Session not found'; end if;
  with s as materialized (select id,session_id,location_id,item_id,onhand_qty,al_qty from public.stock_snapshot where session_id=p_session_id),
  a as materialized (select id,session_id,location_id,assigned_to,status,created_at,assigned_at,expired_at,expired_from,wms_closed_at from public.assignments where session_id=p_session_id),
  j as materialized (select id,session_id,job_no,job_code,assigned_to,status,assigned_at,expired_at,expired_from,created_at from public.annual_count_jobs where session_id=p_session_id),
  i as materialized (select id,job_id,session_id,stock_snapshot_id,location_id,item_id,sort_order from public.annual_count_job_items where session_id=p_session_id),
  loc as (select location_id id from s union select location_id from a union select location_id from i)
  select jsonb_build_object('schema_version',1,'session_id',p_session_id,
    'snapshots',coalesce((select jsonb_agg(jsonb_build_array(id,session_id,location_id,item_id,onhand_qty,al_qty) order by id) from s),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(jsonb_build_array(id,session_id,location_id,assigned_to,status,created_at,assigned_at,expired_at,expired_from,wms_closed_at) order by id) from a),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(jsonb_build_array(id,session_id,job_no,job_code,assigned_to,status,assigned_at,expired_at,expired_from,created_at) order by id) from j),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_array(id,job_id,session_id,stock_snapshot_id,location_id,item_id,sort_order) order by id) from i),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(jsonb_build_array(l.id,l.code,l.zone,l.row_no,l.level,l.area) order by l.id) from public.locations l join loc on loc.id=l.id),'[]'::jsonb),
    'profiles',coalesce((select jsonb_agg(jsonb_build_array(id,name) order by id) from public.profiles where id in (select assigned_to from a union select expired_from from a union select assigned_to from j union select expired_from from j)),'[]'::jsonb),
    'transfers',coalesce((select jsonb_agg(jsonb_build_array(id,session_id,location_id,assignment_id,action,old_value,new_value,created_at) order by created_at,id) from public.audit_log where session_id=p_session_id and action='annual_to_normal'),'[]'::jsonb)
  ) into result;
  return result;
end $$;

-- Preview is also used under row locks by the commit function. The token
-- covers the actual rows/evidence, not a client supplied list of eligible IDs.
create or replace function public.preview_assignment_cancel_v286(p_session_id uuid,p_mode text,p_location_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare state jsonb; eligible uuid[]; targets uuid[];
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','supervisor')) then
    raise exception 'Management access required' using errcode='42501';
  end if;
  if p_mode is null or p_mode not in ('normal','annual') or coalesce(cardinality(p_location_ids),0) not between 1 and 20000 then
    raise exception 'Select Locations and a valid mode';
  end if;
  if not exists(select 1 from public.count_sessions where id=p_session_id and status='active' and closed_at is null) then
    raise exception 'Session is not active';
  end if;
  select array_agg(distinct x order by x) into targets from unnest(p_location_ids) x where x is not null;
  with a as materialized(select * from public.assignments where session_id=p_session_id and location_id=any(targets)),
  i as materialized(select * from public.annual_count_job_items where session_id=p_session_id and location_id=any(targets)),
  j as materialized(select * from public.annual_count_jobs where id in(select job_id from i)),
  c as materialized(select r.* from public.count_records r join a on a.id=r.assignment_id)
  select jsonb_build_object('session', (select to_jsonb(s) from public.count_sessions s where id=p_session_id),'mode',p_mode,'targets',targets,
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by id) from a),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by id) from i),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by id) from j),'[]'::jsonb),
    'counts',coalesce((select jsonb_agg(to_jsonb(c) order by id) from c),'[]'::jsonb),
    'found',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.found_items f join a on a.id=f.assignment_id),'[]'::jsonb),
    'approvals',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.variance_approvals v join a on a.id=v.assignment_id),'[]'::jsonb)
  ) into state;
  select coalesce(array_agg(l.id order by l.id),'{}'::uuid[]) into eligible
  from public.locations l where l.id=any(targets)
    and not exists(select 1 from public.assignments a where a.session_id=p_session_id and a.location_id=l.id and (a.status in ('completed','approved','round3_done') or a.wms_closed_at is not null))
    and (case when p_mode='normal' then
      exists(select 1 from public.assignments a where a.session_id=p_session_id and a.location_id=l.id and a.assigned_to is not null)
      and not exists(select 1 from public.count_records c join public.assignments a on a.id=c.assignment_id where a.session_id=p_session_id and a.location_id=l.id)
      and not exists(select 1 from public.annual_count_job_items i join public.annual_count_jobs j on j.id=i.job_id where i.session_id=p_session_id and i.location_id=l.id and j.status<>'completed')
    else
      exists(select 1 from public.annual_count_job_items i join public.annual_count_jobs j on j.id=i.job_id where i.session_id=p_session_id and i.location_id=l.id and j.status<>'completed')
    end);
  return jsonb_build_object('session_id',p_session_id,'mode',p_mode,'token',md5(state::text),'location_ids',eligible,
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code) order by code,id) from public.locations where id=any(eligible)),'[]'::jsonb),
    'skipped',cardinality(targets)-cardinality(eligible));
end $$;

create or replace function public.cancel_assignment_locations_v286(p_session_id uuid,p_mode text,p_location_ids uuid[],p_token text)
returns jsonb language plpgsql volatile security invoker set search_path = '' set lock_timeout='3s' as $$
declare preview jsonb; ids uuid[]; job_ids uuid[]; released int:=0; removed int:=0; changed int; row_a record;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','supervisor')) then
    raise exception 'Management access required' using errcode='42501';
  end if;
  if coalesce(cardinality(p_location_ids),0) not between 1 and 20000 then raise exception 'Select Locations'; end if;
  -- Match the count-save assignment -> session lock order. FK checks also
  -- wait behind FOR UPDATE before inserting a new result for this assignment.
  perform id from public.assignments where session_id=p_session_id and location_id=any(p_location_ids) order by id for update;
  perform id from public.count_sessions where id=p_session_id for update;
  select coalesce(array_agg(distinct job_id),'{}'::uuid[]) into job_ids from public.annual_count_job_items where session_id=p_session_id and location_id=any(p_location_ids);
  perform id from public.annual_count_jobs where id=any(job_ids) order by id for update;
  perform id from public.annual_count_job_items where session_id=p_session_id and location_id=any(p_location_ids) order by id for update;
  perform c.id from public.count_records c join public.assignments a on a.id=c.assignment_id where a.session_id=p_session_id and a.location_id=any(p_location_ids) order by c.id for update of c;
  preview:=public.preview_assignment_cancel_v286(p_session_id,p_mode,p_location_ids);
  if p_token is null or p_token is distinct from preview->>'token' then
    raise exception 'ข้อมูลเปลี่ยนระหว่างเลือก กรุณาโหลดและตรวจรายการใหม่ ยังไม่ได้ยกเลิกงาน' using errcode='40001';
  end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(preview->'location_ids');
  for row_a in select a.* from public.assignments a where a.session_id=p_session_id and a.location_id=any(ids)
    and (a.assigned_to is not null or a.expired_from is not null)
    and (p_mode='normal' or exists(select 1 from public.annual_count_job_items i join public.annual_count_jobs j on j.id=i.job_id
      where i.session_id=p_session_id and i.location_id=a.location_id and j.status<>'completed'
      and coalesce(j.assigned_to,j.expired_from)=coalesce(a.assigned_to,a.expired_from)))
  loop
    -- Preserve assignment IDs, counts, found items, notes and audit history.
    -- Uncounted rows become free; counted rows stay in the expired/reassign queue.
    update public.assignments set assigned_to=null,assigned_at=null,
      expired_at=case when exists(select 1 from public.count_records where assignment_id=row_a.id) then now() else null end,
      expired_from=case when exists(select 1 from public.count_records where assignment_id=row_a.id) then coalesce(row_a.assigned_to,row_a.expired_from) else null end
      where id=row_a.id;
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'Cannot release assignment'; end if;
    insert into public.audit_log(session_id,location_id,assignment_id,action,old_value,new_value,performed_by)
      values(p_session_id,row_a.location_id,row_a.id,'assignment_cancel_selected_v286',row_a.assigned_to::text,p_mode,auth.uid());
    released:=released+1;
  end loop;
  if p_mode='annual' then
    delete from public.annual_count_job_items i using public.annual_count_jobs j where j.id=i.job_id and j.status<>'completed'
      and i.session_id=p_session_id and i.location_id=any(ids);
    get diagnostics removed=row_count;
    -- Only touched empty jobs are removed. Remaining Locations keep their JOB.
    delete from public.annual_count_jobs j where j.id=any(job_ids) and j.session_id=p_session_id and j.status<>'completed'
      and not exists(select 1 from public.annual_count_job_items i where i.job_id=j.id);
    insert into public.audit_log(session_id,location_id,action,new_value,performed_by)
      select p_session_id,l,'annual_cancel_location_v286','Return selected Location to unbuilt JOB work',auth.uid() from unnest(ids) l;
  end if;
  return jsonb_build_object('location_ids',ids,'released_assignments',released,'removed_job_items',removed,'skipped',preview->'skipped');
end $$;

revoke all on function public.get_assignment_workspace_v286(uuid) from public,anon;
revoke all on function public.preview_assignment_cancel_v286(uuid,text,uuid[]) from public,anon;
revoke all on function public.cancel_assignment_locations_v286(uuid,text,uuid[],text) from public,anon;
grant execute on function public.get_assignment_workspace_v286(uuid) to authenticated;
grant execute on function public.preview_assignment_cancel_v286(uuid,text,uuid[]) to authenticated;
grant execute on function public.cancel_assignment_locations_v286(uuid,text,uuid[],text) to authenticated;
