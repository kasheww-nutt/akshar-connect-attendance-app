export interface CsvExportRow {
  date: string;
  className: string;
  learningCenter?: string;
  studentName: string;
  rollNumber: string;
  gender: string;
  status: string;
  markedBy: string;
  lastUpdated: string;
  notes?: string;
}

export function exportAttendanceToCsv(filename: string, rows: CsvExportRow[]): void {
  const headers = [
    'Date',
    'Class Name',
    'Learning Center',
    'Student Name',
    'Roll Number',
    'Gender',
    'Status',
    'Marked By',
    'Last Updated',
    'Notes'
  ];

  const escapeCell = (val: any): string => {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };

  const csvRows = [
    headers.join(','),
    ...rows.map(row => [
      escapeCell(row.date),
      escapeCell(row.className),
      escapeCell(row.learningCenter),
      escapeCell(row.studentName),
      escapeCell(row.rollNumber),
      escapeCell(row.gender),
      escapeCell(row.status.toUpperCase()),
      escapeCell(row.markedBy),
      escapeCell(row.lastUpdated),
      escapeCell(row.notes || '')
    ].join(','))
  ];

  const csvString = csvRows.join('\r\n');
  
  // Use UTF-8 BOM so Excel displays regional characters (Marathi/Hindi/English) properly
  const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
