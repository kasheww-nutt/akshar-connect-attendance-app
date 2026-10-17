import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { AttendanceLocation, ClassEntity } from '../../types';
import { dataService } from '../../services/dataService';
import { mapsUrl } from '../../utils/geolocation';

export const TeacherLocationsPanel: React.FC<{ classes: ClassEntity[] }> = ({ classes }) => {
  const [rows, setRows] = useState<AttendanceLocation[]>([]);

  useEffect(() => {
    let mounted = true;
    dataService
      .getAttendanceLocations(20)
      .then(r => mounted && setRows(r))
      .catch(() => mounted && setRows([]));
    return () => {
      mounted = false;
    };
  }, []);

  const className = (id: string) => classes.find(c => c.id === id)?.name ?? id;

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-teal-700" />
        <h2 className="text-sm font-bold text-slate-900">Teacher locations at attendance</h2>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-xs text-slate-500">No locations recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map(r => (
            <li key={r.id} className="px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">{r.teacherName}</span>
              <span className="text-slate-600">
                Class {className(r.classId)} · {r.date} · {new Date(r.capturedAt).toLocaleTimeString()}
              </span>
              <a
                href={mapsUrl(r.latitude, r.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-700 font-semibold hover:underline"
              >
                View on map{r.accuracy != null ? ` (±${Math.round(r.accuracy)} m)` : ''}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
