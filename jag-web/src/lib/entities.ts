export const ENTITY_NAMES: Record<string, string> = {
  '00000000-0000-0000-0000-000000000000': 'Consolidated',
  '00000000-0000-0000-0001-000000000001': 'JAG Holdings',
  '00000000-0000-0000-0001-000000000002': 'JABCO',
  '00000000-0000-0000-0001-000000000003': 'JAG Properties',
  '00000000-0000-0000-0001-000000000004': 'JAG Entertainment',
  '00000000-0000-0000-0001-000000000005': 'JAG Finance',
  '00000000-0000-0000-0001-000000000006': 'DragonBridge',
  '00000000-0000-0000-0001-000000000007': 'NLCB',
  '00000000-0000-0000-0001-000000000008': 'Personal — Robert',
  '00000000-0000-0000-0001-000000000009': 'Isabella Johnson-Attin',
  '00000000-0000-0000-0001-000000000010': 'Phillip Ajack Johnson-Attin',
  '00000000-0000-0000-0001-000000000011': 'Brian Johnson-Attin',
  '00000000-0000-0000-0001-000000000012': 'Zhanghua Chang',
  '00000000-0000-0000-0001-000000000013': 'Theresa Johnson-Attin',
}

export function entityName(id: string): string {
  return ENTITY_NAMES[id] ?? id.slice(0, 8)
}

const CONSOLIDATED_ENTITY_ID = '00000000-0000-0000-0000-000000000000'

// Every real (non-Consolidated) entity, for pickers that assign ownership (e.g. Expenses).
export const ENTITY_OPTIONS = Object.entries(ENTITY_NAMES)
  .filter(([id]) => id !== CONSOLIDATED_ENTITY_ID)
  .map(([id, name]) => ({ id, name }))

export function fmtTTD(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('en-TT', {
    style: 'currency',
    currency: 'TTD',
    minimumFractionDigits: 2,
  }).format(n)
}

export function fmtDate(iso: string): string {
  // Parse the Y/M/D components directly rather than `new Date(iso)` — the
  // latter parses a date-only string ('2026-09-30') as UTC midnight, which
  // toLocaleDateString then renders in the browser's local timezone (TT is
  // UTC-4), shifting the displayed date back a day.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-TT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
