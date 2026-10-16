-- V2.79: additive, opt-in synchronization for prepared cycle-count work.
-- Existing online clients keep their current API. No stock quantities are changed.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.count_sync_receipts_v279 (
  actor_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation_id)
);
ALTER TABLE private.count_sync_receipts_v279 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.count_sync_receipts_v279 FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.count_sync_state_v279(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  a public.assignments%ROWTYPE;
  s public.count_sessions%ROWTYPE;
  scope_value jsonb;
  scope_token text;
  count_value jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบใหม่' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.assignments WHERE id=p_assignment_id;
  IF NOT FOUND OR a.assigned_to IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'งานนี้ไม่ได้มอบหมายให้บัญชีปัจจุบัน' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=actor AND role::text IN ('counter','supervisor','admin')) THEN
    RAISE EXCEPTION 'บัญชีไม่มีสิทธิ์ตรวจนับ' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.count_sessions WHERE id=a.session_id;
  IF NOT FOUND OR s.max_rounds IS NULL OR s.max_rounds NOT BETWEEN 1 AND 3
    OR s.repeat_match_action IS NULL OR s.repeat_match_action NOT IN ('recount','auto_pass','send_variance') THEN
    RAISE EXCEPTION 'กติกาการนับไม่ครบ กรุณาตรวจสอบ Session' USING ERRCODE='22023';
  END IF;
  -- First release deliberately exposes only the ordinary Cycle Count workflow.
  -- Annual and Found Work must not be partially committed through this API.
  IF s.count_mode IS DISTINCT FROM 'cycle' OR EXISTS (
    SELECT 1 FROM public.annual_count_job_items j WHERE j.session_id=a.session_id AND j.location_id=a.location_id
  ) THEN
    RAISE EXCEPTION 'งาน JOB ยังต้องใช้หน้าตรวจนับออนไลน์' USING ERRCODE='0A000';
  END IF;
  SELECT jsonb_build_object(
    'assignment',to_jsonb(a)-'status',
    'session',jsonb_build_object('id',s.id,'status',s.status,'closed_at',s.closed_at,
      'max_rounds',s.max_rounds,'repeat_match_action',s.repeat_match_action,'show_oh',s.show_oh,'count_mode',s.count_mode),
    'snapshots',COALESCE((SELECT jsonb_agg(jsonb_build_array(ss.id,ss.item_id,ss.onhand_qty,ss.created_at,i.code) ORDER BY ss.id)
      FROM public.stock_snapshot ss LEFT JOIN public.items i ON i.id=ss.item_id
      WHERE ss.session_id=a.session_id AND ss.location_id=a.location_id),'[]'::jsonb),
    'baselines',COALESCE((SELECT jsonb_agg(jsonb_build_array(l.id,l.item_id,l.old_value,l.created_at) ORDER BY l.created_at,l.id)
      FROM public.audit_log l WHERE l.assignment_id=a.id AND l.action='wms_import_count_baseline'),'[]'::jsonb)
  ) INTO scope_value;
  scope_token := encode(sha256(convert_to(scope_value::text,'UTF8')),'hex');
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.item_id,c.round),'[]'::jsonb)
    INTO count_value FROM public.count_records c WHERE c.assignment_id=a.id;
  RETURN jsonb_build_object('actor_id',actor,'assignment_id',a.id,'scope_token',scope_token,
    'state_token',encode(sha256(convert_to(jsonb_build_array(scope_token,a.status,count_value)::text,'UTF8')),'hex'),
    'open',s.status='active' AND s.closed_at IS NULL AND a.wms_closed_at IS NULL
      AND a.status NOT IN ('completed','round3_done','approved'));
END;
$$;

