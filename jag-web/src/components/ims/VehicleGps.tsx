// GPS tracking UI (Traccar-backed) — vehicle tab, fleet map, tracker registry.
// Map tiles: OpenStreetMap (free). Markers use CircleMarker (pure SVG) to avoid
// Leaflet's broken default-icon asset issue under the bundler.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { imsApi } from '../../api/ims'
import type { GpsTracker, GpsPosition, FleetVehiclePosition, Vehicle } from '../../types/ims'

// Trinidad default view (Port of Spain) when there is no position yet.
const TT_CENTER: [number, number] = [10.66, -61.51]
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTR = '&copy; OpenStreetMap contributors'

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap()
  useEffect(() => { map.setView([lat, lng], zoom ?? map.getZoom()) }, [lat, lng, zoom, map])
  return null
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'America/Port_of_Spain' })
}

// ── Vehicle GPS tab ─────────────────────────────────────────────────────────────

export function VehicleGpsTab({ vehicleId, registration }: { vehicleId: string; registration: string }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'live' | 'history'>('live')
  const [histFrom, setHistFrom] = useState<string>(() => new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 16))
  const [histTo, setHistTo] = useState<string>(() => new Date().toISOString().slice(0, 16))
  const [appliedHist, setAppliedHist] = useState<{ from: string; to: string } | null>(null)

  // Resolve assignment from the registry (no error-sniffing needed)
  const { data: trackersResp } = useQuery({ queryKey: ['gps-trackers'], queryFn: () => imsApi.getTrackers() })
  const assigned = useMemo(
    () => trackersResp?.trackers.find(tr => tr.vehicle_id === vehicleId && tr.status === 'ASSIGNED') ?? null,
    [trackersResp, vehicleId],
  )
  const registered = Boolean(assigned?.traccar_device_id != null)

  const { data: currentResp } = useQuery({
    queryKey: ['gps-current', vehicleId],
    queryFn: () => imsApi.getVehicleGpsCurrent(vehicleId),
    enabled: registered && mode === 'live',
    refetchInterval: 20_000,
  })
  const current = currentResp?.position ?? null

  const { data: histResp, isFetching: histLoading } = useQuery({
    queryKey: ['gps-history', vehicleId, appliedHist?.from, appliedHist?.to],
    queryFn: () => imsApi.getVehicleGpsHistory(vehicleId, {
      from: appliedHist ? new Date(appliedHist.from).toISOString() : undefined,
      to: appliedHist ? new Date(appliedHist.to).toISOString() : undefined,
    }),
    enabled: registered && mode === 'history' && appliedHist !== null,
  })
  const histPoints = histResp?.points ?? []

  const { data: eventsResp } = useQuery({
    queryKey: ['gps-events', vehicleId],
    queryFn: () => imsApi.getVehicleGpsEvents(vehicleId),
    enabled: registered,
  })
  const events = eventsResp?.events ?? []

  const { data: geoResp } = useQuery({
    queryKey: ['gps-geofences', vehicleId],
    queryFn: () => imsApi.getVehicleGeofences(vehicleId),
    enabled: registered,
  })
  const geofences = geoResp?.geofences ?? []

  // ── Not assigned → assign picker ─────────────────────────────────────────────
  if (!assigned) {
    return <AssignTrackerPanel vehicleId={vehicleId} registration={registration}
      onAssigned={() => qc.invalidateQueries({ queryKey: ['gps-trackers'] })} />
  }

  if (!registered) {
    return (
      <div className="p-6 overflow-auto h-full text-sm text-slate-300 space-y-3">
        <p className="text-white font-medium">Tracker assigned: <span className="text-orange-400">{assigned.device_serial}</span></p>
        <p className="text-slate-400">
          This tracker is assigned to {registration} but is not yet registered in Traccar
          (no device id). Complete the cutover (repoint the device by SMS and capture its
          Traccar device id), then set the device id on the tracker in the GPS Trackers registry.
        </p>
      </div>
    )
  }

  const center: [number, number] = current ? [current.latitude, current.longitude]
    : histPoints.length ? [histPoints[0].latitude, histPoints[0].longitude]
    : TT_CENTER

  return (
    <div className="p-4 overflow-auto h-full space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        {(['live', 'history'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              mode === m ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {m === 'live' ? 'Live' : 'History'}
          </button>
        ))}
        {mode === 'live' && current && (
          <span className="text-xs text-slate-400 ml-auto">
            {current.speed_kmh.toFixed(0)} km/h · {fmtTime(current.fix_time)}
          </span>
        )}
      </div>

      {mode === 'history' && (
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="flex flex-col gap-1 text-slate-400">From
            <input type="datetime-local" value={histFrom} onChange={e => setHistFrom(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white" /></label>
          <label className="flex flex-col gap-1 text-slate-400">To
            <input type="datetime-local" value={histTo} onChange={e => setHistTo(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white" /></label>
          <button onClick={() => setAppliedHist({ from: histFrom, to: histTo })}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg">Show route</button>
          {histLoading && <span className="text-slate-400">Loading…</span>}
          {appliedHist && !histLoading && <span className="text-slate-400">{histPoints.length} points</span>}
        </div>
      )}

      {/* Map */}
      <div className="rounded-lg overflow-hidden border border-slate-700" style={{ height: '320px' }}>
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
          <Recenter lat={center[0]} lng={center[1]} />

          {/* Geofences (circle WKT only rendered; polygons omitted from preview) */}
          {geofences.map(gf => {
            const c = parseCircle(gf.area)
            return c ? <Circle key={gf.id} center={[c.lat, c.lng]} radius={c.radius}
              pathOptions={{ color: '#38bdf8', fillOpacity: 0.08 }} /> : null
          })}

          {mode === 'live' && current && (
            <CircleMarker center={[current.latitude, current.longitude]} radius={8}
              pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.9 }}>
              <Popup>{registration}<br />{current.speed_kmh.toFixed(0)} km/h<br />{fmtTime(current.fix_time)}</Popup>
            </CircleMarker>
          )}

          {mode === 'history' && histPoints.length > 0 && (
            <>
              <Polyline positions={histPoints.map(p => [p.latitude, p.longitude] as [number, number])}
                pathOptions={{ color: '#f97316', weight: 3 }} />
              <CircleMarker center={[histPoints[0].latitude, histPoints[0].longitude]} radius={6}
                pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.9 }}>
                <Popup>Start · {fmtTime(histPoints[0].fix_time)}</Popup>
              </CircleMarker>
              <CircleMarker center={[histPoints[histPoints.length - 1].latitude, histPoints[histPoints.length - 1].longitude]} radius={6}
                pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9 }}>
                <Popup>End · {fmtTime(histPoints[histPoints.length - 1].fix_time)}</Popup>
              </CircleMarker>
            </>
          )}
        </MapContainer>
      </div>

      {/* Geofences + Events */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GeofencesSection vehicleId={vehicleId} geofences={geofences} current={current}
          onChange={() => qc.invalidateQueries({ queryKey: ['gps-geofences', vehicleId] })} />
        <div>
          <h4 className="text-white text-sm font-medium mb-2">Recent events (24h)</h4>
          {events.length === 0 ? (
            <p className="text-slate-500 text-xs">No events.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-auto">
              {events.map(ev => (
                <div key={ev.id} className="text-xs text-slate-300 bg-slate-900 border border-slate-700 rounded px-2 py-1">
                  <span className="text-orange-400">{prettyEvent(ev.type)}</span> · {fmtTime(ev.eventTime)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Assign tracker (when none assigned) ─────────────────────────────────────────

function AssignTrackerPanel({ vehicleId, registration, onAssigned }:
  { vehicleId: string; registration: string; onAssigned: () => void }) {
  const { data } = useQuery({ queryKey: ['gps-trackers'], queryFn: () => imsApi.getTrackers() })
  const [sel, setSel] = useState('')
  const [busy, setBusy] = useState(false)
  const spares = (data?.trackers ?? []).filter(tr => tr.status === 'UNASSIGNED')

  const assign = async () => {
    if (!sel) return
    setBusy(true)
    try { await imsApi.updateTracker(sel, { vehicle_id: vehicleId }); onAssigned() }
    finally { setBusy(false) }
  }

  return (
    <div className="p-6 overflow-auto h-full text-sm space-y-4">
      <p className="text-slate-300">No GPS tracker is assigned to <span className="text-white">{registration}</span>.</p>
      {spares.length === 0 ? (
        <p className="text-slate-500 text-xs">No unassigned trackers available. Add one in the GPS Trackers registry first.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-slate-400 text-xs">Assign tracker
            <select value={sel} onChange={e => setSel(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white min-w-[16rem]">
              <option value="">Select a tracker…</option>
              {spares.map(tr => (
                <option key={tr.id} value={tr.id}>{tr.device_serial}{tr.model ? ` (${tr.model})` : ''}</option>
              ))}
            </select>
          </label>
          <button onClick={assign} disabled={!sel || busy}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg">
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Geofences section ───────────────────────────────────────────────────────────

function GeofencesSection({ vehicleId, geofences, current, onChange }: {
  vehicleId: string
  geofences: { id: number; name: string; area: string }[]
  current: GpsPosition | null
  onChange: () => void
}) {
  const [name, setName] = useState('')
  const [radius, setRadius] = useState('200')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!name || !current) return
    setBusy(true)
    try {
      await imsApi.createGeofence(vehicleId, {
        name, type: 'circle',
        center: { lat: current.latitude, lng: current.longitude },
        radius_m: Number(radius) || 200,
      })
      setName('')
      onChange()
    } finally { setBusy(false) }
  }

  const remove = async (gfid: number) => {
    await imsApi.deleteGeofence(vehicleId, gfid)
    onChange()
  }

  return (
    <div>
      <h4 className="text-white text-sm font-medium mb-2">Geofences</h4>
      <div className="space-y-1 mb-3 max-h-32 overflow-auto">
        {geofences.length === 0 ? <p className="text-slate-500 text-xs">No geofences.</p> :
          geofences.map(gf => (
            <div key={gf.id} className="flex items-center justify-between text-xs text-slate-300 bg-slate-900 border border-slate-700 rounded px-2 py-1">
              <span>{gf.name}</span>
              <button onClick={() => remove(gf.id)} className="text-red-400 hover:text-red-300">Delete</button>
            </div>
          ))}
      </div>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1 text-slate-400">Name
          <input value={name} onChange={e => setName(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white" placeholder="e.g. Barataria yard" /></label>
        <label className="flex flex-col gap-1 text-slate-400">Radius (m)
          <input value={radius} onChange={e => setRadius(e.target.value)} type="number"
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white w-24" /></label>
        <button onClick={add} disabled={!name || !current || busy}
          className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg">
          {busy ? 'Adding…' : '+ Add (at current position)'}
        </button>
      </div>
      {!current && <p className="text-slate-500 text-[11px] mt-1">A live position is needed to centre a geofence.</p>}
    </div>
  )
}

// ── Fleet map modal ─────────────────────────────────────────────────────────────

export function FleetMapModal({ onClose }: { onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['gps-fleet'],
    queryFn: () => imsApi.getFleetPositions(),
    refetchInterval: 30_000,
  })
  const fleet: FleetVehiclePosition[] = data?.fleet ?? []
  const located = fleet.filter(f => f.position)
  const center: [number, number] = located.length
    ? [located[0].position!.latitude, located[0].position!.longitude] : TT_CENTER

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-2 sm:p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-5xl shadow-2xl flex flex-col" style={{ height: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <h2 className="text-white font-semibold">Fleet Map — {located.length}/{fleet.length} located</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-hidden">
          <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
            {located.map(f => (
              <CircleMarker key={f.vehicle_id} center={[f.position!.latitude, f.position!.longitude]} radius={8}
                pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.9 }}>
                <Popup>
                  <strong>{f.registration_number}</strong><br />
                  {f.make} {f.model}<br />
                  {f.position!.speed_kmh.toFixed(0)} km/h · {fmtTime(f.position!.fix_time)}
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
        {fleet.length > 0 && (
          <div className="px-5 py-2 border-t border-slate-700 text-xs text-slate-400 flex-shrink-0 overflow-x-auto whitespace-nowrap">
            {fleet.map(f => (
              <span key={f.vehicle_id} className="mr-4">
                {f.registration_number}: {f.position ? `${f.position.speed_kmh.toFixed(0)} km/h` : 'no fix'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tracker registry modal ──────────────────────────────────────────────────────

export function TrackersModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['gps-trackers'], queryFn: () => imsApi.getTrackers() })
  const { data: vehiclesResp } = useQuery({ queryKey: ['gps-vehicles-picker'], queryFn: () => imsApi.getVehicles({ limit: 100 }) })
  const trackers: GpsTracker[] = data?.trackers ?? []
  const vehicles: Vehicle[] = vehiclesResp?.vehicles ?? []
  const [adding, setAdding] = useState(false)

  const refresh = () => { qc.invalidateQueries({ queryKey: ['gps-trackers'] }); qc.invalidateQueries({ queryKey: ['gps-fleet'] }) }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-2 sm:p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-4xl shadow-2xl flex flex-col" style={{ height: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <h2 className="text-white font-semibold">GPS Trackers</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => setAdding(a => !a)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded-lg">
              {adding ? 'Close' : '+ Add tracker'}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {adding && <AddTrackerForm onDone={() => { setAdding(false); refresh() }} />}
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2">Serial</th>
                  <th className="text-left px-3 py-2">Model</th>
                  <th className="text-left px-3 py-2">SIM</th>
                  <th className="text-left px-3 py-2">Traccar ID</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Vehicle</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trackers.map(tr => (
                  <TrackerRow key={tr.id} tracker={tr} vehicles={vehicles} onChange={refresh} />
                ))}
                {trackers.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No trackers registered.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackerRow({ tracker, vehicles, onChange }:
  { tracker: GpsTracker; vehicles: Vehicle[]; onChange: () => void }) {
  const [editTid, setEditTid] = useState(false)
  const [tidVal, setTidVal] = useState(tracker.traccar_device_id?.toString() ?? '')

  const assign = async (vehicleId: string) => {
    await imsApi.updateTracker(tracker.id, vehicleId ? { vehicle_id: vehicleId } : { vehicle_id: null })
    onChange()
  }
  const saveTid = async () => {
    await imsApi.updateTracker(tracker.id, { traccar_device_id: tidVal ? Number(tidVal) : null })
    setEditTid(false); onChange()
  }
  const retire = async () => { await imsApi.updateTracker(tracker.id, { status: 'RETIRED', vehicle_id: null }); onChange() }
  const del = async () => { if (confirm(`Delete tracker ${tracker.device_serial}?`)) { await imsApi.deleteTracker(tracker.id); onChange() } }

  return (
    <tr className="border-t border-slate-700 text-slate-300">
      <td className="px-3 py-2 font-mono">{tracker.device_serial}</td>
      <td className="px-3 py-2">{tracker.model ?? '—'}</td>
      <td className="px-3 py-2">{tracker.sim_phone ?? '—'}</td>
      <td className="px-3 py-2">
        {editTid ? (
          <span className="flex items-center gap-1">
            <input value={tidVal} onChange={e => setTidVal(e.target.value)} type="number"
              className="w-20 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-white" />
            <button onClick={saveTid} className="text-green-400">✓</button>
            <button onClick={() => setEditTid(false)} className="text-slate-500">✕</button>
          </span>
        ) : (
          <button onClick={() => setEditTid(true)} className="hover:text-orange-400">
            {tracker.traccar_device_id ?? <span className="text-slate-500">set…</span>}
          </button>
        )}
      </td>
      <td className="px-3 py-2">
        <span className={`px-1.5 py-0.5 rounded text-[11px] ${
          tracker.status === 'ASSIGNED' ? 'bg-green-900 text-green-300' :
          tracker.status === 'RETIRED' ? 'bg-slate-700 text-slate-400' : 'bg-amber-900 text-amber-300'}`}>
          {tracker.status}
        </span>
      </td>
      <td className="px-3 py-2">
        {tracker.status !== 'RETIRED' && (
          <select value={tracker.vehicle_id ?? ''} onChange={e => assign(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-white max-w-[12rem]">
            <option value="">— unassigned —</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>{v.registration_number}</option>
            ))}
          </select>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {tracker.status !== 'RETIRED' && <button onClick={retire} className="text-amber-400 hover:text-amber-300">Retire</button>}
          <button onClick={del} className="text-red-400 hover:text-red-300">Delete</button>
        </div>
      </td>
    </tr>
  )
}

function AddTrackerForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ device_serial: '', model: '', protocol: 'tkstar', sim_phone: '', traccar_device_id: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    if (!f.device_serial) return
    setBusy(true)
    try {
      await imsApi.createTracker({
        device_serial: f.device_serial,
        model: f.model || undefined,
        protocol: f.protocol || undefined,
        sim_phone: f.sim_phone || undefined,
        traccar_device_id: f.traccar_device_id ? Number(f.traccar_device_id) : undefined,
        notes: f.notes || undefined,
      })
      onDone()
    } finally { setBusy(false) }
  }

  const cls = 'bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs'
  return (
    <div className="mb-4 p-3 bg-slate-900/50 border border-slate-700 rounded-lg grid grid-cols-2 sm:grid-cols-3 gap-2">
      <input className={cls} placeholder="Device serial / ID *" value={f.device_serial} onChange={set('device_serial')} />
      <input className={cls} placeholder="Model (e.g. TK918-4GSA)" value={f.model} onChange={set('model')} />
      <select className={cls} value={f.protocol} onChange={set('protocol')}>
        <option value="tkstar">tkstar</option>
        <option value="gt06">gt06</option>
        <option value="h02">h02</option>
      </select>
      <input className={cls} placeholder="SIM phone" value={f.sim_phone} onChange={set('sim_phone')} />
      <input className={cls} placeholder="Traccar device id" type="number" value={f.traccar_device_id} onChange={set('traccar_device_id')} />
      <input className={cls} placeholder="Notes" value={f.notes} onChange={set('notes')} />
      <div className="col-span-2 sm:col-span-3 flex justify-end">
        <button onClick={save} disabled={!f.device_serial || busy}
          className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs rounded-lg">
          {busy ? 'Saving…' : 'Save tracker'}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

// Parse Traccar CIRCLE WKT: "CIRCLE (lat lng, radius)"
function parseCircle(area: string): { lat: number; lng: number; radius: number } | null {
  const m = /CIRCLE\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*,\s*(\d+\.?\d*)\s*\)/i.exec(area)
  if (!m) return null
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), radius: parseFloat(m[3]) }
}

function prettyEvent(type: string): string {
  const map: Record<string, string> = {
    geofenceEnter: 'Entered geofence',
    geofenceExit: 'Left geofence',
    deviceOverspeed: 'Overspeed',
    sos: 'SOS',
    alarm: 'Alarm',
    deviceOnline: 'Online',
    deviceOffline: 'Offline',
    deviceMoving: 'Moving',
    deviceStopped: 'Stopped',
    ignitionOn: 'Ignition on',
    ignitionOff: 'Ignition off',
  }
  return map[type] ?? type
}
