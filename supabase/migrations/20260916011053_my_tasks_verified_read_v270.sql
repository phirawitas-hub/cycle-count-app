-- V2.70. No operational data, table grants or existing RLS policies change.
-- The private helper exposes only a self-scoped change token. Operational
-- rows continue to be read with the authenticated caller's existing RLS.
CREATE OR REPLACE FUNCTION private.my_tasks_version_v270()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  actor_role text := (SELECT private.my_role());
  catalog_revision bigint;
  session_versions jsonb;
  missing_metadata boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('admin','supervisor','counter') THEN
    RAISE EXCEPTION 'Task reads require an authenticated application user' USING ERRCODE='42501';
  END IF;
  SELECT revision INTO catalog_revision FROM public.cycle_count_read_versions WHERE scope_key='catalog';
  -- Recompute current membership, including empty/new/deleted/reassigned work.
  -- No caller-supplied actor or Session IDs are accepted by this helper.
  WITH own_sessions AS (
    SELECT a.session_id FROM public.assignments a WHERE a.assigned_to=actor_id
    UNION
    SELECT j.session_id FROM public.annual_count_jobs j WHERE j.assigned_to=actor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_array(s.session_id,v.revision) ORDER BY s.session_id),'[]'::jsonb),
         COALESCE(bool_or(v.revision IS NULL),false)
  INTO session_versions,missing_metadata
  FROM own_sessions s LEFT JOIN public.cycle_count_read_versions v ON v.scope_key='session:'||s.session_id::text;
  IF catalog_revision IS NULL OR missing_metadata THEN
    RAISE EXCEPTION 'Task read version metadata is missing' USING ERRCODE='55000';
  END IF;
  RETURN encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'actor_id',actor_id,'actor_role',actor_role,
    'catalog_revision',catalog_revision,'sessions',session_versions
  )::text,'UTF8')),'hex');
END;
$function$;

REVOKE ALL ON FUNCTION private.my_tasks_version_v270() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.my_tasks_version_v270() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_tasks_read_bundle_v270(p_known_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  actor_role text := (SELECT private.my_role());
  current_token text;
  workspace jsonb;
  baseline_rows jsonb;
  sizes jsonb := '{}'::jsonb;
  field_name text;
  header jsonb;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('admin','supervisor','counter') THEN
    RAISE EXCEPTION 'Task reads require an authenticated application user' USING ERRCODE='42501';
  END IF;
  -- STABLE nested reads use this statement's snapshot for token, rows and OH.
  current_token := private.my_tasks_version_v270();
  header := jsonb_build_object('schema_version',1,'actor_id',actor_id,'actor_role',actor_role,
    'version_token',current_token,'generated_at',statement_timestamp());
  IF p_known_token=current_token THEN
    RETURN header || jsonb_build_object('unchanged',true);
  END IF;
  workspace := public.get_my_tasks_workspace();
  IF workspace IS NULL OR jsonb_typeof(workspace)<>'object' THEN
    RAISE EXCEPTION 'Task workspace is incomplete' USING ERRCODE='22023';
  END IF;
  -- Preserve the existing baseline selection and RLS; never read others' work.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',l.id,'assignment_id',l.assignment_id,'item_id',l.item_id,'action',l.action,
    'old_value',l.old_value,'new_value',l.new_value,'created_at',l.created_at
  ) ORDER BY l.created_at,l.id),'[]'::jsonb)
  INTO baseline_rows
  FROM public.audit_log l
  JOIN public.assignments a ON a.id=l.assignment_id AND a.assigned_to=actor_id
  WHERE l.action='wms_import_count_baseline';
  workspace := workspace || jsonb_build_object('baselines',baseline_rows);
  FOREACH field_name IN ARRAY ARRAY['assignments','annual_jobs','annual_items','counts','snapshots','session_rules','baselines']
  LOOP
    IF COALESCE(jsonb_typeof(workspace->field_name),'')<>'array' THEN
      RAISE EXCEPTION 'Task workspace field % is incomplete',field_name USING ERRCODE='22023';
    END IF;
    sizes := sizes || jsonb_build_object(field_name,jsonb_array_length(workspace->field_name));
  END LOOP;
  RETURN workspace || header || jsonb_build_object('unchanged',false,'row_counts',sizes);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_tasks_read_bundle_v270(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_tasks_read_bundle_v270(text) TO authenticated;

COMMENT ON FUNCTION public.get_my_tasks_read_bundle_v270(text) IS
  'V2.70: authorized version-checked My Tasks read, preserving caller RLS and a single STABLE snapshot. No stale offline fallback.';
