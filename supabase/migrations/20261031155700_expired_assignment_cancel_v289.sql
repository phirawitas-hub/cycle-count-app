-- Include expired unassigned work; preserve count evidence, locks and token checks.
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
      exists(select 1 from public.assignments a where a.session_id=p_session_id and a.location_id=l.id and (a.assigned_to is not null or (a.expired_at is not null and a.expired_from is not null)))
      and not exists(select 1 from public.count_records c join public.assignments a on a.id=c.assignment_id where a.session_id=p_session_id and a.location_id=l.id)
      and not exists(select 1 from public.annual_count_job_items i join public.annual_count_jobs j on j.id=i.job_id where i.session_id=p_session_id and i.location_id=l.id and j.status<>'completed')
    else
      exists(select 1 from public.annual_count_job_items i join public.annual_count_jobs j on j.id=i.job_id where i.session_id=p_session_id and i.location_id=l.id and j.status<>'completed')
    end);
  return jsonb_build_object('session_id',p_session_id,'mode',p_mode,'token',md5(state::text),'location_ids',eligible,
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code) order by code,id) from public.locations where id=any(eligible)),'[]'::jsonb),
    'skipped',cardinality(targets)-cardinality(eligible));
end $$;

