type CsvButtonProps = {
  filename: string;
  rows: Record<string, unknown>[];
  columns: { key: string; header: string }[];
};

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Quote fields that contain comma, double quote, or newline
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default function CsvButton({ filename, rows, columns }: CsvButtonProps) {
  const handleClick = () => {
    const headerRow = columns.map(c => escapeCsvField(c.header)).join(',');
    const dataRows = rows.map(row =>
      columns.map(c => escapeCsvField(row[c.key])).join(',')
    );
    const csv = [headerRow, ...dataRows].join('\n');

    // BOM for Excel UTF-8 compatibility
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button onClick={handleClick} className="btn" disabled={rows.length === 0}>
      📥 导出 CSV
    </button>
  );
}