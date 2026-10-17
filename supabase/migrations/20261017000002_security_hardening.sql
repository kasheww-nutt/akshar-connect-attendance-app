-- Security hardening from audit.

-- 1. Never trust client-supplied role / teacher_id at signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, name, role, teacher_id)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        'TEACHER',
        NULL
    );
    RETURN NEW;
END;
$$;

-- 2. Users may no longer edit their own profile row directly
--    (prevents self-reassigning teacher_id / role). Admins keep full update.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

-- 3. Pin search_path on SECURITY DEFINER helpers and restrict execution.
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_current_teacher_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_teacher_assigned_to_class(TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_teacher_assigned_to_student(TEXT) SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_current_teacher_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_teacher_assigned_to_class(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_teacher_assigned_to_student(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_teacher_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_teacher_assigned_to_class(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_teacher_assigned_to_student(TEXT) TO authenticated;

-- 4. Attendance: the student must actually belong to the class being written.
DROP POLICY IF EXISTS "attendance_insert_teacher" ON public.attendance_records;
CREATE POLICY "attendance_insert_teacher" ON public.attendance_records
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_teacher_assigned_to_class(class_id)
        AND EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = student_id AND s.class_id = attendance_records.class_id
        )
    );

DROP POLICY IF EXISTS "attendance_update_teacher" ON public.attendance_records;
CREATE POLICY "attendance_update_teacher" ON public.attendance_records
    FOR UPDATE TO authenticated
    USING (public.is_teacher_assigned_to_class(class_id))
    WITH CHECK (
        public.is_teacher_assigned_to_class(class_id)
        AND EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = student_id AND s.class_id = attendance_records.class_id
        )
    );
