export type Role = 'ADMIN' | 'TEACHER';

export type UserStatus = 'active' | 'inactive';
export type AttendanceStatus = 'present' | 'absent';
export type Gender = 'male' | 'female' | 'other';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  teacherId?: string; // links to Teacher if role is TEACHER
  avatar?: string;
  phone?: string;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  phone: string;
  assignedClassIds: string[];
  status: UserStatus;
  qualification?: string;
  joinedDate: string;
}

export interface ClassEntity {
  id: string;
  name: string;
  grade: string; // e.g. "Class 3", "Class 4", etc.
  learningCenter?: string;
  assignedTeacherId: string | null;
  assignedTeacherName: string | null;
  studentCount: number;
  schedule?: string;
}

export interface Student {
  id: string;
  name: string;
  rollNumber: string;
  classId: string;
  gender: Gender;
  status: UserStatus;
  guardianName?: string;
  guardianPhone?: string;
  dob?: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  classId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  markedBy: string; // teacher / admin name or ID
  updatedAt: string; // ISO string
  notes?: string;
}

export interface AttendanceLocation {
  id: string;
  teacherId: string;
  teacherName: string;
  classId: string;
  date: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
}

export interface AttendanceSessionItem {
  student: Student;
  status: AttendanceStatus;
  notes?: string;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  percentage: number;
}

export interface ClassAttendanceSummary {
  classId: string;
  className: string;
  learningCenter?: string;
  totalStudents: number;
  markedStudents: number;
  presentCount: number;
  absentCount: number;
  percentage: number;
  isMarkedToday: boolean;
}

export interface DashboardStats {
  totalTeachers: number;
  totalClasses: number;
  totalStudents: number;
  todayAttendance: AttendanceSummary;
  classBreakdown: ClassAttendanceSummary[];
}

export type Language = 'en' | 'hi' | 'mr';
