-- Teacher location captured at the moment attendance is submitted.

CREATE TABLE IF NOT EXISTS public.attendance_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id TEXT NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    accuracy_m DOUBLE PRECISION CHECK (accuracy_m >= 0),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_locations_class_date
    ON public.attendance_locations(class_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_locations_teacher
    ON public.attendance_locations(teacher_id, captured_at DESC);

ALTER TABLE public.attendance_locations ENABLE ROW LEVEL SECURITY;

-- Admins: read everything, delete for retention clean-up.
CREATE POLICY "attendance_locations_select_admin" ON public.attendance_locations
    FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE POLICY "attendance_locations_delete_admin" ON public.attendance_locations
    FOR DELETE TO authenticated
    USING (public.is_admin());

-- Teachers: read only their own rows.
CREATE POLICY "attendance_locations_select_own" ON public.attendance_locations
    FOR SELECT TO authenticated
    USING (teacher_id = public.get_current_teacher_id());

-- Teachers: insert only as themselves, only for an assigned class.
-- No UPDATE policy: captured locations are immutable.
CREATE POLICY "attendance_locations_insert_teacher" ON public.attendance_locations
    FOR INSERT TO authenticated
    WITH CHECK (
        teacher_id = public.get_current_teacher_id()
        AND public.is_teacher_assigned_to_class(class_id)
    );
