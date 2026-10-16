-- Read-only snapshot of installed count RPC definitions, 2026-10-16.
-- Used only by the isolated PGlite verification fixture.
CREATE OR REPLACE FUNCTION public.get_count_read_bundle_v261(p_assignment_id uuid, p_include_entry boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  assignment_row public.assignments%ROWTYPE;
  assignment_json jsonb;
  session_json jsonb;
  payload jsonb;
  entry_mode boolean := COALESCE(p_include_entry,true);
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Count reads require an authenticated user' USING ERRCODE='42501';
  END IF;
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment is required' USING ERRCODE='22023';
  END IF;

  SELECT a.* INTO assignment_row FROM public.assignments a WHERE a.id=p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment is missing or inaccessible' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('id',s.id,'show_oh',s.show_oh,
      'max_rounds',s.max_rounds,'repeat_match_action',s.repeat_match_action)
    INTO session_json FROM public.count_sessions s WHERE s.id=assignment_row.session_id;
  IF session_json IS NULL THEN
    RAISE EXCEPTION 'Session is missing or inaccessible' USING ERRCODE='42501';
  END IF;
  assignment_json := jsonb_build_object('id',assignment_row.id,'status',assignment_row.status,
    'session_id',assignment_row.session_id,'location_id',assignment_row.location_id,
    'assigned_at',assignment_row.assigned_at);
  IF entry_mode THEN
    assignment_json := assignment_json || jsonb_build_object(
      'locations',(SELECT jsonb_build_object('code',l.code,'zone',l.zone,'area',l.area,'row_no',l.row_no,'level',l.level)
                   FROM public.locations l WHERE l.id=assignment_row.location_id),
      'count_sessions',(SELECT jsonb_build_object('name',s.name)
                        FROM public.count_sessions s WHERE s.id=assignment_row.session_id));
  END IF;

  -- A STABLE function uses one database snapshot for this call. JSON arrays
  -- avoid truncation by the Data API's top-level row limit. All joins retain
  -- the caller's RLS; no SECURITY DEFINER helper or service key is used.
  WITH snapshot_rows AS MATERIALIZED (
    SELECT s.id,s.session_id,s.location_id,s.created_at,s.item_id,s.onhand_qty,s.al_qty,
      CASE WHEN i.id IS NULL THEN NULL ELSE
        jsonb_build_object('id',i.id,'code',i.code,'description',i.description) END AS items
    FROM public.stock_snapshot s LEFT JOIN public.items i ON i.id=s.item_id
    WHERE s.session_id=assignment_row.session_id AND s.location_id=assignment_row.location_id
  ), count_rows AS MATERIALIZED (
    SELECT c.id,c.assignment_id,c.item_id,c.round,c.count_qty,c.actual_counter_name,
           c.remark,c.photo_url,c.type_issue,c.counted_at
    FROM public.count_records c WHERE c.assignment_id=p_assignment_id
  ), baseline_rows AS MATERIALIZED (
    -- Assignment scope also preserves old baseline rows whose Session field
    -- is NULL; the assignment has already passed the caller's RLS above.
    SELECT l.id,l.assignment_id,l.item_id,l.action,l.old_value,l.new_value,l.created_at
    FROM public.audit_log l
    WHERE l.assignment_id=p_assignment_id AND l.action='wms_import_count_baseline'
  ), detail_rows AS MATERIALIZED (
    SELECT d.id,d.session_id,d.location_id,d.item_id,d.license_plate,d.lot,d.inventory_status,d.qty,d.uom
    FROM public.stock_snapshot_detail d
    WHERE entry_mode AND d.session_id=assignment_row.session_id AND d.location_id=assignment_row.location_id
  ), counter_rows AS MATERIALIZED (
    SELECT n.id,n.name FROM public.counter_names n WHERE entry_mode AND n.active IS TRUE
  ), remark_rows AS MATERIALIZED (
    SELECT r.id,r.label FROM public.remark_options r
    WHERE entry_mode AND r.context='count' AND r.active IS TRUE
  ), type_issue_rows AS MATERIALIZED (
    SELECT t.id,t.value,t.label,t.sort_order,t.active FROM public.type_issue_options t WHERE entry_mode
  )
  SELECT jsonb_build_object(
    'schema_version',1,'actor_id',actor_id,'include_entry',entry_mode,
    'assignment',assignment_json,'session',session_json,
    'snapshots',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM snapshot_rows s),'[]'::jsonb),
    'counts',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.round,c.id) FROM count_rows c),'[]'::jsonb),
    'baseline_audit',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at,l.id) FROM baseline_rows l),'[]'::jsonb),
    'details',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM detail_rows d),'[]'::jsonb),
    'counter_names',COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.name,n.id) FROM counter_rows n),'[]'::jsonb),
    'remark_options',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.label,r.id) FROM remark_rows r),'[]'::jsonb),
    'type_issue_options',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order,t.label,t.id) FROM type_issue_rows t),'[]'::jsonb),
    'row_counts',jsonb_build_object(
      'snapshots',(SELECT count(*) FROM snapshot_rows),
      'counts',(SELECT count(*) FROM count_rows),
      'baseline_audit',(SELECT count(*) FROM baseline_rows),
      'details',(SELECT count(*) FROM detail_rows),
      'counter_names',(SELECT count(*) FROM counter_rows),
      'remark_options',(SELECT count(*) FROM remark_rows),
      'type_issue_options',(SELECT count(*) FROM type_issue_rows))
  ) INTO payload;
  RETURN payload;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_count_records_v122(p_records jsonb)
 RETURNS SETOF count_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_record record;
  v_assignment record;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่ก่อนบันทึก Count'
      using errcode = '42501';
  end if;

  if p_records is null
     or pg_catalog.jsonb_typeof(p_records) <> 'array'
     or pg_catalog.jsonb_array_length(p_records) = 0 then
    raise exception 'ไม่พบรายการ Count ที่ต้องบันทึก'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_records) > 500 then
    raise exception 'บันทึก Count ได้ไม่เกิน 500 รายการต่อครั้ง'
      using errcode = '22023';
  end if;

  select p.role::text
    into v_role
  from public.profiles as p
  where p.id = v_uid;

  -- Validate every requested row before writing anything. A failed row rolls
  -- back the whole call, so a Location never becomes partially saved.
  for v_record in
    select *
    from pg_catalog.jsonb_to_recordset(p_records) as x(
      assignment_id uuid,
      item_id uuid,
      round integer,
      count_qty numeric,
      actual_counter_name text,
      type_issue text,
      remark text,
      photo_url text
    )
  loop
    if v_record.assignment_id is null or v_record.item_id is null then
      raise exception 'Assignment หรือ Item ไม่ถูกต้อง'
        using errcode = '22023';
    end if;

    select
      a.id,
      a.session_id,
      a.location_id,
      a.assigned_to,
      a.status,
      a.wms_closed_at,
      coalesce(s.max_rounds, 3) as max_rounds
      into v_assignment
    from public.assignments as a
    left join public.count_sessions as s on s.id = a.session_id
    where a.id = v_record.assignment_id;

    if not found then
      raise exception 'ไม่พบ Assignment ที่ต้องการบันทึก'
        using errcode = 'P0002';
    end if;

    if coalesce(v_role, '') not in ('admin', 'supervisor')
       and v_assignment.assigned_to is distinct from v_uid then
      raise exception 'บัญชีนี้ไม่ได้เป็นผู้รับผิดชอบ Assignment นี้'
        using errcode = '42501';
    end if;

    if coalesce(v_role, '') not in ('admin', 'supervisor')
       and (
         v_assignment.wms_closed_at is not null
         or coalesce(v_assignment.status, '') in ('round3_done', 'completed', 'approved')
       ) then
      raise exception 'Location นี้ส่งตรวจหรือปิดงานแล้ว ไม่อนุญาตให้แก้ยอดจากหน้าตรวจนับ'
        using errcode = '42501';
    end if;

    if v_record.round is null
       or v_record.round < 1
       or v_record.round > greatest(1, least(3, v_assignment.max_rounds)) then
      raise exception 'รอบการนับไม่ถูกต้อง'
        using errcode = '22023';
    end if;

    if v_record.count_qty is null or v_record.count_qty < 0 then
      raise exception 'QTY ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.stock_snapshot as ss
      where ss.session_id = v_assignment.session_id
        and ss.location_id = v_assignment.location_id
        and ss.item_id = v_record.item_id
    ) then
      raise exception 'Item ไม่ได้อยู่ใน Stock Snapshot ของ Assignment นี้'
        using errcode = '42501';
    end if;
  end loop;

  return query
  insert into public.count_records as target (
    assignment_id,
    item_id,
    round,
    count_qty,
    counted_by,
    counted_at,
    actual_counter_name,
    type_issue,
    remark,
    photo_url
  )
  select
    x.assignment_id,
    x.item_id,
    x.round,
    x.count_qty,
    v_uid,
    pg_catalog.now(),
    nullif(pg_catalog.btrim(x.actual_counter_name), ''),
    nullif(pg_catalog.btrim(x.type_issue), ''),
    nullif(pg_catalog.btrim(x.remark), ''),
    nullif(pg_catalog.btrim(x.photo_url), '')
  from pg_catalog.jsonb_to_recordset(p_records) as x(
    assignment_id uuid,
    item_id uuid,
    round integer,
    count_qty numeric,
    actual_counter_name text,
    type_issue text,
    remark text,
    photo_url text
  )
  on conflict (assignment_id, item_id, round)
  do update set
    count_qty = excluded.count_qty,
    counted_by = excluded.counted_by,
    counted_at = excluded.counted_at,
    actual_counter_name = excluded.actual_counter_name,
    type_issue = excluded.type_issue,
    remark = excluded.remark,
    photo_url = excluded.photo_url
  returning target.*;
end;
$function$
;

