CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL);
CREATE TABLE public.count_sessions(id uuid PRIMARY KEY,name text,status text DEFAULT 'active',closed_at timestamptz,
  max_rounds int DEFAULT 3,repeat_match_action text DEFAULT 'recount',show_oh boolean DEFAULT true,count_mode text DEFAULT 'cycle');
CREATE TABLE public.locations(id uuid PRIMARY KEY,code text,zone text,area text,row_no text,level text);
CREATE TABLE public.items(id uuid PRIMARY KEY,code text,description text);
CREATE TABLE public.assignments(id uuid PRIMARY KEY,session_id uuid,location_id uuid,assigned_to uuid,
  status text DEFAULT 'pending',assigned_at timestamptz DEFAULT now(),wms_closed_at timestamptz);
CREATE TABLE public.stock_snapshot(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,location_id uuid,
  item_id uuid,onhand_qty numeric,al_qty numeric DEFAULT 0,created_at timestamptz DEFAULT now());
CREATE TABLE public.count_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid,item_id uuid,
  round smallint,count_qty numeric,counted_by uuid,counted_at timestamptz DEFAULT now(),actual_counter_name text,
  type_issue text,remark text,photo_url text,UNIQUE(assignment_id,item_id,round));
CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz DEFAULT now(),
  session_id uuid,location_id uuid,assignment_id uuid,item_id uuid,action text,old_value text,new_value text,performed_by uuid);
CREATE TABLE public.stock_snapshot_detail(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,location_id uuid,
  item_id uuid,license_plate text,lot text,inventory_status text,qty numeric,uom text);
CREATE TABLE public.counter_names(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,active boolean DEFAULT true);
CREATE TABLE public.remark_options(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),label text,context text,active boolean DEFAULT true);
CREATE TABLE public.type_issue_options(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),value text,label text,sort_order int,active boolean DEFAULT true);
CREATE TABLE public.annual_count_job_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,location_id uuid);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_own_assignment ON public.assignments FOR SELECT TO authenticated USING (assigned_to=auth.uid());
ALTER TABLE public.count_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_own_counts ON public.count_records FOR SELECT TO authenticated USING
  (EXISTS(SELECT 1 FROM public.assignments a WHERE a.id=assignment_id AND a.assigned_to=auth.uid()));
