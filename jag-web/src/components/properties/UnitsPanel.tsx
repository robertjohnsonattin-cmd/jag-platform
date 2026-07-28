import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { propertiesApi } from '../../api/properties'
import { ManageListingModal } from './PropertiesPanel'
import type { UnitListRow } from '../../types/properties'

// Flat cross-property unit list. Its reason to exist is the listing backlog:
// 25 units, most of them still missing photos/description/rent, previously
// only visible by opening each property in turn.

const STATUS_STYLES: Record<string, string> = {
  LISTED:      'bg-green-900/40 text-green-300 border-green-700',
  VACANT:      'bg-amber-900/40 text-amber-300 border-amber-700',
  OCCUPIED:    'bg-blue-900/40 text-blue-300 border-blue-700',
  MAINTENANCE: 'bg-red-900/40 text-red-300 border-red-700',
}

const fmtTTD = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === ''
    ? '—'
    : `TT$${parseFloat(String(v)).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const tenantName = (u: UnitListRow) =>
  u.is_company
    ? (u.company_name ?? '—')
    : `${u.tenant_first_name ?? ''}${u.tenant_last_name ? ` ${u.tenant_last_name}` : ''}`.trim() || '—'

/**
 * Listing readiness — deliberately only the three fields whose absence is
 * unambiguous. Utilities are excluded on purpose: `wasa_included` and friends
 * default to FALSE in migration 022, so "not included" and "nobody has filled
 * this in yet" are the same value in the database. Scoring them would state a
 * guess as a fact.
 */
function readiness(u: UnitListRow) {
  const photos = u.photo_count > 0
  const description = !!u.listing_description && u.listing_description.trim().length > 0
  const rent = u.rent_amount !== null && parseFloat(String(u.rent_amount)) > 0
  const done = [photos, description, rent].filter(Boolean).length
  return { photos, description, rent, done, total: 3 }
}

export default function UnitsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [propertyId, setPropertyId] = useState('')
  const [status, setStatus] = useState('')
  const [incompleteOnly, setIncompleteOnly] = useState(false)
  const [managing, setManaging] = useState<UnitListRow | null>(null)

  const { data: properties = [] } = useQuery({
    queryKey: ['properties', 'list'],
    queryFn: () => propertiesApi.getProperties({ limit: 200 }),
  })

  const unitsKey = ['properties', 'units-flat', propertyId, status] as const
  const { data: units = [], isLoading, isError, error } = useQuery({
    queryKey: unitsKey,
    queryFn: () => propertiesApi.listUnits({
      ...(propertyId ? { property_id: propertyId } : {}),
      ...(status ? { listing_status: status } : {}),
    }),
  })

  const shown = useMemo(
    () => (incompleteOnly ? units.filter(u => readiness(u).done < 3) : units),
    [units, incompleteOnly],
  )

  const counts = useMemo(() => ({
    total: units.length,
    listed: units.filter(u => u.listing_status === 'LISTED').length,
    occupied: units.filter(u => u.is_rented).length,
    incomplete: units.filter(u => readiness(u).done < 3).length,
  }), [units])

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
          value={propertyId}
          onChange={e => setPropertyId(e.target.value)}
        >
          <option value="">{t('properties.units.allProperties', 'All properties')}</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
          value={status}
          onChange={e => setStatus(e.target.value)}
        >
          <option value="">{t('properties.units.allStatuses', 'All statuses')}</option>
          <option value="VACANT">{t('properties.units.status.VACANT', 'Vacant')}</option>
          <option value="LISTED">{t('properties.units.status.LISTED', 'Listed')}</option>
          <option value="OCCUPIED">{t('properties.units.status.OCCUPIED', 'Occupied')}</option>
          <option value="MAINTENANCE">{t('properties.units.status.MAINTENANCE', 'Maintenance')}</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="rounded border-slate-600 bg-slate-700"
            checked={incompleteOnly}
            onChange={e => setIncompleteOnly(e.target.checked)}
          />
          {t('properties.units.incompleteOnly', 'Needs listing content only')}
        </label>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded border bg-slate-700 text-slate-300 border-slate-600">
            {t('properties.units.countTotal', '{{n}} units', { n: counts.total })}
          </span>
          <span className="px-2 py-1 rounded border bg-green-900/40 text-green-300 border-green-700">
            {t('properties.units.countListed', '{{n}} listed', { n: counts.listed })}
          </span>
          <span className="px-2 py-1 rounded border bg-blue-900/40 text-blue-300 border-blue-700">
            {t('properties.units.countOccupied', '{{n}} occupied', { n: counts.occupied })}
          </span>
          {counts.incomplete > 0 && (
            <span className="px-2 py-1 rounded border bg-amber-900/40 text-amber-300 border-amber-700">
              {t('properties.units.countIncomplete', '{{n}} need content', { n: counts.incomplete })}
            </span>
          )}
        </div>
      </div>

      {/* Loading, error and empty are three different things — never one message. */}
      {isLoading && <p className="text-sm text-slate-500">{t('common.loading', 'Loading…')}</p>}
      {isError && (
        <p className="text-sm text-red-400">
          {t('properties.units.loadFailed', 'Could not load units:')} {(error as Error).message}
        </p>
      )}
      {!isLoading && !isError && shown.length === 0 && (
        <p className="text-sm text-slate-500 py-8 text-center">
          {units.length === 0
            ? t('properties.units.none', 'No units match these filters.')
            : t('properties.units.allComplete', 'Every unit in this view has photos, a description and an asking rent.')}
        </p>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-3 py-2">{t('properties.units.unit', 'Unit')}</th>
                <th className="text-left px-3 py-2">{t('properties.units.property', 'Property')}</th>
                <th className="text-left px-3 py-2">{t('properties.units.layout', 'Layout')}</th>
                <th className="text-left px-3 py-2">{t('properties.units.rent', 'Asking rent')}</th>
                <th className="text-left px-3 py-2">{t('properties.units.listingStatus', 'Status')}</th>
                <th className="text-left px-3 py-2">{t('properties.units.readiness', 'Listing content')}</th>
                <th className="text-left px-3 py-2">{t('properties.units.tenant', 'Tenant')}</th>
                <th className="text-right px-3 py-2">{t('properties.units.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {shown.map(u => {
                const r = readiness(u)
                const st = u.listing_status ?? 'VACANT'
                return (
                  <tr key={u.id} className="hover:bg-slate-700/20">
                    <td className="px-3 py-2 text-slate-100 whitespace-nowrap">{u.unit_number}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {u.property_name}{u.property_city ? ` · ${u.property_city}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                      {u.bedrooms ?? '—'}{t('properties.units.bedShort', 'br')} / {u.bathrooms ?? '—'}{t('properties.units.bathShort', 'ba')}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">
                      {fmtTTD(u.rent_amount)}
                      {!u.rent_amount && u.suggested_rent_recommended_ttd && (
                        <span className="text-slate-500"> ({t('properties.units.suggested', 'sugg. {{v}}', { v: fmtTTD(u.suggested_rent_recommended_ttd) })})</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_STYLES[st] ?? STATUS_STYLES['VACANT']}`}>
                        {t(`properties.units.status.${st}`, st)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 text-xs whitespace-nowrap">
                        <Chip ok={r.photos} label={t('properties.units.chipPhotos', 'Photos')} count={u.photo_count} />
                        <Chip ok={r.description} label={t('properties.units.chipDesc', 'Desc')} />
                        <Chip ok={r.rent} label={t('properties.units.chipRent', 'Rent')} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{u.lease_id ? tenantName(u) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setManaging(u)}
                        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 whitespace-nowrap"
                      >
                        🏷 {t('properties.units.manageListing', 'Listing')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {managing && (
        <ManageListingModal
          unit={managing}
          propertyId={managing.property_id}
          onClose={() => setManaging(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['properties', 'units-flat'] })
            setManaging(null)
          }}
        />
      )}
    </div>
  )
}

function Chip({ ok, label, count }: { ok: boolean; label: string; count?: number }) {
  return (
    <span className={`px-1.5 py-0.5 rounded border ${ok
      ? 'bg-green-900/40 text-green-300 border-green-700'
      : 'bg-slate-700 text-slate-500 border-slate-600'}`}>
      {ok ? '✓' : '○'} {label}{ok && count !== undefined ? ` ${count}` : ''}
    </span>
  )
}
