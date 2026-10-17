import {
  Teacher,
  ClassEntity,
  Student,
  AttendanceRecord,
  AttendanceStatus,
  DashboardStats,
  ClassAttendanceSummary,
  AttendanceSummary,
  AttendanceLocation,
  User
} from '../types';
import { getFreshMockDatabase, MockDatabaseState } from '../data/mockDatabase';
import { authService } from './authService';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const STORAGE_KEY = 'akshar_connect_records_v5';
const LOCATIONS_KEY = 'akshar_connect_locations_v1';

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

class DataService {
  private loadData(): MockDatabaseState {
    try {
      const serialized = localStorage.getItem(STORAGE_KEY);
      if (!serialized) {
        return this.resetData();
      }
      const parsed = JSON.parse(serialized) as MockDatabaseState;
      if (!parsed.teachers || !parsed.classes || !parsed.students || !parsed.attendance) {
        return this.resetData();
      }
      // Migrate legacy class names or locations if present
      const hasLegacyNamesOrLocations = parsed.classes.some(c =>
        c.name.includes('Navchetna') || c.name.includes('Standard') || (c.learningCenter && c.learningCenter.length > 0)
      );
      if (hasLegacyNamesOrLocations) {
        return this.resetData();
      }
      return parsed;
    } catch (e) {
      console.error('Error loading data from localStorage, resetting to defaults', e);
      return this.resetData();
    }
  }

