import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

interface Photo {
  url: string
  caption: string | null
  display_order: number
}

interface BookingUnit {
  unit_number: string
  bedrooms: number | null
  bathrooms: string | null
  floor_area_sqft: string | null
  wasa_included: boolean
  electricity_included: boolean
  internet_included: boolean
  listing_description: string | null
  rent_amount: string | null
  suggested_rent_recommended_ttd: string | null
  city: string | null
}

interface BookingData {
  unit: BookingUnit
  photos: Photo[]
}

const API_BASE = '/api/v1/public/book'

const EMPLOYMENT_STATUSES = ['Employed (full-time)', 'Employed (part-time)', 'Self-employed', 'Student', 'Retired', 'Unemployed', 'Other']
const INCOME_RANGES = [
  'Under $1,500', '$1,500 – $2,500', '$2,500 – $3,500', '$3,500 – $5,000',
  '$5,000 – $8,000', '$8,000 – $12,000', '$12,000 – $18,000', 'Over $18,000',
]

function fmtMoney(v: string | null): string | null {
  if (!v) return null
  const n = parseFloat(v)
  if (!n) return null
  return `TTD $${n.toLocaleString('en-TT', { maximumFractionDigits: 0 })}`
}

function YesNoToggle({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 mb-1">{label}</label>
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange(false)}
          className={`flex-1 text-sm py-2 rounded-lg border transition ${value === false ? 'border-emerald-500 bg-emerald-900/30 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>
          No
        </button>
        <button type="button" onClick={() => onChange(true)}
          className={`flex-1 text-sm py-2 rounded-lg border transition ${value === true ? 'border-emerald-500 bg-emerald-900/30 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>
          Yes
        </button>
      </div>
    </div>
  )
}

export default function PublicBooking() {
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<BookingData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const [screeningOpen, setScreeningOpen] = useState(false)
  const [employmentStatus, setEmploymentStatus] = useState('')
  const [incomeRange, setIncomeRange] = useState('')
  const [adults, setAdults] = useState('')
  const [children, setChildren] = useState('')
  const [hasPets, setHasPets] = useState<boolean | null>(null)
  const [petDetails, setPetDetails] = useState('')
  const [isSmoker, setIsSmoker] = useState<boolean | null>(null)
  const [moveInDate, setMoveInDate] = useState('')
  const [reasonForMoving, setReasonForMoving] = useState('')
  const [consentsBackgroundCheck, setConsentsBackgroundCheck] = useState<boolean | null>(null)
  const [evictedOrBrokeLease, setEvictedOrBrokeLease] = useState<boolean | null>(null)
  const [evictionDetails, setEvictionDetails] = useState('')
  const [canProvideReferences, setCanProvideReferences] = useState<boolean | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    document.title = 'JAG Properties — For Rent'
  }, [])

  useEffect(() => {
    if (!slug) return
    fetch(`${API_BASE}/${slug}`)
      .then(async res => {
        const body = await res.json() as { success: boolean; data: BookingData; error?: string }
        if (!res.ok || !body.success) throw new Error(body.error ?? 'This listing is no longer available.')
        setData(body.data)
      })
      .catch(e => setLoadError((e as Error).message))
      .finally(() => setLoading(false))
  }, [slug])

  const screeningComplete =
    employmentStatus !== '' && incomeRange !== '' && adults.trim() !== '' && children.trim() !== '' &&
    hasPets !== null && isSmoker !== null && moveInDate.trim() !== '' && reasonForMoving.trim() !== '' &&
    consentsBackgroundCheck !== null && evictedOrBrokeLease !== null && canProvideReferences !== null

  async function submitBooking() {
    if (!slug || !name.trim() || !phone.trim() || !screeningComplete) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`${API_BASE}/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_name: name.trim(),
          prospect_phone: phone.trim(),
          prospect_email: email.trim() || undefined,
          screening_answers: {
            employment_status: employmentStatus,
            monthly_income_range: incomeRange,
            adults: parseInt(adults, 10),
            children: parseInt(children, 10),
            has_pets: hasPets,
            pet_details: hasPets ? petDetails.trim() || undefined : undefined,
            is_smoker: isSmoker,
            move_in_date: moveInDate,
            reason_for_moving: reasonForMoving.trim(),
            consents_background_check: consentsBackgroundCheck,
            evicted_or_broke_lease: evictedOrBrokeLease,
            eviction_details: evictedOrBrokeLease ? evictionDetails.trim() || undefined : undefined,
            can_provide_references: canProvideReferences,
          },
        }),
      })
      const body = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Could not book this viewing. Please try again.')
      setConfirmed(true)
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <p className="text-slate-400">Loading listing…</p>
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold mb-2">Listing not found</p>
          <p className="text-slate-400 text-sm">{loadError ?? 'This unit is no longer listed.'}</p>
        </div>
      </div>
    )
  }

  const { unit, photos } = data
  const rent = fmtMoney(unit.rent_amount) ?? fmtMoney(unit.suggested_rent_recommended_ttd)

  return (
    <div className="min-h-screen bg-slate-900 text-white pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="flex items-center gap-2 mb-3">
          <img src="/jag-logo.png" alt="JAG Properties" className="w-8 h-8 rounded" />
          <span className="text-sm font-semibold tracking-wide text-slate-200">JAG Properties</span>
        </div>
        <p className="text-xs font-semibold tracking-wide text-emerald-400 uppercase mb-1">For Rent</p>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">
          {unit.bedrooms != null ? `${unit.bedrooms}-Bedroom Apartment` : 'Apartment'}
          {unit.city ? ` — ${unit.city}` : ''}
        </h1>
        {rent && <p className="text-xl text-emerald-400 font-semibold mb-4">{rent}/month</p>}

        {photos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
            {photos.map((p, i) => (
              <button
                key={p.url ?? i}
                type="button"
                onClick={() => setLightboxIndex(i)}
                className="relative cursor-zoom-in"
              >
                <img
                  src={p.url}
                  alt={p.caption ?? `Photo ${i + 1}`}
                  className="w-full h-32 sm:h-40 object-cover rounded-lg border border-slate-700 hover:border-emerald-500 transition"
                />
                {p.caption && (
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-b-lg truncate">
                    {p.caption}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-4 text-sm text-slate-300 mb-4">
          {unit.bedrooms != null && <span>🛏 {unit.bedrooms} bed</span>}
          {unit.bathrooms != null && <span>🚿 {unit.bathrooms} bath</span>}
          {unit.floor_area_sqft && <span>📐 {unit.floor_area_sqft} ft²</span>}
        </div>

        <div className="flex gap-2 flex-wrap mb-6">
          {unit.wasa_included && <span className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-300">WASA included</span>}
          {unit.electricity_included && <span className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-300">Electricity included</span>}
          {unit.internet_included && <span className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-300">Internet included</span>}
        </div>

        {unit.listing_description && (
          <p className="text-sm text-slate-300 whitespace-pre-line mb-8 leading-relaxed">{unit.listing_description}</p>
        )}

        <div className="border-t border-slate-700 pt-6">
          <h2 className="text-lg font-semibold mb-4">Request a Viewing</h2>

          {confirmed ? (
            <div className="rounded-lg border border-emerald-700 bg-emerald-900/20 p-4">
              <p className="text-emerald-300 font-semibold mb-1">Request received!</p>
              <p className="text-sm text-slate-300">
                We're reviewing your details and will send you a WhatsApp message with a link to pick a viewing time shortly.
              </p>
            </div>
          ) : !screeningOpen ? (
            <button
              onClick={() => setScreeningOpen(true)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-lg text-sm transition"
            >
              Request a Viewing
            </button>
          ) : (
            <>
              {/* Pre-screening questionnaire */}
              <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                We're excited to show the place, but want to make sure it's a perfect match to your needs first. Please answer the questions below so that we can identify if this residence is a good fit.
              </p>
              <div className="space-y-3 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Employment status</label>
                  <select value={employmentStatus} onChange={e => setEmploymentStatus(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select…</option>
                    {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Monthly income range</label>
                  <select value={incomeRange} onChange={e => setIncomeRange(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select…</option>
                    {INCOME_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Adults</label>
                    <input type="number" min={1} value={adults} onChange={e => setAdults(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 2" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Children (12 & under)</label>
                    <input type="number" min={0} value={children} onChange={e => setChildren(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 0" />
                  </div>
                </div>
                <div>
                  <YesNoToggle label="Do you have pets?" value={hasPets} onChange={setHasPets} />
                  {hasPets === true && (
                    <input value={petDetails} onChange={e => setPetDetails(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm mt-2" placeholder="What kind, how many?" />
                  )}
                </div>
                <YesNoToggle label="Is anyone in the household a smoker?" value={isSmoker} onChange={setIsSmoker} />
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Desired move-in date</label>
                  <input type="date" value={moveInDate} onChange={e => setMoveInDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Why are you looking to move?</label>
                  <textarea value={reasonForMoving} onChange={e => setReasonForMoving(e.target.value)} rows={2}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" placeholder="Briefly tell us your situation" />
                </div>
                <YesNoToggle
                  label="Are you comfortable consenting to a standard credit and background check?"
                  value={consentsBackgroundCheck} onChange={setConsentsBackgroundCheck}
                />
                <div>
                  <YesNoToggle
                    label="Have you ever been evicted or broken a lease early?"
                    value={evictedOrBrokeLease} onChange={setEvictedOrBrokeLease}
                  />
                  {evictedOrBrokeLease === true && (
                    <textarea value={evictionDetails} onChange={e => setEvictionDetails(e.target.value)} rows={2}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm mt-2"
                      placeholder="Please explain what happened" />
                  )}
                </div>
                <YesNoToggle
                  label="Can you provide references from your employer and previous landlords?"
                  value={canProvideReferences} onChange={setCanProvideReferences}
                />
              </div>

              {!screeningComplete ? (
                <p className="text-xs text-slate-500 mb-6">Please answer all the questions above to continue.</p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Your Name</label>
                    <input value={name} onChange={e => setName(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" placeholder="Full name" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">WhatsApp / Phone Number</label>
                    <input value={phone} onChange={e => setPhone(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 18681234567" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Email (optional)</label>
                    <input value={email} onChange={e => setEmail(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" placeholder="you@example.com" />
                  </div>

                  {submitError && <p className="text-xs text-red-400">{submitError}</p>}

                  <button
                    onClick={() => void submitBooking()}
                    disabled={!name.trim() || !phone.trim() || submitting}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition"
                  >
                    {submitting ? 'Submitting…' : 'Submit Request'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Photo lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center px-4"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 text-white text-2xl leading-none w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          >
            ×
          </button>
          {lightboxIndex > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i !== null ? i - 1 : i)) }}
              className="absolute left-2 sm:left-6 text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              ‹
            </button>
          )}
          {lightboxIndex < photos.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i !== null ? i + 1 : i)) }}
              className="absolute right-2 sm:right-6 text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              ›
            </button>
          )}
          <div className="flex flex-col items-center max-w-full max-h-full" onClick={e => e.stopPropagation()}>
            <img
              src={photos[lightboxIndex].url}
              alt={photos[lightboxIndex].caption ?? `Photo ${lightboxIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain rounded"
            />
            {photos[lightboxIndex].caption && (
              <p className="text-white text-sm mt-2 text-center">{photos[lightboxIndex].caption}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