CREATE FUNCTION private.count_item_status_v279(p_oh numeric,p_rounds numeric[],p_max integer,p_repeat text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE vals numeric[]; i integer; j integer;
BEGIN
  IF p_rounds[1] IS NULL THEN RETURN ''; END IF;
  vals := (array_remove(p_rounds,NULL))[1:p_max];
  IF p_oh=ANY(vals) THEN RETURN 'OK'; END IF;
  IF cardinality(vals)>1 THEN
    FOR i IN 1..cardinality(vals)-1 LOOP
      FOR j IN i+1..cardinality(vals) LOOP
        IF vals[i]=vals[j] THEN
          IF p_repeat='auto_pass' THEN RETURN 'OK'; END IF;
          IF p_repeat='send_variance' THEN RETURN 'Diff'; END IF;
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  RETURN CASE WHEN cardinality(vals)<p_max THEN 'PENDING' ELSE 'Diff' END;
END;
$$;

CREATE FUNCTION private.count_workflow_v279(p_bundle jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  max_rounds integer := (p_bundle#>>'{session,max_rounds}')::integer;
  repeat_action text := p_bundle#>>'{session,repeat_match_action}';
  baselines jsonb := '{}'::jsonb;
  first_baseline timestamptz;
  candidates jsonb := '[]'::jsonb;
  real_items boolean := false;
  row_value jsonb;
  b jsonb;
  item_id text;
  oh numeric;
  vals numeric[];
  item_status text;
  item_next integer;
  next_round integer;
  statuses text[] := ARRAY[]::text[];
  highest integer := 0;
  n integer;
  result_items jsonb := '[]'::jsonb;
  next_started boolean := false;
  result_status text;
BEGIN
  IF max_rounds IS NULL OR max_rounds NOT BETWEEN 1 AND 3 OR repeat_action IS NULL
    OR repeat_action NOT IN ('recount','auto_pass','send_variance') THEN
    RAISE EXCEPTION 'Invalid counting rules' USING ERRCODE='22023';
  END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(p_bundle->'baseline_audit')
      ORDER BY (value->>'created_at')::timestamptz,value->>'id' LOOP
    IF b->>'action' <> 'wms_import_count_baseline' THEN CONTINUE; END IF;
    first_baseline := LEAST(first_baseline,(b->>'created_at')::timestamptz);
    item_id := b->>'item_id';
    IF NOT baselines ? item_id THEN
      BEGIN
        oh := COALESCE(NULLIF(btrim(b->>'old_value'),''),'0')::numeric;
        IF oh::text NOT IN ('NaN','Infinity','-Infinity') THEN
          baselines := baselines || jsonb_build_object(item_id,oh);
        END IF;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN NULL;
      END;
    END IF;
  END LOOP;
  FOR row_value IN SELECT value FROM jsonb_array_elements(p_bundle->'snapshots') LOOP
    IF jsonb_typeof(row_value->'items') IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
    item_id := row_value->>'item_id';
    IF baselines <> '{}'::jsonb THEN
      IF NOT baselines ? item_id OR (row_value->>'created_at')::timestamptz>first_baseline THEN CONTINUE; END IF;
      row_value := jsonb_set(row_value,'{onhand_qty}',baselines->item_id);
    END IF;
    real_items := real_items OR btrim(replace(COALESCE(row_value#>>'{items,code}',''),chr(160),' '))<>'';
    candidates := candidates || jsonb_build_array(row_value);
  END LOOP;
  FOR row_value IN SELECT value FROM jsonb_array_elements(candidates) LOOP
    IF (btrim(replace(COALESCE(row_value#>>'{items,code}',''),chr(160),' '))<>'') IS DISTINCT FROM real_items THEN CONTINUE; END IF;
    IF NOT real_items AND cardinality(statuses)>0 THEN CONTINUE; END IF;
    item_id := row_value->>'item_id';
    oh := (row_value->>'onhand_qty')::numeric;
    SELECT ARRAY[
      max((value->>'count_qty')::numeric) FILTER (WHERE (value->>'round')::int=1),
      max((value->>'count_qty')::numeric) FILTER (WHERE (value->>'round')::int=2),
      max((value->>'count_qty')::numeric) FILTER (WHERE (value->>'round')::int=3)]
      INTO vals FROM jsonb_array_elements(p_bundle->'counts') WHERE value->>'item_id'=item_id;
    item_status := private.count_item_status_v279(oh,vals,max_rounds,repeat_action);
    item_next := NULL;
    FOR n IN 1..max_rounds LOOP
      IF vals[n] IS NULL THEN item_next:=n; EXIT; END IF;
      IF private.count_item_status_v279(oh,vals[1:n],max_rounds,repeat_action) IN ('OK','Diff') THEN EXIT; END IF;
    END LOOP;
    FOR n IN 1..3 LOOP IF vals[n] IS NOT NULL THEN highest:=GREATEST(highest,n); END IF; END LOOP;
    next_round := LEAST(next_round,item_next);
    statuses := array_append(statuses,item_status);
    result_items := result_items || jsonb_build_array(jsonb_build_object('item_id',item_id,
      'status',item_status,'next_round',item_next,'rounds',to_jsonb(vals),'onhand_qty',oh));
  END LOOP;
  IF cardinality(statuses)=0 THEN
    result_status := p_bundle#>>'{assignment,status}';
  ELSIF NOT (''=ANY(statuses) OR 'PENDING'=ANY(statuses)) THEN
    result_status := CASE WHEN 'Diff'=ANY(statuses) THEN 'round3_done' ELSE 'completed' END;
  ELSIF highest>0 THEN
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(result_items) x
      WHERE x->'rounds'->(next_round-1) <> 'null'::jsonb) INTO next_started;
    result_status := CASE WHEN next_round=2 AND NOT next_started THEN 'round1_done'
      WHEN next_round=3 AND NOT next_started THEN 'round2_done' ELSE 'in_progress' END;
  ELSE result_status := COALESCE(p_bundle#>>'{assignment,status}','pending');
  END IF;
  RETURN jsonb_build_object('status',result_status,'items',result_items,'next_round',next_round);
END;
$$;

CREATE FUNCTION public.get_count_offline_bundle_v279(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE state jsonb; bundle jsonb; workflow jsonb;
BEGIN
  state := private.count_sync_state_v279(p_assignment_id);
  IF NOT (state->>'open')::boolean THEN
    RAISE EXCEPTION 'งานหรือ Session นี้ปิดแล้ว' USING ERRCODE='CC409';
  END IF;
  bundle := public.get_count_read_bundle_v261(p_assignment_id,true);
  workflow := private.count_workflow_v279(bundle);
  IF jsonb_array_length(workflow->'items')=0 THEN
    RAISE EXCEPTION 'ไม่พบงานนับที่พร้อมใช้งาน' USING ERRCODE='22023';
  END IF;
  -- An empty placeholder needs Found Work creation if goods are discovered.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(workflow->'items') w
    JOIN jsonb_array_elements(bundle->'snapshots') s ON s->>'item_id'=w->>'item_id'
    WHERE btrim(replace(COALESCE(s#>>'{items,code}',''),chr(160),' '))='') THEN
    RAISE EXCEPTION 'Location ว่างต้องใช้หน้าตรวจนับออนไลน์เพื่อรองรับงานที่พบเพิ่ม' USING ERRCODE='0A000';
  END IF;
  RETURN state || jsonb_build_object('schema_version',1,'prepared_at',statement_timestamp(),
    'bundle',bundle,'workflow',workflow);
END;
$$;

CREATE FUNCTION private.submit_count_operation_v279(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  aid uuid := (p_request->>'assignment_id')::uuid;
  previous_id uuid := NULLIF(p_request->>'previous_operation_id','')::uuid;
  a public.assignments%ROWTYPE;
  receipt private.count_sync_receipts_v279%ROWTYPE;
  state jsonb;
  before_bundle jsonb;
  workflow jsonb;
  decision jsonb;
  record_value jsonb := p_request->'record';
  item_id uuid := (record_value->>'item_id')::uuid;
  count_round integer := (record_value->>'round')::integer;
  qty numeric := (record_value->>'count_qty')::numeric;
  expected_token text := p_request->>'state_token';
  saved jsonb;
  response jsonb;
  previous_status text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบใหม่' USING ERRCODE='42501'; END IF;
  IF p_operation_id IS NULL OR aid IS NULL OR item_id IS NULL OR jsonb_typeof(record_value) IS DISTINCT FROM 'object'
    OR octet_length(p_request::text)>65536
    OR expected_token IS NULL OR p_request->>'scope_token' IS NULL
    OR qty IS NULL OR qty<0 OR qty::text IN ('NaN','Infinity','-Infinity')
    OR count_round IS NULL OR count_round NOT BETWEEN 1 AND 3
    OR NULLIF(btrim(record_value->>'actual_counter_name'),'') IS NULL THEN
    RAISE EXCEPTION 'ข้อมูลผลนับไม่ครบหรือจำนวนไม่ถูกต้อง' USING ERRCODE='22023';
  END IF;
  -- Serialize duplicate UUIDs even when the caller accidentally changes assignment.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_operation_id::text,279));
  SELECT * INTO receipt FROM private.count_sync_receipts_v279
    WHERE actor_id=actor AND operation_id=p_operation_id;
  IF FOUND THEN
    IF receipt.request IS DISTINCT FROM p_request THEN
      RAISE EXCEPTION 'เลขอ้างอิงเดิมมีข้อมูลต่างกัน กรุณาตรวจทาน' USING ERRCODE='CC409';
    END IF;
    RETURN receipt.response;
  END IF;
  -- Receipt lookup precedes present-day assignment checks: an ACK lost before
  -- reassignment/closure can still be recovered by its authenticated owner.
  SELECT * INTO a FROM public.assignments WHERE id=aid FOR UPDATE;
  IF NOT FOUND OR a.assigned_to IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'ผู้รับผิดชอบงานเปลี่ยนแล้ว กรุณาตรวจทาน' USING ERRCODE='CC409';
  END IF;
  PERFORM 1 FROM public.count_sessions WHERE id=a.session_id FOR SHARE;
  PERFORM 1 FROM public.stock_snapshot WHERE session_id=a.session_id AND location_id=a.location_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.count_records c WHERE c.assignment_id=aid ORDER BY c.item_id,c.round FOR UPDATE;
  state := private.count_sync_state_v279(aid);
  IF NOT (state->>'open')::boolean OR state->>'scope_token' IS DISTINCT FROM p_request->>'scope_token' THEN
    RAISE EXCEPTION 'ขอบเขตงานหรือกติกาเปลี่ยนแล้ว ผลในเครื่องยังเก็บไว้ กรุณาตรวจทาน' USING ERRCODE='CC409';
  END IF;
  IF previous_id IS NOT NULL THEN
    SELECT * INTO receipt FROM private.count_sync_receipts_v279
      WHERE actor_id=actor AND operation_id=previous_id AND assignment_id=aid;
    IF NOT FOUND THEN RAISE EXCEPTION 'ต้องส่งรายการก่อนหน้าให้สำเร็จก่อน' USING ERRCODE='CC409'; END IF;
    expected_token := receipt.response->>'state_token';
  END IF;
  IF state->>'state_token' IS DISTINCT FROM expected_token THEN
    RAISE EXCEPTION 'ผลนับบนเซิร์ฟเวอร์เปลี่ยนแล้ว กรุณาตรวจทานก่อนส่ง' USING ERRCODE='CC409';
  END IF;
  before_bundle := public.get_count_read_bundle_v261(aid,true);
  workflow := private.count_workflow_v279(before_bundle);
  SELECT value INTO decision FROM jsonb_array_elements(workflow->'items') WHERE value->>'item_id'=item_id::text;
  IF NOT FOUND OR (decision->>'next_round')::int IS DISTINCT FROM count_round THEN
    RAISE EXCEPTION 'รอบนับของ Item นี้เปลี่ยนแล้ว กรุณาตรวจทาน' USING ERRCODE='CC409';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_bundle->'snapshots') s
    WHERE s->>'item_id'=item_id::text AND btrim(replace(COALESCE(s#>>'{items,code}',''),chr(160),' '))='') THEN
    RAISE EXCEPTION 'Location ว่างต้องใช้หน้าตรวจนับออนไลน์' USING ERRCODE='0A000';
  END IF;
  IF (NULLIF(btrim(record_value->>'remark'),'') IS NOT NULL OR NULLIF(btrim(record_value->>'photo_url'),'') IS NOT NULL)
    AND NULLIF(btrim(record_value->>'type_issue'),'') IS NULL THEN
    RAISE EXCEPTION 'มีหมายเหตุหรือรูป กรุณาเลือก Type Issue' USING ERRCODE='22023';
  END IF;
  SELECT to_jsonb(c) INTO saved FROM public.save_count_records_v122(jsonb_build_array(
    record_value || jsonb_build_object('assignment_id',aid))) c;
  IF saved IS NULL THEN RAISE EXCEPTION 'ไม่พบผลยืนยันการบันทึก' USING ERRCODE='55000'; END IF;
  INSERT INTO public.audit_log(session_id,location_id,assignment_id,item_id,action,old_value,new_value,performed_by)
    VALUES(a.session_id,a.location_id,aid,item_id,'count_recorded',NULL,
      left('รอบ '||count_round||' · QTY '||qty||' · ผู้ตรวจนับ '||(saved->>'actual_counter_name')
        ||CASE WHEN NULLIF(saved->>'type_issue','') IS NOT NULL THEN ' · Type Issue '||(saved->>'type_issue') ELSE '' END
        ||CASE WHEN NULLIF(saved->>'remark','') IS NOT NULL THEN ' · หมายเหตุ '||(saved->>'remark') ELSE '' END
        ||CASE WHEN NULLIF(saved->>'photo_url','') IS NOT NULL THEN ' · มีรูป' ELSE '' END,3000),actor);
  workflow := private.count_workflow_v279(public.get_count_read_bundle_v261(aid,false));
  previous_status := a.status;
  IF previous_status IS DISTINCT FROM workflow->>'status' THEN
    UPDATE public.assignments SET status=workflow->>'status' WHERE id=aid;
    INSERT INTO public.audit_log(session_id,location_id,assignment_id,action,old_value,new_value,performed_by)
      VALUES(a.session_id,a.location_id,aid,'count_workflow_update','สถานะ '||previous_status,
        'สถานะ '||(workflow->>'status')||' · ตรวจ DIFF หลังบันทึกทันที',actor);
  END IF;
  state := private.count_sync_state_v279(aid);
  response := state || jsonb_build_object('schema_version',1,'operation_id',p_operation_id,
    'record',saved,'status',workflow->>'status','received_at',clock_timestamp());
  INSERT INTO private.count_sync_receipts_v279(actor_id,operation_id,assignment_id,request,response)
    VALUES(actor,p_operation_id,aid,p_request,response);
  RETURN response;
END;
$$;

CREATE FUNCTION public.submit_count_operation_v279(p_operation_id uuid,p_request jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.submit_count_operation_v279(p_operation_id,p_request);
$$;

REVOKE ALL ON FUNCTION private.count_sync_state_v279(uuid),
  private.count_item_status_v279(numeric,numeric[],integer,text),private.count_workflow_v279(jsonb),
  private.submit_count_operation_v279(uuid,jsonb),public.get_count_offline_bundle_v279(uuid),
  public.submit_count_operation_v279(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.count_sync_state_v279(uuid),
  private.count_item_status_v279(numeric,numeric[],integer,text),private.count_workflow_v279(jsonb),
  private.submit_count_operation_v279(uuid,jsonb),public.get_count_offline_bundle_v279(uuid),
  public.submit_count_operation_v279(uuid,jsonb) TO authenticated;