  private saveData(data: MockDatabaseState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
      throw new Error('Storage quota exceeded or storage unavailable.');
    }
  }

  public resetData(): MockDatabaseState {
    const fresh = getFreshMockDatabase();
    this.saveData(fresh);
    return fresh;
  }

  private useRemote(): boolean {
    return isSupabaseConfigured && !authService.getCurrentUser()?.isDemo;
  }

  // ===================== AUTHORIZATION HELPERS =====================

  public getCurrentUserOrThrow(): User {
    const user = authService.getCurrentUser();
    if (!user) {
      throw new AuthorizationError('Authentication required: No active session found.');
    }
    return user;
  }

  public requireAdmin(): User {
    const user = this.getCurrentUserOrThrow();
    if (user.role !== 'ADMIN') {
      throw new AuthorizationError('Access denied: Administrator privileges required for this operation.');
    }
    return user;
  }

  public requireClassAccess(classId: string): { user: User; isAdmin: boolean } {
    const user = this.getCurrentUserOrThrow();
    if (user.role === 'ADMIN') {
      return { user, isAdmin: true };
    }

    if (user.role === 'TEACHER') {
      if (!user.teacherId) {
        throw new AuthorizationError('Access denied: User account is not linked to an educator profile.');
      }

      const data = this.loadData();
      const cls = data.classes.find(c => c.id === classId);
      if (!cls) {
        throw new Error(`Class with ID "${classId}" not found.`);
      }

      const teacher = data.teachers.find(t => t.id === user.teacherId);
      const isAssigned =
        (teacher && teacher.assignedClassIds.includes(classId)) ||
        cls.assignedTeacherId === user.teacherId;

      if (!isAssigned) {
        throw new AuthorizationError(
          `Access denied: Educator "${user.name}" is not assigned to class "${cls.name}" (${classId}).`
        );
      }

      return { user, isAdmin: false };
    }

    throw new AuthorizationError('Access denied: Unauthorized role.');
  }

  // ===================== TEACHERS CRUD =====================

  /**
   * Only Administrators may list all teachers.
   */
  public async getTeachers(): Promise<Teacher[]> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      try {
        const { data: rawTeachers, error } = await supabase
          .from('teachers')
          .select('*, teacher_classes(class_id)')
          .order('name');

        if (!error && rawTeachers) {
          return rawTeachers.map(t => ({
            id: t.id,
            name: t.name,
            email: t.email,
            phone: t.phone,
            status: t.status,
            qualification: t.qualification || undefined,
            joinedDate: t.joined_date,
            assignedClassIds: (t.teacher_classes || []).map((tc: any) => tc.class_id)
          }));
        }
        console.warn('[DataService] Supabase getTeachers error, falling back to local store:', error?.message);
      } catch (err) {
        console.warn('[DataService] Exception querying Supabase teachers:', err);
      }
    }

    const data = this.loadData();
    return [...data.teachers];
  }

  /**
   * Admin can view any teacher; Teachers may only view their own profile.
   */
  public async getTeacherById(id: string): Promise<Teacher | null> {
    const user = this.getCurrentUserOrThrow();
    if (user.role === 'TEACHER' && user.teacherId !== id) {
      throw new AuthorizationError('Access denied: Educators may only view their own profile.');
    }

    if (this.useRemote() && supabase) {
      try {
        const { data: t, error } = await supabase
          .from('teachers')
          .select('*, teacher_classes(class_id)')
          .eq('id', id)
          .maybeSingle();

        if (!error && t) {
          return {
            id: t.id,
            name: t.name,
            email: t.email,
            phone: t.phone,
            status: t.status,
            qualification: t.qualification || undefined,
            joinedDate: t.joined_date,
            assignedClassIds: (t.teacher_classes || []).map((tc: any) => tc.class_id)
          };
        }
        if (!error && !t) {
          return null;
        }
      } catch (err) {}
    }

    const data = this.loadData();
    const teacher = data.teachers.find(t => t.id === id);
    return teacher ? { ...teacher } : null;
  }

  /**
   * Only Administrators may create teachers.
   */
  public async createTeacher(teacherInput: Omit<Teacher, 'id'>): Promise<Teacher> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const { data: teacher, error } = await supabase
        .from('teachers')
        .insert({
          name: teacherInput.name,
          email: teacherInput.email,
          phone: teacherInput.phone,
          status: teacherInput.status,
          qualification: teacherInput.qualification || null,
          joined_date: teacherInput.joinedDate || new Date().toISOString().split('T')[0]
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      if (teacherInput.assignedClassIds && teacherInput.assignedClassIds.length > 0) {
        const assignments = teacherInput.assignedClassIds.map(classId => ({
          teacher_id: teacher.id,
          class_id: classId
        }));
        await supabase.from('teacher_classes').insert(assignments);
      }

      return {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        phone: teacher.phone,
        status: teacher.status,
        qualification: teacher.qualification || undefined,
        joinedDate: teacher.joined_date,
        assignedClassIds: teacherInput.assignedClassIds || []
      };
    }

    const data = this.loadData();
    const newId = `tch-${Date.now()}`;
    const newTeacher: Teacher = {
      ...teacherInput,
      id: newId,
      assignedClassIds: teacherInput.assignedClassIds || []
    };

    if (newTeacher.assignedClassIds.length > 0) {
      data.classes = data.classes.map(cls => {
        if (newTeacher.assignedClassIds.includes(cls.id)) {
          return {
            ...cls,
            assignedTeacherId: newTeacher.id,
            assignedTeacherName: newTeacher.name
          };
        }
        return cls;
      });
    }

    data.teachers.push(newTeacher);
    this.saveData(data);
    return { ...newTeacher };
  }

  /**
   * Only Administrators may update teachers.
   */
  public async updateTeacher(id: string, updates: Partial<Teacher>): Promise<Teacher> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const teacherPayload: Record<string, any> = {};
      if (updates.name !== undefined) teacherPayload.name = updates.name;
      if (updates.email !== undefined) teacherPayload.email = updates.email;
      if (updates.phone !== undefined) teacherPayload.phone = updates.phone;
      if (updates.status !== undefined) teacherPayload.status = updates.status;
      if (updates.qualification !== undefined) teacherPayload.qualification = updates.qualification;

      if (Object.keys(teacherPayload).length > 0) {
        const { error } = await supabase.from('teachers').update(teacherPayload).eq('id', id);
        if (error) throw new Error(error.message);
      }

      if (updates.assignedClassIds !== undefined) {
        await supabase.from('teacher_classes').delete().eq('teacher_id', id);
        if (updates.assignedClassIds.length > 0) {
          const assignments = updates.assignedClassIds.map(classId => ({
            teacher_id: id,
            class_id: classId
          }));
          await supabase.from('teacher_classes').insert(assignments);
        }
      }

      const updated = await this.getTeacherById(id);
      if (!updated) throw new Error(`Teacher with ID ${id} not found.`);
      return updated;
    }

    const data = this.loadData();
    const index = data.teachers.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Teacher with ID "${id}" not found.`);
    }

    const oldTeacher = data.teachers[index];
    const updatedTeacher: Teacher = {
      ...oldTeacher,
      ...updates,
      id
    };

    if (updates.assignedClassIds !== undefined) {
      data.classes = data.classes.map(cls => {
        if (cls.assignedTeacherId === id && !updatedTeacher.assignedClassIds.includes(cls.id)) {
          return {
            ...cls,
            assignedTeacherId: null,
            assignedTeacherName: null
          };
        }
        if (updatedTeacher.assignedClassIds.includes(cls.id)) {
          return {
            ...cls,
            assignedTeacherId: updatedTeacher.id,
            assignedTeacherName: updatedTeacher.name
          };
        }
        return cls;
      });
    }

    data.teachers[index] = updatedTeacher;
    this.saveData(data);
    return { ...updatedTeacher };
  }

  /**
   * Only Administrators may delete teachers.
   */
  public async deleteTeacher(id: string): Promise<void> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const { error } = await supabase.from('teachers').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const data = this.loadData();
    data.teachers = data.teachers.filter(t => t.id !== id);
    data.classes = data.classes.map(cls => {
      if (cls.assignedTeacherId === id) {
        return {
          ...cls,
          assignedTeacherId: null,
          assignedTeacherName: null
        };
      }
      return cls;
    });

    this.saveData(data);
  }

  // ===================== CLASSES CRUD =====================

  /**
   * Administrator can view all classes.
   * Teachers can ONLY view their assigned classes.
   */
  public async getClasses(): Promise<ClassEntity[]> {
    const user = this.getCurrentUserOrThrow();

    if (this.useRemote() && supabase) {
      try {
        let query = supabase
          .from('classes')
          .select('*, teacher_classes(teacher_id, teachers(name)), students(id)')
          .order('name');

        if (user.role === 'TEACHER') {
          const { data: assignments, error: assignError } = await supabase
            .from('teacher_classes')
            .select('class_id')
            .eq('teacher_id', user.teacherId || '');

          if (assignError) throw assignError;

          const assignedIds = (assignments || []).map(a => a.class_id);
          if (assignedIds.length === 0) return [];
          query = query.in('id', assignedIds);
        }

        const { data: rawClasses, error } = await query;
        if (!error && rawClasses) {
          return rawClasses.map(c => {
            const assignment = c.teacher_classes?.[0];
            return {
              id: c.id,
              name: c.name,
              grade: c.grade,
              schedule: c.schedule,
              assignedTeacherId: assignment?.teacher_id || null,
              assignedTeacherName: assignment?.teachers?.name || null,
              studentCount: Array.isArray(c.students) ? c.students.length : 0
            };
          });
        }
        console.warn('[DataService] Supabase getClasses error, falling back to local store:', error?.message);
      } catch (err) {
        console.warn('[DataService] Exception querying Supabase classes, falling back to local store:', err);
      }
    }

    const data = this.loadData();

    if (user.role === 'TEACHER') {
      const teacher = data.teachers.find(t => t.id === user.teacherId);
      return data.classes
        .filter(c => c.assignedTeacherId === user.teacherId || (teacher && teacher.assignedClassIds.includes(c.id)))
        .map(cls => ({
          ...cls,
          studentCount: data.students.filter(s => s.classId === cls.id).length
        }));
    }

    return data.classes.map(cls => ({
      ...cls,
      studentCount: data.students.filter(s => s.classId === cls.id).length
    }));
  }

  /**
   * Admin can view any class; Teachers can ONLY view their assigned class.
   */
  public async getClassById(id: string): Promise<ClassEntity | null> {
    const { isAdmin, user } = this.requireClassAccess(id);

    if (this.useRemote() && supabase) {
      try {
        const { data: c, error } = await supabase
          .from('classes')
          .select('*, teacher_classes(teacher_id, teachers(name)), students(id)')
          .eq('id', id)
          .maybeSingle();

        if (!error && c) {
          const assignment = c.teacher_classes?.[0];
          return {
            id: c.id,
            name: c.name,
            grade: c.grade,
            schedule: c.schedule,
            assignedTeacherId: assignment?.teacher_id || null,
            assignedTeacherName: assignment?.teachers?.name || null,
            studentCount: Array.isArray(c.students) ? c.students.length : 0
          };
        }
        if (!error && !c) {
          return null;
        }
      } catch (e) {}
    }

    const data = this.loadData();
    const cls = data.classes.find(c => c.id === id);
    if (!cls) return null;

    if (!isAdmin && user.teacherId) {
      const teacher = data.teachers.find(t => t.id === user.teacherId);
      const isAssigned =
        cls.assignedTeacherId === user.teacherId ||
        (teacher && teacher.assignedClassIds.includes(cls.id));
      if (!isAssigned) {
        throw new AuthorizationError(
          `Access denied: Educator "${user.name}" cannot view details of unassigned class (${id}).`
        );
      }
    }

    return {
      ...cls,
      studentCount: data.students.filter(s => s.classId === cls.id).length
    };
  }

  /**
   * Only Administrators may create classes.
   */
  public async createClass(classInput: Omit<ClassEntity, 'id' | 'studentCount'>): Promise<ClassEntity> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const { data: cls, error } = await supabase
        .from('classes')
        .insert({
          name: classInput.name,
          grade: classInput.grade,
          schedule: classInput.schedule || 'Mon - Fri (09:00 AM - 01:00 PM)'
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      if (classInput.assignedTeacherId) {
        await supabase.from('teacher_classes').insert({
          class_id: cls.id,
          teacher_id: classInput.assignedTeacherId
        });
      }

      return {
        id: cls.id,
        name: cls.name,
        grade: cls.grade,
        schedule: cls.schedule,
        assignedTeacherId: classInput.assignedTeacherId || null,
        assignedTeacherName: classInput.assignedTeacherName || null,
        studentCount: 0
      };
    }

    const data = this.loadData();
    const newId = `cls-${Date.now()}`;
    const newClass: ClassEntity = {
      ...classInput,
      id: newId,
      studentCount: 0
    };

    if (newClass.assignedTeacherId) {
      const teacher = data.teachers.find(t => t.id === newClass.assignedTeacherId);
      if (teacher) {
        newClass.assignedTeacherName = teacher.name;
        if (!teacher.assignedClassIds.includes(newId)) {
          teacher.assignedClassIds.push(newId);
        }
      }
    }

    data.classes.push(newClass);
    this.saveData(data);
    return { ...newClass };
  }

  /**
   * Only Administrators may update classes.
   */
  public async updateClass(id: string, updates: Partial<ClassEntity>): Promise<ClassEntity> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const classPayload: Record<string, any> = {};
      if (updates.name !== undefined) classPayload.name = updates.name;
      if (updates.grade !== undefined) classPayload.grade = updates.grade;
      if (updates.schedule !== undefined) classPayload.schedule = updates.schedule;

      if (Object.keys(classPayload).length > 0) {
        const { error } = await supabase.from('classes').update(classPayload).eq('id', id);
        if (error) throw new Error(error.message);
      }

      if (updates.assignedTeacherId !== undefined) {
        await supabase.from('teacher_classes').delete().eq('class_id', id);
        if (updates.assignedTeacherId) {
          await supabase.from('teacher_classes').insert({
            class_id: id,
            teacher_id: updates.assignedTeacherId
          });
        }
      }

      const updated = await this.getClassById(id);
      if (!updated) throw new Error(`Class with ID ${id} not found.`);
      return updated;
    }

    const data = this.loadData();
    const index = data.classes.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error(`Class with ID "${id}" not found.`);
    }

    const oldClass = data.classes[index];
    const updatedClass: ClassEntity = {
      ...oldClass,
      ...updates,
      id
    };

    if (updates.assignedTeacherId !== undefined) {
      if (oldClass.assignedTeacherId && oldClass.assignedTeacherId !== updates.assignedTeacherId) {
        const oldTeacher = data.teachers.find(t => t.id === oldClass.assignedTeacherId);
        if (oldTeacher) {
          oldTeacher.assignedClassIds = oldTeacher.assignedClassIds.filter(cid => cid !== id);
        }
      }

      if (updates.assignedTeacherId) {
        const newTeacher = data.teachers.find(t => t.id === updates.assignedTeacherId);
        if (newTeacher) {
          updatedClass.assignedTeacherName = newTeacher.name;
          if (!newTeacher.assignedClassIds.includes(id)) {
            newTeacher.assignedClassIds.push(id);
          }
        }
      } else {
        updatedClass.assignedTeacherName = null;
      }
    }

    data.classes[index] = updatedClass;
    this.saveData(data);
    return {
      ...updatedClass,
      studentCount: data.students.filter(s => s.classId === id).length
    };
  }

  /**
   * Only Administrators may delete classes.
   */
  public async deleteClass(id: string): Promise<void> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const { error } = await supabase.from('classes').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const data = this.loadData();
    data.classes = data.classes.filter(c => c.id !== id);
    data.teachers = data.teachers.map(tch => ({
      ...tch,
      assignedClassIds: tch.assignedClassIds.filter(cid => cid !== id)
    }));
    data.students = data.students.filter(s => s.classId !== id);
    data.attendance = data.attendance.filter(a => a.classId !== id);

    this.saveData(data);
  }

  // ===================== STUDENTS CRUD =====================

  /**
   * Administrator can view all students.
   * Teachers can ONLY view students of their assigned classes.
   */
  public async getStudents(filter?: { classId?: string; search?: string }): Promise<Student[]> {
    const user = this.getCurrentUserOrThrow();

    if (this.useRemote() && supabase) {
      try {
        let query = supabase.from('students').select('*').order('roll_number');

        if (user.role === 'TEACHER') {
          const { data: assignments, error: assignError } = await supabase
            .from('teacher_classes')
            .select('class_id')
            .eq('teacher_id', user.teacherId || '');

          if (assignError) throw assignError;

          const assignedIds = (assignments || []).map(a => a.class_id);
          if (filter?.classId) {
            if (!assignedIds.includes(filter.classId)) {
              throw new AuthorizationError(
                `Access denied: Educator "${user.name}" cannot view students of unassigned class (${filter.classId}).`
              );
            }
            query = query.eq('class_id', filter.classId);
          } else {
            if (assignedIds.length === 0) return [];
            query = query.in('class_id', assignedIds);
          }
        } else if (filter?.classId) {
          query = query.eq('class_id', filter.classId);
        }
        const { data: rawStudents, error } = await query;
        if (!error && rawStudents) {
          let result: Student[] = rawStudents.map(s => ({
            id: s.id,
            name: s.name,
            rollNumber: s.roll_number,
            classId: s.class_id,
            gender: s.gender,
            status: s.status,
            guardianName: s.guardian_name || undefined,
            guardianPhone: s.guardian_phone || undefined,
            dob: s.dob || undefined
          }));

          if (filter?.search) {
            const q = filter.search.toLowerCase();
            result = result.filter(s =>
              s.name.toLowerCase().includes(q) ||
              s.rollNumber.toLowerCase().includes(q) ||
              (s.guardianName && s.guardianName.toLowerCase().includes(q))
            );
          }

          return result;
        }
        console.warn('[DataService] Supabase getStudents error, falling back to local store:', error?.message);
      } catch (err) {
        if (err instanceof AuthorizationError) throw err;
        console.warn('[DataService] Exception querying Supabase students, falling back to local store:', err);
      }
    }

    const data = this.loadData();

    if (user.role === 'TEACHER') {
      const teacher = data.teachers.find(t => t.id === user.teacherId);
      const teacherClassIds = data.classes
        .filter(c => c.assignedTeacherId === user.teacherId || (teacher && teacher.assignedClassIds.includes(c.id)))
        .map(c => c.id);

      if (filter?.classId) {
        if (!teacherClassIds.includes(filter.classId)) {
          throw new AuthorizationError(
            `Access denied: Educator "${user.name}" cannot view students of unassigned class (${filter.classId}).`
          );
        }
      }

      let result = data.students.filter(s => teacherClassIds.includes(s.classId));
      if (filter?.classId) {
        result = result.filter(s => s.classId === filter.classId);
      }
      if (filter?.search) {
        const q = filter.search.toLowerCase();
        result = result.filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.rollNumber.toLowerCase().includes(q) ||
          (s.guardianName && s.guardianName.toLowerCase().includes(q))
        );
      }
      return result;
    }

    let result = [...data.students];
    if (filter?.classId) {
      result = result.filter(s => s.classId === filter.classId);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.rollNumber.toLowerCase().includes(q) ||
        (s.guardianName && s.guardianName.toLowerCase().includes(q))
      );
    }
    return result;
  }

  /**
   * Admin can view any student.
   * Teachers can only view students belonging to their assigned classes.
   */
  public async getStudentById(id: string): Promise<Student | null> {
    const user = this.getCurrentUserOrThrow();

    if (this.useRemote() && supabase) {
      try {
        const { data: s, error } = await supabase
          .from('students')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (!error && s) {
          if (user.role === 'TEACHER') {
            const { data: assignments } = await supabase
              .from('teacher_classes')
              .select('class_id')
              .eq('teacher_id', user.teacherId || '');

            const assignedIds = (assignments || []).map(a => a.class_id);
            if (!assignedIds.includes(s.class_id)) {
              throw new AuthorizationError(
                `Access denied: Educator "${user.name}" cannot view student not in their assigned classes.`
              );
            }
          }

          return {
            id: s.id,
            name: s.name,
            rollNumber: s.roll_number,
            classId: s.class_id,
            gender: s.gender,
            status: s.status,
            guardianName: s.guardian_name || undefined,
            guardianPhone: s.guardian_phone || undefined,
            dob: s.dob || undefined
          };
        }
        if (!error && !s) {
          return null;
        }
      } catch (err) {
        if (err instanceof AuthorizationError) throw err;
      }
    }

    const data = this.loadData();
    const student = data.students.find(s => s.id === id);
    if (!student) return null;

    if (user.role === 'TEACHER') {
      const teacher = data.teachers.find(t => t.id === user.teacherId);
      const teacherClassIds = data.classes
        .filter(c => c.assignedTeacherId === user.teacherId || (teacher && teacher.assignedClassIds.includes(c.id)))
        .map(c => c.id);

      if (!teacherClassIds.includes(student.classId)) {
        throw new AuthorizationError(
          `Access denied: Educator "${user.name}" cannot view student (${id}) not in their assigned classes.`
        );
      }
    }

    return { ...student };
  }

  /**
   * Only Administrators may create students.
   */
  public async createStudent(studentInput: Omit<Student, 'id'>): Promise<Student> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const { data: s, error } = await supabase
        .from('students')
        .insert({
          roll_number: studentInput.rollNumber,
          name: studentInput.name,
          class_id: studentInput.classId,
          gender: studentInput.gender,
          status: studentInput.status,
          guardian_name: studentInput.guardianName || null,
          guardian_phone: studentInput.guardianPhone || null,
          dob: studentInput.dob || null
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      return {
        id: s.id,
        name: s.name,
        rollNumber: s.roll_number,
        classId: s.class_id,
        gender: s.gender,
        status: s.status,
        guardianName: s.guardian_name || undefined,
        guardianPhone: s.guardian_phone || undefined,
        dob: s.dob || undefined
      };
    }

    const data = this.loadData();
    const newId = `std-${Date.now()}`;
    const newStudent: Student = {
      ...studentInput,
      id: newId
    };

    data.students.push(newStudent);
    this.saveData(data);
    return { ...newStudent };
  }

  /**
   * Only Administrators may update students.
   */
  public async updateStudent(id: string, updates: Partial<Student>): Promise<Student> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const payload: Record<string, any> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.rollNumber !== undefined) payload.roll_number = updates.rollNumber;
      if (updates.classId !== undefined) payload.class_id = updates.classId;
      if (updates.gender !== undefined) payload.gender = updates.gender;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.guardianName !== undefined) payload.guardian_name = updates.guardianName;
      if (updates.guardianPhone !== undefined) payload.guardian_phone = updates.guardianPhone;
      if (updates.dob !== undefined) payload.dob = updates.dob;

      const { data: s, error } = await supabase
        .from('students')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message);

      return {
        id: s.id,
        name: s.name,
        rollNumber: s.roll_number,
        classId: s.class_id,
        gender: s.gender,
        status: s.status,
        guardianName: s.guardian_name || undefined,
        guardianPhone: s.guardian_phone || undefined,
        dob: s.dob || undefined
      };
    }

    const data = this.loadData();
    const index = data.students.findIndex(s => s.id === id);
    if (index === -1) {
      throw new Error(`Student with ID "${id}" not found.`);
    }

    const updated: Student = {
      ...data.students[index],
      ...updates,
      id
    };

    data.students[index] = updated;
    this.saveData(data);
    return { ...updated };
  }

  /**
   * Only Administrators may delete students.
   */
  public async deleteStudent(id: string): Promise<void> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const data = this.loadData();
    data.students = data.students.filter(s => s.id !== id);
    data.attendance = data.attendance.filter(a => a.studentId !== id);
    this.saveData(data);
  }

  // ===================== ATTENDANCE =====================

  /**
   * Admin can view all attendance logs.
   * Teachers can ONLY view attendance logs for their assigned classes.
   */
  public async getAttendance(filter?: {
    classId?: string;
    date?: string;
    studentId?: string;
  }): Promise<AttendanceRecord[]> {
    const user = this.getCurrentUserOrThrow();

    if (this.useRemote() && supabase) {
      try {
        let query = supabase.from('attendance_records').select('*').order('date', { ascending: false });

        if (user.role === 'TEACHER') {
          const { data: assignments, error: assignError } = await supabase
            .from('teacher_classes')
            .select('class_id')
            .eq('teacher_id', user.teacherId || '');

          if (assignError) throw assignError;

          const assignedIds = (assignments || []).map(a => a.class_id);

          if (filter?.classId) {
            if (!assignedIds.includes(filter.classId)) {
              throw new AuthorizationError(
                `Access denied: Educator "${user.name}" cannot view attendance of unassigned class (${filter.classId}).`
              );
            }
            query = query.eq('class_id', filter.classId);
          } else {
            if (assignedIds.length === 0) return [];
            query = query.in('class_id', assignedIds);
          }
        } else if (filter?.classId) {
          query = query.eq('class_id', filter.classId);
        }

        if (filter?.date) query = query.eq('date', filter.date);
        if (filter?.studentId) query = query.eq('student_id', filter.studentId);

        const { data: rawAttendance, error } = await query;
        if (!error && rawAttendance) {
          return rawAttendance.map(r => ({
            id: r.id,
            studentId: r.student_id,
            classId: r.class_id,
            date: r.date,
            status: r.status,
            markedBy: r.marked_by,
            updatedAt: r.updated_at,
            notes: r.notes || undefined
          }));
        }
        console.warn('[DataService] Supabase getAttendance error, falling back to local store:', error?.message);
      } catch (err) {
        if (err instanceof AuthorizationError) throw err;
        console.warn('[DataService] Exception querying Supabase attendance, falling back to local store:', err);
      }
    }

    const data = this.loadData();

    if (user.role === 'TEACHER') {
      const teacher = data.teachers.find(t => t.id === user.teacherId);
      const teacherClassIds = data.classes
        .filter(c => c.assignedTeacherId === user.teacherId || (teacher && teacher.assignedClassIds.includes(c.id)))
        .map(c => c.id);

      if (filter?.classId) {
        if (!teacherClassIds.includes(filter.classId)) {
          throw new AuthorizationError(
            `Access denied: Educator "${user.name}" cannot view attendance of unassigned class (${filter.classId}).`
          );
        }
      }

      if (filter?.studentId) {
        const student = data.students.find(s => s.id === filter.studentId);
        if (!student || !teacherClassIds.includes(student.classId)) {
          throw new AuthorizationError(
            `Access denied: Educator "${user.name}" cannot view attendance for student not in their class.`
          );
        }
      }

      let records = data.attendance.filter(r => teacherClassIds.includes(r.classId));
      if (filter?.classId) {
        records = records.filter(r => r.classId === filter.classId);
      }
      if (filter?.date) {
        records = records.filter(r => r.date === filter.date);
      }
      if (filter?.studentId) {
        records = records.filter(r => r.studentId === filter.studentId);
      }

      return records.sort((a, b) => b.date.localeCompare(a.date));
    }

    let records = [...data.attendance];
    if (filter?.classId) {
      records = records.filter(r => r.classId === filter.classId);
    }
    if (filter?.date) {
      records = records.filter(r => r.date === filter.date);
    }
    if (filter?.studentId) {
      records = records.filter(r => r.studentId === filter.studentId);
    }

    return records.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Records the teacher's location at the moment attendance is submitted.
   * Teachers can only record for themselves and their assigned classes.
   */
  public async recordAttendanceLocation(
    classId: string,
    date: string,
    fix: { latitude: number; longitude: number; accuracy: number }
  ): Promise<void> {
    const { user } = this.requireClassAccess(classId);
    if (user.role !== 'TEACHER' || !user.teacherId) return;

    const capturedAt = new Date().toISOString();

    if (this.useRemote() && supabase) {
      const { error } = await supabase.from('attendance_locations').insert({
        teacher_id: user.teacherId,
        class_id: classId,
        date,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy_m: fix.accuracy
      });
      if (error) throw new Error('Could not record your location. Attendance was not saved.');
      return;
    }

    const list = this.loadLocalLocations();
    list.push({
      id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      teacherId: user.teacherId,
      teacherName: user.name,
      classId,
      date,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      capturedAt
    });
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(list.slice(-500)));
  }

  /** Admin only: recent teacher locations captured during attendance. */
  public async getAttendanceLocations(limit = 20): Promise<AttendanceLocation[]> {
    this.requireAdmin();

    if (this.useRemote() && supabase) {
      const { data, error } = await supabase
        .from('attendance_locations')
        .select('*, teachers(name)')
        .order('captured_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return data.map((r: any) => ({
        id: r.id,
        teacherId: r.teacher_id,
        teacherName: r.teachers?.name ?? r.teacher_id,
        classId: r.class_id,
        date: r.date,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracy: r.accuracy_m,
        capturedAt: r.captured_at
      }));
    }

    return this.loadLocalLocations()
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .slice(0, limit);
  }

  private loadLocalLocations(): AttendanceLocation[] {
    try {
      return JSON.parse(localStorage.getItem(LOCATIONS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  /**
   * Saves attendance records for a class session.
   * Admin can save attendance for any class.
   * Teachers can ONLY save attendance for their assigned classes.
   */
  public async saveAttendance(
    classId: string,
    date: string,
    records: Array<{ studentId: string; status: AttendanceStatus; notes?: string }>,
    markedByName: string
  ): Promise<AttendanceRecord[]> {
    this.requireClassAccess(classId);

    if (this.useRemote() && supabase) {
      const recordsToUpsert = records.map(r => ({
        student_id: r.studentId,
        class_id: classId,
        date,
        status: r.status,
        marked_by: markedByName,
        notes: r.notes || null
      }));

      try {
        const { data: upserted, error } = await supabase
          .from('attendance_records')
          .upsert(recordsToUpsert, {
            onConflict: 'student_id,date'
          })
          .select();

        if (!error && upserted) {
          return upserted.map(r => ({
            id: r.id,
            studentId: r.student_id,
            classId: r.class_id,
            date: r.date,
            status: r.status,
            markedBy: r.marked_by,
            updatedAt: r.updated_at,
            notes: r.notes || undefined
          }));
        }
        console.warn('[DataService] Supabase saveAttendance error, falling back to local store:', error?.message);
      } catch (err) {
        if (err instanceof AuthorizationError) throw err;
        console.warn('[DataService] Exception in Supabase saveAttendance, falling back to local store:', err);
      }
    }

    const data = this.loadData();
    const nowIso = new Date().toISOString();
    const savedRecords: AttendanceRecord[] = [];

    records.forEach(input => {
      const existingIndex = data.attendance.findIndex(
        r => r.studentId === input.studentId && r.date === date
      );

      if (existingIndex >= 0) {
        data.attendance[existingIndex] = {
          ...data.attendance[existingIndex],
          classId,
          status: input.status,
          notes: input.notes,
          markedBy: markedByName,
          updatedAt: nowIso
        };
        savedRecords.push(data.attendance[existingIndex]);
      } else {
        const newRecord: AttendanceRecord = {
          id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          studentId: input.studentId,
          classId,
          date,
          status: input.status,
          markedBy: markedByName,
          updatedAt: nowIso,
          notes: input.notes
        };
        data.attendance.push(newRecord);
        savedRecords.push(newRecord);
      }
    });

    this.saveData(data);
    return savedRecords;
  }

  // ===================== DASHBOARD METRICS =====================

  public async getAdminDashboardData(): Promise<DashboardStats> {
    this.requireAdmin();

    const [classes, students, attendance] = await Promise.all([
      this.getClasses(),
      this.getStudents(),
      this.getAttendance()
    ]);

    const teachers = await this.getTeachers();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const todayAttendance = attendance.filter(r => r.date === todayStr);
    const presentToday = todayAttendance.filter(r => r.status === 'present').length;
    const absentToday = todayAttendance.filter(r => r.status === 'absent').length;
    const totalMarkedToday = presentToday + absentToday;
    const percentageToday = totalMarkedToday > 0 ? Math.round((presentToday / totalMarkedToday) * 100) : 0;

    const classBreakdown: ClassAttendanceSummary[] = classes.map(cls => {
      const clsStudents = students.filter(s => s.classId === cls.id);
      const clsTodayRecords = todayAttendance.filter(r => r.classId === cls.id);
      const clsPresent = clsTodayRecords.filter(r => r.status === 'present').length;
      const clsAbsent = clsTodayRecords.filter(r => r.status === 'absent').length;
      const marked = clsPresent + clsAbsent;
      const pct = marked > 0 ? Math.round((clsPresent / marked) * 100) : 0;

      return {
        classId: cls.id,
        className: cls.name,
        learningCenter: cls.learningCenter,
        totalStudents: clsStudents.length,
        markedStudents: marked,
        presentCount: clsPresent,
        absentCount: clsAbsent,
        percentage: pct,
        isMarkedToday: marked > 0
      };
    });

    return {
      totalTeachers: teachers.length,
      totalClasses: classes.length,
      totalStudents: students.length,
      todayAttendance: {
        total: totalMarkedToday,
        present: presentToday,
        absent: absentToday,
        percentage: percentageToday
      },
      classBreakdown
    };
  }

  public async getDashboardStats(): Promise<DashboardStats> {
    return this.getAdminDashboardData();
  }

  public async getTeacherDashboardData(teacherId: string): Promise<{
    teacher: Teacher | null;
    classes: ClassEntity[];
    stats: {
      assignedClassesCount: number;
      totalStudentsCount: number;
      todayMarkedClassesCount: number;
      todayAttendanceRate: number;
    };
    classSummaries: ClassAttendanceSummary[];
  }> {
    const user = this.getCurrentUserOrThrow();
    if (user.role === 'TEACHER' && user.teacherId !== teacherId) {
      throw new AuthorizationError(
        `Access denied: Educator "${user.name}" cannot view the dashboard of another educator (${teacherId}).`
      );
    }

    const [teacherClasses, allStudents, attendance] = await Promise.all([
      this.getClasses(),
      this.getStudents(),
      this.getAttendance()
    ]);

    const teacher = await this.getTeacherById(teacherId);

    const teacherClassIds = teacherClasses.map(c => c.id);
    const studentsInTeacherClasses = allStudents.filter(s => teacherClassIds.includes(s.classId));

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const todayRecords = attendance.filter(r => teacherClassIds.includes(r.classId) && r.date === todayStr);
    const presentCount = todayRecords.filter(r => r.status === 'present').length;
    const totalMarked = todayRecords.length;
    const todayAttendanceRate = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : 0;

    let todayMarkedClassesCount = 0;
    const classSummaries: ClassAttendanceSummary[] = teacherClasses.map(cls => {
      const clsStudents = studentsInTeacherClasses.filter(s => s.classId === cls.id);
      const clsTodayRecords = todayRecords.filter(r => r.classId === cls.id);
      const clsPresent = clsTodayRecords.filter(r => r.status === 'present').length;
      const clsAbsent = clsTodayRecords.filter(r => r.status === 'absent').length;
      const marked = clsPresent + clsAbsent;
      const pct = marked > 0 ? Math.round((clsPresent / marked) * 100) : 0;

      if (marked > 0) todayMarkedClassesCount++;

      return {
        classId: cls.id,
        className: cls.name,
        learningCenter: cls.learningCenter,
        totalStudents: clsStudents.length,
        markedStudents: marked,
        presentCount: clsPresent,
        absentCount: clsAbsent,
        percentage: pct,
        isMarkedToday: marked > 0
      };
    });

    return {
      teacher,
      classes: teacherClasses,
      stats: {
        assignedClassesCount: teacherClasses.length,
        totalStudentsCount: studentsInTeacherClasses.length,
        todayMarkedClassesCount,
        todayAttendanceRate
      },
      classSummaries
    };
  }

  public async canTeacherAccessClass(teacherId: string, classId: string): Promise<boolean> {
    if (this.useRemote() && supabase) {
      const { data } = await supabase
        .from('teacher_classes')
        .select('id')
        .eq('teacher_id', teacherId)
        .eq('class_id', classId)
        .maybeSingle();

      return !!data;
    }

    const data = this.loadData();
    const teacher = data.teachers.find(t => t.id === teacherId);
    if (!teacher) return false;
    const cls = data.classes.find(c => c.id === classId);
    if (!cls) return false;
    return cls.assignedTeacherId === teacherId || teacher.assignedClassIds.includes(classId);
  }
}

export const dataService = new DataService();
