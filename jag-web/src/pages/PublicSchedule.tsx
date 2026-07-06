import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

interface Slot {
  start: string
  end: string
}

interface ScheduleEnquiry {
  prospect_name: string
  unit_number: string
  address_line1: string | null
  city: string | null
  property_name: string | null
}

interface ScheduleData {
  enquiry: ScheduleEnquiry
  available_slots: Slot[]
}

const API_BASE = '/api/v1/public/schedule'
const TT_TZ = 'America/Port_of_Spain'

function dayKey(iso: string): string {
  // en-CA gives YYYY-MM-DD, a stable sortable/groupable key in Trinidad time
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TT_TZ })
}

function fmtDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-TT', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: TT_TZ,
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-TT', {
    hour: 'numeric', minute: '2-digit', timeZone: TT_TZ,
  })
}

export default function PublicSchedule() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ start: string } | null>(null)

  useEffect(() => {
    document.title = 'JAG Properties — Schedule a Viewing'
  }, [])

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/${token}`)
      .then(async res => {
        const body = await res.json() as { success: boolean; data: ScheduleData; error?: string }
        if (!res.ok || !body.success) throw new Error(body.error ?? 'This scheduling link is invalid or has expired.')
        setData(body.data)
      })
      .catch(e => setLoadError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of data?.available_slots ?? []) {
      const key = dayKey(s.start)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return map
  }, [data])
  const dayKeys = useMemo(() => Array.from(slotsByDay.keys()), [slotsByDay])

  useEffect(() => {
    if (!selectedDay && dayKeys.length > 0) setSelectedDay(dayKeys[0])
  }, [dayKeys, selectedDay])

  async function submitSlot() {
    if (!token || !selectedSlot) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`${API_BASE}/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_start: selectedSlot }),
      })
      const body = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Could not book this slot. Please try again.')
      setConfirmed({ start: selectedSlot })
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <p className="text-slate-400">Loading…</p>
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold mb-2">Link not available</p>
          <p className="text-slate-400 text-sm">{loadError ?? 'This scheduling link is no longer valid.'}</p>
        </div>
      </div>
    )
  }

  const { enquiry, available_slots } = data
  const address = `${enquiry.address_line1 ?? enquiry.unit_number}${enquiry.city ? `, ${enquiry.city}` : ''}`

  return (
    <div className="min-h-screen bg-slate-900 text-white pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="flex items-center gap-2 mb-3">
          <img src="/jag-logo.png" alt="JAG Properties" className="w-8 h-8 rounded" />
          <span className="text-sm font-semibold tracking-wide text-slate-200">JAG Properties</span>
        </div>
        <p className="text-xs font-semibold tracking-wide text-emerald-400 uppercase mb-1">Schedule a Viewing</p>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">{enquiry.property_name ?? enquiry.unit_number}</h1>
        <p className="text-sm text-slate-400 mb-6">{address}</p>

        {confirmed ? (
          <div className="rounded-lg border border-emerald-700 bg-emerald-900/20 p-4">
            <p className="text-emerald-300 font-semibold mb-1">Viewing confirmed!</p>
            <p className="text-sm text-slate-300">
              We've sent you a WhatsApp confirmation with the exact address and time. See you then, {enquiry.prospect_name}!
            </p>
          </div>
        ) : available_slots.length === 0 ? (
          <p className="text-sm text-slate-400">No viewing slots are currently available. Please contact us directly.</p>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-2">Choose a day</p>
            <div className="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-1 px-1">
              {dayKeys.map(dk => {
                const first = slotsByDay.get(dk)![0]
                return (
                  <button
                    key={dk}
                    onClick={() => { setSelectedDay(dk); setSelectedSlot(null) }}
                    className={`shrink-0 text-xs px-3 py-2 rounded-lg border whitespace-nowrap transition ${
                      selectedDay === dk
                        ? 'border-emerald-500 bg-emerald-900/30 text-emerald-300'
                        : 'border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {fmtDayLabel(first.start)}
                  </button>
                )
              })}
            </div>

            <p className="text-sm text-slate-400 mb-2">Choose a time</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-6">
              {(selectedDay ? slotsByDay.get(selectedDay) ?? [] : []).map(s => (
                <button
                  key={s.start}
                  onClick={() => setSelectedSlot(s.start)}
                  className={`text-xs px-2 py-1.5 rounded-lg border transition ${
                    selectedSlot === s.start
                      ? 'border-emerald-500 bg-emerald-900/30 text-emerald-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>

            {submitError && <p className="text-xs text-red-400 mb-3">{submitError}</p>}

            <button
              onClick={() => void submitSlot()}
              disabled={!selectedSlot || submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition"
            >
              {submitting ? 'Booking…' : 'Confirm This Time'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
