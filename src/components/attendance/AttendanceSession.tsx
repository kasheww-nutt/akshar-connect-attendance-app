import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Users,
  Search,
  CheckCheck,
  X,
  Save,
  Check,
  Info,
  UserCheck
} from 'lucide-react';
import { ClassEntity, Student, AttendanceStatus, AttendanceRecord } from '../../types';
import { dataService } from '../../services/dataService';
import { useTranslation } from '../../i18n';
import { useToast } from '../../hooks/useToast';
import { getTodayDateString, formatDateDisplay } from '../../utils/dateUtils';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useAuth } from '../../hooks/useAuth';
import { getCurrentLocation } from '../../utils/geolocation';

interface AttendanceSessionProps {
  initialClassId?: string;
  allowedClasses: ClassEntity[];
  markedByName: string;
  onAttendanceSaved?: () => void;
}

export const AttendanceSession: React.FC<AttendanceSessionProps> = ({
  initialClassId,
  allowedClasses,
  markedByName,
  onAttendanceSaved
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const isTeacher = user?.role === 'TEACHER';

  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialClassId || (allowedClasses.length > 0 ? allowedClasses[0].id : '')
  );
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
  const [students, setStudents] = useState<Student[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, AttendanceStatus>>({});
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existingRecordsFound, setExistingRecordsFound] = useState(false);

  // Sync selected class if initial changes
  useEffect(() => {
    if (initialClassId && allowedClasses.some(c => c.id === initialClassId)) {
      setSelectedClassId(initialClassId);
    } else if (allowedClasses.length > 0 && !allowedClasses.some(c => c.id === selectedClassId)) {
      setSelectedClassId(allowedClasses[0].id);
    }
  }, [initialClassId, allowedClasses]);

  // Load students & existing attendance records whenever class or date changes
  useEffect(() => {
    if (!selectedClassId) return;

    let isMounted = true;
    const fetchClassData = async () => {
      setLoading(true);
      try {
        const [studentList, existingAttendance] = await Promise.all([
          dataService.getStudents({ classId: selectedClassId }),
          dataService.getAttendance({ classId: selectedClassId, date: selectedDate })
        ]);

        if (!isMounted) return;

        setStudents(studentList);

        const newStatusMap: Record<string, AttendanceStatus> = {};
        const newNotesMap: Record<string, string> = {};
        let hasExisting = false;

        const recordLookup = new Map<string, AttendanceRecord>();
        existingAttendance.forEach(rec => {
          recordLookup.set(rec.studentId, rec);
        });

        if (existingAttendance.length > 0) {
          hasExisting = true;
        }

        studentList.forEach(student => {
          const rec = recordLookup.get(student.id);
          if (rec) {
            newStatusMap[student.id] = rec.status;
            if (rec.notes) newNotesMap[student.id] = rec.notes;
          } else {
            // Default to 'present' for new sessions
            newStatusMap[student.id] = 'present';
          }
        });

        setStatusMap(newStatusMap);
        setNotesMap(newNotesMap);
        setExistingRecordsFound(hasExisting);
      } catch (e: any) {
        toast.error(e?.message || 'Error loading class students');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchClassData();
    return () => {
      isMounted = false;
    };
  }, [selectedClassId, selectedDate]);

  // Filter students based on search query
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students;
    const q = searchQuery.toLowerCase();
    return students.filter(
      s => s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q)
    );
  }, [students, searchQuery]);

  // Real-time metrics
  const totalCount = students.length;
  const presentCount = Object.values(statusMap).filter(st => st === 'present').length;
  const absentCount = Object.values(statusMap).filter(st => st === 'absent').length;
  const percentage = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  const handleToggleStatus = (studentId: string, status: AttendanceStatus) => {
    setStatusMap(prev => ({
      ...prev,
      [studentId]: status
    }));
  };

  const handleNoteChange = (studentId: string, note: string) => {
    setNotesMap(prev => ({
      ...prev,
      [studentId]: note
    }));
  };

  const handleMarkAll = (status: AttendanceStatus) => {
    const updated: Record<string, AttendanceStatus> = {};
    students.forEach(s => {
      updated[s.id] = status;
    });
    setStatusMap(updated);
  };

  const handleSaveAttendance = async () => {
    if (!selectedClassId) {
      toast.error(t('attendance.noClassSelected'));
      return;
    }

    if (students.length === 0) {
      toast.error(t('attendance.noStudentsInClass'));
      return;
    }

    setSaving(true);
    try {
      const fix = isTeacher ? await getCurrentLocation() : null;

      const payload = students.map(s => ({
        studentId: s.id,
        status: statusMap[s.id] || 'present',
        notes: notesMap[s.id]
      }));

      await dataService.saveAttendance(
        selectedClassId,
        selectedDate,
        payload,
        markedByName
      );

      if (fix) {
        await dataService.recordAttendanceLocation(selectedClassId, selectedDate, fix);
      }

      setExistingRecordsFound(true);
      toast.success(t('attendance.savedSuccess'));
      if (onAttendanceSaved) {
        onAttendanceSaved();
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save attendance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Configuration & Filter Header */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          {/* Class Selector */}
          <div className="sm:col-span-4">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">
              {t('attendance.selectClass')}
            </label>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-teal-700 focus:border-teal-700"
            >
              {allowedClasses.map(c => (
                <option key={c.id} value={c.id}>
                  Class {c.name} {c.grade ? `(Grade ${c.grade})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="sm:col-span-4">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">
              {t('attendance.selectDate')}
            </label>
            <div className="relative">
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                max={getTodayDateString()}
                className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-teal-700 focus:border-teal-700"
              />
            </div>
          </div>

          {/* Save Attendance Button */}
          <div className="sm:col-span-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveAttendance}
              disabled={saving || loading || students.length === 0}
              className="w-full py-2 px-4 rounded-md bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold text-xs shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>{t('attendance.saving')}</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>{t('attendance.saveAttendance')}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {isTeacher && (
          <div className="px-3 py-2 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-xs flex items-center gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 text-slate-500" />
            <span>
              Your device location is recorded once, when you save attendance, and is visible only to you and administrators. Please allow location access when prompted.
            </span>
          </div>
        )}

        {/* Existing records status notice */}
        {existingRecordsFound && (
          <div className="px-3 py-2 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-xs flex items-center gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 text-teal-700" />
            <span>
              Attendance record already exists for {formatDateDisplay(selectedDate)}. Editing and saving will update this session.
            </span>
          </div>
        )}
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Students */}
        <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              {t('attendance.totalStudents')}
            </p>
            <p className="text-xl font-bold text-slate-900 mt-0.5">
              {totalCount}
            </p>
          </div>
          <div className="w-8 h-8 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <Users className="w-4 h-4" />
          </div>
        </div>

        {/* Present Count */}
        <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
              {t('attendance.present')}
            </p>
            <p className="text-xl font-bold text-emerald-800 mt-0.5">
              {presentCount}
            </p>
          </div>
          <div className="w-8 h-8 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>

        {/* Absent Count */}
        <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide">
              {t('attendance.absent')}
            </p>
            <p className="text-xl font-bold text-rose-800 mt-0.5">
              {absentCount}
            </p>
          </div>
          <div className="w-8 h-8 rounded-md bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700">
            <XCircle className="w-4 h-4" />
          </div>
        </div>

        {/* Percentage */}
        <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-teal-700 uppercase tracking-wide">
              Attendance Rate
            </p>
            <p className="text-xl font-bold text-teal-800 mt-0.5">
              {percentage}%
            </p>
          </div>
          <div className="w-8 h-8 rounded-md bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
            <UserCheck className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Roster Controls: Search & Batch Marking Actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search student by name or roll number..."
            className="w-full pl-9 pr-7 py-1.5 text-xs rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-700 focus:border-teal-700"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Batch Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleMarkAll('present')}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition-colors flex items-center justify-center gap-1.5"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Mark All Present</span>
          </button>
          <button
            type="button"
            onClick={() => handleMarkAll('absent')}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 transition-colors flex items-center justify-center gap-1.5"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Mark All Absent</span>
          </button>
        </div>
      </div>

      {/* Attendance Register Data Table */}
      {loading ? (
        <LoadingSpinner message="Loading roster..." />
      ) : filteredStudents.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-lg border border-slate-200">
          <p className="text-xs font-semibold text-slate-500">
            {students.length === 0
              ? 'No students enrolled in this class.'
              : 'No students match your search filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-4 w-12 text-center">#</th>
                  <th className="py-2.5 px-4 w-28">Roll No</th>
                  <th className="py-2.5 px-4">Student Name</th>
                  <th className="py-2.5 px-4 w-24">Gender</th>
                  <th className="py-2.5 px-4 w-48 text-center">Status</th>
                  <th className="py-2.5 px-4">Remarks / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredStudents.map((student, idx) => {
                  const currentStatus = statusMap[student.id] || 'present';
                  const isPresent = currentStatus === 'present';

                  return (
                    <tr
                      key={student.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        !isPresent ? 'bg-rose-50/20' : ''
                      }`}
                    >
                      {/* Serial No. */}
                      <td className="py-2.5 px-4 text-center font-mono text-slate-400 text-[11px]">
                        {idx + 1}
                      </td>

                      {/* Roll Number */}
                      <td className="py-2.5 px-4 font-mono font-medium text-slate-700">
                        {student.rollNumber}
                      </td>

                      {/* Student Name */}
                      <td className="py-2.5 px-4 font-semibold text-slate-900">
                        {student.name}
                        {student.guardianName && (
                          <span className="block text-[10px] text-slate-400 font-normal mt-0.5">
                            Guardian: {student.guardianName}
                          </span>
                        )}
                      </td>

                      {/* Gender */}
                      <td className="py-2.5 px-4 capitalize text-slate-600">
                        {student.gender}
                      </td>

                      {/* Segmented Present / Absent Toggle Buttons */}
                      <td className="py-2.5 px-4">
                        <div className="inline-flex rounded-md border border-slate-300 overflow-hidden shadow-xs w-full max-w-[200px] mx-auto">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(student.id, 'present')}
                            className={`flex-1 py-1 px-3 text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                              isPresent
                                ? 'bg-emerald-700 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Present</span>
                          </button>
                          <div className="w-[1px] bg-slate-300" />
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(student.id, 'absent')}
                            className={`flex-1 py-1 px-3 text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                              !isPresent
                                ? 'bg-rose-700 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Absent</span>
                          </button>
                        </div>
                      </td>

                      {/* Notes / Remarks */}
                      <td className="py-2.5 px-4">
                        <input
                          type="text"
                          value={notesMap[student.id] || ''}
                          onChange={e => handleNoteChange(student.id, e.target.value)}
                          placeholder="Optional remark..."
                          className="w-full px-2.5 py-1 text-xs rounded border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-700 focus:border-teal-700"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Save Action Bar on Small Screens */}
      <div className="sm:hidden sticky bottom-2 left-0 right-0 p-3 bg-white border border-slate-300 rounded-lg shadow-lg z-20 flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-500 font-semibold uppercase">
            {presentCount} Present / {totalCount} Total
          </span>
          <span className="text-xs font-bold text-teal-800">
            {percentage}% Attendance Rate
          </span>
        </div>
        <button
          type="button"
          onClick={handleSaveAttendance}
          disabled={saving || loading || students.length === 0}
          className="px-4 py-2 rounded-md bg-teal-700 text-white font-semibold text-xs shadow-sm flex items-center gap-1.5 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? 'Saving...' : 'Save Attendance'}</span>
        </button>
      </div>
    </div>
  );
};
