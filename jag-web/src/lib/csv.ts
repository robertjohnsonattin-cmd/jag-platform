// Minimal client-side CSV serialisation + download for accountant exports.
// No server round-trip — the export endpoints return JSON and the UI serialises it.

export interface CsvColumn {
  key: string
  label: string
}

// RFC-4180 cell escaping: wrap in double quotes and double any internal quote
// whenever the value contains a comma, quote, or newline. null/undefined -> empty.
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const header = columns.map(col => escapeCell(col.label)).join(',')
  const body = rows.map(row => columns.map(col => escapeCell(row[col.key])).join(','))
  return [header, ...body].join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  // Prepend a UTF-8 BOM so Excel renders non-ASCII (e.g. Chinese names) correctly.
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
