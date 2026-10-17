import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTranslation } from '../../i18n';
import { dataService } from '../../services/dataService';
import { ClassEntity } from '../../types';
import { AttendanceSession } from '../../components/attendance/AttendanceSession';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { TeacherLocationsPanel } from '../../components/attendance/TeacherLocationsPanel';

export const AdminAttendancePage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const requestedClassId = searchParams.get('classId');

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassEntity[]>([]);

  useEffect(() => {
    let isMounted = true;
    const fetchClasses = async () => {
      try {
        const clsList = await dataService.getClasses();
        if (!isMounted) return;
        setClasses(clsList);
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchClasses();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) return <LoadingSpinner message="Loading attendance..." />;

  if (classes.length === 0) {
    return (
      <div className="p-8 text-center bg-white rounded-lg border border-slate-200">
        <h3 className="text-sm font-bold text-slate-800">
          No Classes Created Yet
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Create a class first from the Classes page before recording attendance.
        </p>
      </div>
    );
  }

  const initialClassId =
    requestedClassId && classes.some(c => c.id === requestedClassId)
      ? requestedClassId
      : classes[0].id;

  return (
    <div className="space-y-4">
      <div className="pb-3 border-b border-slate-200">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          {t('attendance.title')}
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Administrative attendance register — record, modify, or verify class attendance sessions
        </p>
      </div>

      <AttendanceSession
        initialClassId={initialClassId}
        allowedClasses={classes}
        markedByName={user?.name || 'Administrator'}
      />

      <TeacherLocationsPanel classes={classes} />
    </div>
  );
};
