-- V2.84: allow explicit zero counts for prepared empty locations.
-- Keep the existing actor checks, locks, version checks, grants and receipt IDs.
CREATE OR REPLACE FUNCTION public.get_count_offline_bundle_v279(p_assignment_id uuid)
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
  -- Prepare verified zero-OH placeholders; positive discoveries still require Found Work.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(workflow->'items') w
    JOIN jsonb_array_elements(bundle->'snapshots') s ON s->>'item_id'=w->>'item_id'
    WHERE btrim(replace(COALESCE(s#>>'{items,code}',''),chr(160),' '))=''
      AND (s->>'onhand_qty')::numeric IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Location ว่างต้องใช้หน้าตรวจนับออนไลน์เพื่อรองรับงานที่พบเพิ่ม' USING ERRCODE='0A000';
  END IF;
  RETURN state || jsonb_build_object('schema_version',1,'prepared_at',statement_timestamp(),
    'bundle',bundle,'workflow',workflow);
END;
$$;

CREATE OR REPLACE FUNCTION private.submit_count_operation_v279(p_operation_id uuid,p_request jsonb)
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
    WHERE s->>'item_id'=item_id::text AND btrim(replace(COALESCE(s#>>'{items,code}',''),chr(160),' '))=''
      AND (qty IS DISTINCT FROM 0 OR (s->>'onhand_qty')::numeric IS DISTINCT FROM 0)) THEN
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
