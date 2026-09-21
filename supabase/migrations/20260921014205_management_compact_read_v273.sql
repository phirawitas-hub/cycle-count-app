-- V2.73: lossless wire compaction and set-based OH baseline lookup.
-- Old RPC is retained for existing clients and same-snapshot equivalence tests.
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.get_management_read_bundle_v273(p_session_id uuid, p_tab text DEFAULT 'summary'::text, p_since_revision bigint DEFAULT NULL::bigint, p_since_catalog bigint DEFAULT NULL::bigint, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  clock_revision bigint;
  clock_full bigint;
  catalog_revision bigint;
  changed_locations uuid[];
  delta boolean := false;
  payload jsonb;
BEGIN
  IF actor_id IS NULL OR COALESCE((SELECT private.my_role()),'') NOT IN ('admin','supervisor') THEN
    RAISE EXCEPTION 'Management reads require an authenticated admin or supervisor' USING ERRCODE='42501';
  END IF;
  IF p_tab NOT IN ('summary','executive','wms','variance','layout','tracker','log','team','detail') OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'Invalid management scope' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.count_sessions WHERE id=p_session_id) THEN
    RAISE EXCEPTION 'Session is missing or inaccessible' USING ERRCODE='42501';
  END IF;
  SELECT revision,full_revision INTO clock_revision,clock_full
  FROM public.cycle_count_read_versions WHERE scope_key='session:'||p_session_id::text;
  SELECT revision INTO catalog_revision FROM public.cycle_count_read_versions WHERE scope_key='catalog';
  IF clock_revision IS NULL OR clock_full IS NULL OR catalog_revision IS NULL THEN
    RAISE EXCEPTION 'Read version metadata is missing; rerun the V2.63 migration' USING ERRCODE='55000';
  END IF;
  IF p_location_id IS NULL AND p_since_revision=clock_revision AND p_since_catalog=catalog_revision THEN
    RETURN jsonb_build_object('schema_version',1,'actor_id',actor_id,'session_id',p_session_id,'tab',p_tab,
      'revision',clock_revision,'catalog_revision',catalog_revision,'unchanged',true,'generated_at',statement_timestamp());
  END IF;
  IF p_location_id IS NOT NULL THEN changed_locations:=ARRAY[p_location_id];delta:=true;
  ELSIF p_since_revision IS NOT NULL AND p_since_revision>=clock_full AND p_since_revision<clock_revision
      AND p_since_catalog=catalog_revision THEN
    SELECT array_agg(location_id ORDER BY location_id) INTO changed_locations
    FROM public.cycle_count_location_versions WHERE session_id=p_session_id AND revision>p_since_revision;
    -- Missing tombstones/large changes get one full consistent read.
    delta:=COALESCE(cardinality(changed_locations),0)>0 AND cardinality(changed_locations)<=160;
    IF NOT delta THEN changed_locations:=NULL;END IF;
  END IF;

  -- Assignment IDs and child rows are read in the SAME STABLE call. No
  -- client-side ID list from an earlier HTTP request can disagree with it.
  WITH scope AS MATERIALIZED (
    SELECT a.id,a.session_id,a.location_id,a.assigned_to,a.status,a.assigned_at,a.created_at,
      a.counter_r2_id,a.counter_r3_id,a.wms_closed_at,a.wms_closed_by
    FROM public.assignments a WHERE a.session_id=p_session_id
      AND (NOT delta OR a.location_id=ANY(changed_locations))
  ), snapshot_rows AS MATERIALIZED (
    SELECT s.id,s.session_id,s.created_at,s.location_id,s.item_id,s.onhand_qty,s.al_qty
    FROM public.stock_snapshot s WHERE s.session_id=p_session_id
      AND (NOT delta OR s.location_id=ANY(changed_locations))
  ), count_rows AS MATERIALIZED (
    SELECT c.id,c.assignment_id,c.item_id,c.round,c.count_qty,c.counted_by,c.counted_at,c.actual_counter_name,
      c.type_issue,c.remark,CASE WHEN p_tab IN ('executive','detail','tracker','layout') THEN c.photo_url ELSE NULL END photo_url
    FROM public.count_records c JOIN scope a ON a.id=c.assignment_id
  ), approval_rows AS MATERIALIZED (
    SELECT v.* FROM public.variance_approvals v JOIN scope a ON a.id=v.assignment_id
  ), counted_assignments AS MATERIALIZED (
    SELECT DISTINCT assignment_id FROM count_rows
  ), zero_baselines AS MATERIALIZED (
    -- Build the same baseline existence set once, not once per snapshot row.
    -- Keep the original NULL/blank/numeric-zero semantics used for OH recovery.
    SELECT DISTINCT b.assignment_id,b.item_id
    FROM public.audit_log b JOIN scope a ON a.id=b.assignment_id
    WHERE b.action='wms_import_count_baseline' AND b.session_id=p_session_id
      AND (b.old_value IS NULL OR btrim(b.old_value)=''
        OR b.old_value ~ '^[[:space:]]*[+-]?0([.]0+)?([eE][+-]?[0-9]+)?[[:space:]]*$')
  ), recovery_locations AS MATERIALIZED (
    SELECT DISTINCT s.location_id
    FROM snapshot_rows s JOIN scope a ON a.location_id=s.location_id
    JOIN counted_assignments c ON c.assignment_id=a.id
    LEFT JOIN zero_baselines b ON b.assignment_id=a.id AND b.item_id=s.item_id
    WHERE s.onhand_qty=0 OR b.assignment_id IS NOT NULL
  ), audit_rows AS MATERIALIZED (
    SELECT l.id,l.session_id,l.location_id,l.item_id,l.assignment_id,l.action,l.old_value,l.new_value,l.created_at
    FROM public.audit_log l JOIN scope a ON a.id=l.assignment_id
    WHERE (l.action='wms_import_count_baseline' AND l.session_id=p_session_id)
      OR (p_tab IN ('summary','executive','wms') AND l.action='wms_status_change')
      OR (p_tab='wms' AND l.action IN ('wms_note','wms_note_removed'))
      OR (l.session_id=p_session_id AND a.location_id IN (SELECT location_id FROM recovery_locations))
  ), detail_rows AS MATERIALIZED (
    SELECT d.id,d.session_id,d.location_id,d.item_id,d.license_plate,d.lot,d.inventory_status,d.qty,d.uom
    FROM public.stock_snapshot_detail d WHERE d.session_id=p_session_id
      AND (NOT delta OR d.location_id=ANY(changed_locations))
      AND (p_tab IN ('tracker','detail') OR d.location_id IN (SELECT location_id FROM recovery_locations))
  ), job_rows AS MATERIALIZED (
    SELECT j.id,j.session_id,j.job_code,j.assigned_to,j.status,j.job_no
    FROM public.annual_count_jobs j WHERE j.session_id=p_session_id AND p_tab IN ('layout','tracker','detail')
  ), job_item_rows AS MATERIALIZED (
    SELECT j.id,j.session_id,j.job_id,j.location_id,j.item_id,j.sort_order
    FROM public.annual_count_job_items j WHERE j.session_id=p_session_id AND p_tab IN ('layout','tracker','detail')
      AND (NOT delta OR j.location_id=ANY(changed_locations))
  ), found_rows AS MATERIALIZED (
    SELECT f.id,f.session_id,f.status,f.source_type,f.location_code,f.license_plate,f.lot,f.inventory_status,
      f.item_code,f.description,f.uom,f.qty,f.actual_counter_name,f.discovered_at,f.discovered_by,
      f.assignment_id,f.location_id,f.item_id,f.type_issue,f.remark,f.reviewed_at,f.supervisor_note,
      CASE WHEN p_tab='executive' THEN f.photo_url ELSE NULL END photo_url
    FROM public.found_items f WHERE f.session_id=p_session_id
      AND (p_tab='executive' OR (p_tab IN ('summary','variance','wms') AND f.status='pending_review'))
  ), paper_rows AS MATERIALIZED (
    SELECT p.id,p.session_id,p.source_type,p.source_assignment_id,p.source_location_id,p.source_item_id,
      p.location_code,p.item_code,p.count1,p.count2,p.count3,p.physical_count,p.updated_at,p.created_at
    FROM public.paper_form_counts p WHERE p.session_id=p_session_id AND p_tab='executive'
      AND p.source_type='paper_form' AND (SELECT private.my_role())='admin'
  ), item_ids AS MATERIALIZED (
    SELECT item_id id FROM snapshot_rows UNION SELECT item_id FROM count_rows UNION SELECT item_id FROM approval_rows
  ), item_rows AS MATERIALIZED (
    SELECT i.id,i.code,i.description,i.uom,i.category FROM public.items i
    WHERE i.id IN (SELECT id FROM item_ids) OR (p_tab='executive' AND i.code IN (SELECT item_code FROM found_rows))
  ), location_rows AS MATERIALIZED (
    SELECT l.id,l.code,l.zone,l.area,l.row_no,l.level FROM public.locations l
    WHERE l.id IN (SELECT location_id FROM scope UNION SELECT location_id FROM snapshot_rows)
  ), actor_ids AS MATERIALIZED (
    SELECT assigned_to id FROM scope UNION SELECT counted_by FROM count_rows
    UNION SELECT approved_by FROM approval_rows UNION SELECT wms_fixed_by FROM approval_rows
    UNION SELECT draft_saved_by FROM approval_rows UNION SELECT assigned_to FROM job_rows
    UNION SELECT discovered_by FROM found_rows
  ), profile_rows AS MATERIALIZED (
    SELECT p.id,p.name FROM public.profiles p WHERE p.id IN (SELECT id FROM actor_ids)
  ), remark_rows AS MATERIALIZED (
    SELECT r.id,r.label FROM public.remark_options r WHERE p_tab='wms' AND r.context='wms' AND r.active IS TRUE
  ), master_rows AS MATERIALIZED (
    SELECT m.item_code id,m.item_code,m.attributes FROM public.data_info_items m
    WHERE p_tab='executive' AND NULLIF(btrim(m.item_code),'') IS NOT NULL
      AND m.item_code IN (SELECT code FROM item_rows UNION SELECT item_code FROM found_rows)
  ), setting_rows AS MATERIALIZED (
    SELECT s.key id,s.key,s.value FROM public.app_settings s
    WHERE (p_tab='layout' AND s.key IN ('warehouse_layout_v1','plan_location_v1'))
      OR (p_tab='summary' AND s.key='plan_location_v1')
  )
  SELECT jsonb_build_object(
    'schema_version',1,'actor_id',actor_id,'session_id',p_session_id,'tab',p_tab,'unchanged',false,
    'revision',clock_revision,'catalog_revision',catalog_revision,'generated_at',statement_timestamp(),
    'delta',delta,'location_ids',COALESCE(to_jsonb(changed_locations),'[]'::jsonb),
    'rules',(SELECT jsonb_build_object('max_rounds',s.max_rounds,'repeat_match_action',s.repeat_match_action)
      FROM public.count_sessions s WHERE s.id=p_session_id),
    'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.location_id,r.assigned_to,r.status,r.assigned_at,r.created_at,r.counter_r2_id,r.counter_r3_id,r.wms_closed_at,r.wms_closed_by) ORDER BY r.id) FROM scope r),'[]'::jsonb),
    'snapshots',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.created_at,r.location_id,r.item_id,r.onhand_qty,r.al_qty) ORDER BY r.id) FROM snapshot_rows r),'[]'::jsonb),
    'counts',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.assignment_id,r.item_id,r.round,r.count_qty,r.counted_by,r.counted_at,r.actual_counter_name,r.type_issue,r.remark,r.photo_url) ORDER BY r.id) FROM count_rows r),'[]'::jsonb),
    'approvals',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.assignment_id,r.item_id,r.final_qty,r.variance,r.resolution,r.supervisor_note,r.approved_by,r.approved_at,r.wms_fixed,r.wms_fixed_at,r.wms_fixed_by,r.review_status,r.released_to_wms,r.draft_saved_by,r.draft_saved_at,r.updated_at) ORDER BY r.id) FROM approval_rows r),'[]'::jsonb),
    'audit',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.location_id,r.item_id,r.assignment_id,r.action,r.old_value,r.new_value,r.created_at) ORDER BY r.created_at,r.id) FROM audit_rows r),'[]'::jsonb),
    'details',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.location_id,r.item_id,r.license_plate,r.lot,r.inventory_status,r.qty,r.uom) ORDER BY r.id) FROM detail_rows r),'[]'::jsonb),
    'jobs',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.job_code,r.assigned_to,r.status,r.job_no) ORDER BY r.job_no,r.id) FROM job_rows r),'[]'::jsonb),
    'job_items',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.job_id,r.location_id,r.item_id,r.sort_order) ORDER BY r.sort_order,r.id) FROM job_item_rows r),'[]'::jsonb),
    'found',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.status,r.source_type,r.location_code,r.license_plate,r.lot,r.inventory_status,r.item_code,r.description,r.uom,r.qty,r.actual_counter_name,r.discovered_at,r.discovered_by,r.assignment_id,r.location_id,r.item_id,r.type_issue,r.remark,r.reviewed_at,r.supervisor_note,r.photo_url) ORDER BY r.discovered_at,r.id) FROM found_rows r),'[]'::jsonb),
    'paper',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.session_id,r.source_type,r.source_assignment_id,r.source_location_id,r.source_item_id,r.location_code,r.item_code,r.count1,r.count2,r.count3,r.physical_count,r.updated_at,r.created_at) ORDER BY r.id) FROM paper_rows r),'[]'::jsonb),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.code,r.description,r.uom,r.category) ORDER BY r.id) FROM item_rows r),'[]'::jsonb),
    'locations',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.code,r.zone,r.area,r.row_no,r.level) ORDER BY r.id) FROM location_rows r),'[]'::jsonb),
    'profiles',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.name) ORDER BY r.id) FROM profile_rows r),'[]'::jsonb),
    'remarks',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.label) ORDER BY r.label,r.id) FROM remark_rows r),'[]'::jsonb),
    'master',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.item_code,r.attributes) ORDER BY r.id) FROM master_rows r),'[]'::jsonb),
    'settings',COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.key,r.value) ORDER BY r.id) FROM setting_rows r),'[]'::jsonb),
    -- Column names are sent once per collection. No values/rows are omitted.
    'wire_format','columns-v1',
    'columns','{"assignments":["id","session_id","location_id","assigned_to","status","assigned_at","created_at","counter_r2_id","counter_r3_id","wms_closed_at","wms_closed_by"],"snapshots":["id","session_id","created_at","location_id","item_id","onhand_qty","al_qty"],"counts":["id","assignment_id","item_id","round","count_qty","counted_by","counted_at","actual_counter_name","type_issue","remark","photo_url"],"approvals":["id","assignment_id","item_id","final_qty","variance","resolution","supervisor_note","approved_by","approved_at","wms_fixed","wms_fixed_at","wms_fixed_by","review_status","released_to_wms","draft_saved_by","draft_saved_at","updated_at"],"audit":["id","session_id","location_id","item_id","assignment_id","action","old_value","new_value","created_at"],"details":["id","session_id","location_id","item_id","license_plate","lot","inventory_status","qty","uom"],"jobs":["id","session_id","job_code","assigned_to","status","job_no"],"job_items":["id","session_id","job_id","location_id","item_id","sort_order"],"found":["id","session_id","status","source_type","location_code","license_plate","lot","inventory_status","item_code","description","uom","qty","actual_counter_name","discovered_at","discovered_by","assignment_id","location_id","item_id","type_issue","remark","reviewed_at","supervisor_note","photo_url"],"paper":["id","session_id","source_type","source_assignment_id","source_location_id","source_item_id","location_code","item_code","count1","count2","count3","physical_count","updated_at","created_at"],"items":["id","code","description","uom","category"],"locations":["id","code","zone","area","row_no","level"],"profiles":["id","name"],"remarks":["id","label"],"master":["id","item_code","attributes"],"settings":["id","key","value"]}'::jsonb,
    'row_counts',jsonb_build_object(
      'assignments',(SELECT count(*) FROM scope),
      'snapshots',(SELECT count(*) FROM snapshot_rows),
      'counts',(SELECT count(*) FROM count_rows),
      'approvals',(SELECT count(*) FROM approval_rows),
      'audit',(SELECT count(*) FROM audit_rows),
      'details',(SELECT count(*) FROM detail_rows),
      'jobs',(SELECT count(*) FROM job_rows),
      'job_items',(SELECT count(*) FROM job_item_rows),
      'found',(SELECT count(*) FROM found_rows),
      'paper',(SELECT count(*) FROM paper_rows),
      'items',(SELECT count(*) FROM item_rows),
      'locations',(SELECT count(*) FROM location_rows),
      'profiles',(SELECT count(*) FROM profile_rows),
      'remarks',(SELECT count(*) FROM remark_rows),
      'master',(SELECT count(*) FROM master_rows),
      'settings',(SELECT count(*) FROM setting_rows)
    )
  ) INTO payload;
  RETURN payload;
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_management_read_bundle_v273(uuid,text,bigint,bigint,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_management_read_bundle_v273(uuid,text,bigint,bigint,uuid) TO authenticated;
COMMENT ON FUNCTION public.get_management_read_bundle_v273(uuid,text,bigint,bigint,uuid) IS
  'V2.73 lossless columnar management read; same RLS, revisions, rows and OH recovery as V2.63. Decode before validation.';
