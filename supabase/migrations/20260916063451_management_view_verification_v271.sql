-- Metadata-only reuse of the existing authorized management read contract.
-- No new data visibility, no operational writes, no RLS changes.
CREATE OR REPLACE FUNCTION public.get_management_view_version_v271(p_session_id uuid,p_tab text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  actor_role text := (SELECT private.my_role());
  session_revision bigint;
  catalog_revision bigint;
  result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR COALESCE(actor_role,'') NOT IN ('admin','supervisor') THEN
    RAISE EXCEPTION 'Management reads require an authenticated admin or supervisor' USING ERRCODE='42501';
  END IF;
  IF p_session_id IS NULL OR p_tab IS NULL OR p_tab NOT IN ('summary','executive','team','log') THEN
    RAISE EXCEPTION 'Invalid management view scope' USING ERRCODE='22023';
  END IF;
  SELECT revision INTO session_revision FROM public.cycle_count_read_versions
    WHERE scope_key='session:'||p_session_id::text;
  SELECT revision INTO catalog_revision FROM public.cycle_count_read_versions WHERE scope_key='catalog';
  IF session_revision IS NULL OR catalog_revision IS NULL THEN
    RAISE EXCEPTION 'Management read version metadata is missing' USING ERRCODE='55000';
  END IF;
  -- The nested STABLE call uses the same snapshot and performs the original
  -- actor, role and Session authorization checks before returning metadata.
  result := public.get_management_read_bundle_v263(p_session_id,p_tab,session_revision,catalog_revision,NULL);
  IF result->>'unchanged' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Management version could not be verified' USING ERRCODE='55000';
  END IF;
  RETURN result || jsonb_build_object('actor_role',actor_role);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_management_view_version_v271(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_management_view_version_v271(uuid,text) TO authenticated;
