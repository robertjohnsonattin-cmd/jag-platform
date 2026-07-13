import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const API_BASE = '/api/v1/public/apply'

interface ApplyData {
  already_submitted: boolean
  property_name: string
  area: string
  unit_number: string
  bedrooms: number | null
  bathrooms: string | null
  prefill: { full_name: string; phone: string; email: string }
}

interface UploadedDoc { doc_type: string; label: string; object_key: string; file_name: string }

const EMPLOYMENT_TYPES: [string, string][] = [
  ['EMPLOYED', 'Employed'], ['SELF_EMPLOYED', 'Self-employed'], ['CONTRACT', 'Contract'],
  ['RETIRED', 'Retired'], ['UNEMPLOYED', 'Unemployed'], ['OTHER', 'Other'],
]

// Two forms of ID are required, each as front + back photos. Priority order
// when picking a type: National ID card first, then Driver's Permit, then
// Passport — tenants without an ID card (or a second one) can switch either
// slot to whichever they actually have.
const ID_TYPES: [string, string][] = [
  ['NATIONAL_ID', 'National ID Card'], ['DRIVERS_PERMIT', 'Driver’s Permit'], ['PASSPORT', 'Passport'],
]
const ID_SLOT_DEFAULTS = ['NATIONAL_ID', 'DRIVERS_PERMIT']

const OTHER_DOC_SLOTS: { key: string; doc_type: string; label: string }[] = [
  { key: 'employment_letter', doc_type: 'EMPLOYMENT_LETTER', label: 'Job letter' },
  { key: 'payslip', doc_type: 'PAYSLIP', label: 'Payslip' },
  { key: 'other', doc_type: 'OTHER', label: 'Other relevant document' },
]

const cls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 mb-1">{label}<span className="text-rose-400"> *</span></label>
      {children}
    </div>
  )
}

export default function PublicApply() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ApplyData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [fullName, setFullName] = useState('')
  const [dob, setDob] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [employer, setEmployer] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [income, setIncome] = useState('')
  const [ref1Name, setRef1Name] = useState('')
  const [ref1Phone, setRef1Phone] = useState('')
  const [ref1Rel, setRef1Rel] = useState('')
  const [ref2Name, setRef2Name] = useState('')
  const [ref2Phone, setRef2Phone] = useState('')
  const [ref2Rel, setRef2Rel] = useState('')
  const [landlordName, setLandlordName] = useState('')
  const [landlordPhone, setLandlordPhone] = useState('')
  const [nationality, setNationality] = useState('')
  const [permanentAddress, setPermanentAddress] = useState('')
  const [occupation, setOccupation] = useState('')
  const [workAddress, setWorkAddress] = useState('')
  const [workTelephone, setWorkTelephone] = useState('')
  const [whatsappAlt, setWhatsappAlt] = useState('')
  const [occupantsCount, setOccupantsCount] = useState('')
  const [occupantsDetail, setOccupantsDetail] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [emergencyRelation, setEmergencyRelation] = useState('')
  const [emergency2Name, setEmergency2Name] = useState('')
  const [emergency2Phone, setEmergency2Phone] = useState('')
  const [emergency2Relation, setEmergency2Relation] = useState('')

  const [idTypes, setIdTypes] = useState<[string, string]>([ID_SLOT_DEFAULTS[0], ID_SLOT_DEFAULTS[1]])
  const [docs, setDocs] = useState<Record<string, UploadedDoc>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => { document.title = 'JAG Properties — Rental Application' }, [])

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/${token}`)
      .then(async res => {
        const body = await res.json() as { success: boolean; data: ApplyData; error?: string }
        if (!res.ok || !body.success) throw new Error(body.error ?? 'This application link is invalid or has expired.')
        setData(body.data)
        setFullName(body.data.prefill.full_name)
        setPhone(body.data.prefill.phone)
        setEmail(body.data.prefill.email)
      })
      .catch(e => setLoadError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  async function uploadFile(slotKey: string, slot: { doc_type: string; label: string }, file: File) {
    setUploading(u => ({ ...u, [slotKey]: true }))
    try {
      const r1 = await fetch(`${API_BASE}/${token}/upload-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      })
      const b1 = await r1.json() as { success: boolean; data: { upload_url: string; object_key: string }; error?: string }
      if (!r1.ok || !b1.success) throw new Error(b1.error ?? 'Upload failed')
      const put = await fetch(b1.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      })
      if (!put.ok) throw new Error('Upload failed')
      setDocs(d => ({ ...d, [slotKey]: { doc_type: slot.doc_type, label: slot.label, object_key: b1.data.object_key, file_name: file.name } }))
    } catch {
      setSubmitError('A file failed to upload. Please try again.')
    } finally {
      setUploading(u => ({ ...u, [slotKey]: false }))
    }
  }

  function idSlotKeys(slotIdx: number) { return [`id${slotIdx}front`, `id${slotIdx}back`] }
  const requiredDocKeys = [...idSlotKeys(0), ...idSlotKeys(1), ...OTHER_DOC_SLOTS.map(s => s.key)]

  const textFieldsFilled = [
    fullName, dob, nationalId, email, phone, employer, employmentType, income,
    ref1Name, ref1Phone, ref1Rel, ref2Name, ref2Phone, ref2Rel, landlordName, landlordPhone,
    nationality, permanentAddress, occupation, workAddress, workTelephone, whatsappAlt,
    occupantsCount, occupantsDetail,
    emergencyName, emergencyPhone, emergencyRelation, emergency2Name, emergency2Phone, emergency2Relation,
  ].every(v => v.trim() !== '')
  const docsFilled = requiredDocKeys.every(k => Boolean(docs[k]))
  const canSubmit = textFieldsFilled && docsFilled && !submitting

  async function submit() {
    if (!token || !canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`${API_BASE}/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          date_of_birth: dob,
          national_id: nationalId.trim(),
          email: email.trim(),
          phone: phone.trim(),
          employer_name: employer.trim(),
          employment_type: employmentType,
          monthly_income_ttd: Number(income),
          reference_1_name: ref1Name.trim(),
          reference_1_phone: ref1Phone.trim(),
          reference_1_relation: ref1Rel.trim(),
          reference_2_name: ref2Name.trim(),
          reference_2_phone: ref2Phone.trim(),
          reference_2_relation: ref2Rel.trim(),
          prior_landlord_name: landlordName.trim(),
          prior_landlord_phone: landlordPhone.trim(),
          nationality: nationality.trim(),
          permanent_address: permanentAddress.trim(),
          occupation: occupation.trim(),
          work_address: workAddress.trim(),
          work_telephone: workTelephone.trim(),
          whatsapp_alt: whatsappAlt.trim(),
          occupants_count: Number(occupantsCount),
          occupants_detail: occupantsDetail.trim(),
          emergency_contact_name: emergencyName.trim(),
          emergency_contact_phone: emergencyPhone.trim(),
          emergency_contact_relation: emergencyRelation.trim(),
          emergency_contact_2_name: emergency2Name.trim(),
          emergency_contact_2_phone: emergency2Phone.trim(),
          emergency_contact_2_relation: emergency2Relation.trim(),
          documents: Object.values(docs),
        }),
      })
      const body = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Could not submit your application. Please try again.')
      setConfirmed(true)
      window.scrollTo(0, 0)
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Shell><p className="text-slate-400 text-center py-20">Loading…</p></Shell>
  if (loadError) return <Shell><div className="text-center py-16"><p className="text-rose-400 font-semibold">{loadError}</p><p className="text-slate-500 text-sm mt-2">Please contact JAG Properties if you believe this is a mistake.</p></div></Shell>
  if (data?.already_submitted || confirmed) return (
    <Shell>
      <div className="text-center py-16">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-semibold text-emerald-300">Application received</h2>
        <p className="text-slate-400 text-sm mt-2 max-w-sm mx-auto">Thank you. We’ve received your rental application and will be in touch soon with the next steps.</p>
      </div>
    </Shell>
  )

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-100">Rental Application</h1>
        {data && (
          <p className="text-sm text-slate-400 mt-1">
            {data.property_name}{data.unit_number ? ` — Unit ${data.unit_number}` : ''}
            {data.area ? ` · ${data.area}` : ''}
          </p>
        )}
        <p className="text-xs text-slate-500 mt-1">All fields <span className="text-rose-400">*</span> are required. If something doesn't apply to you, write "N/A".</p>
      </div>

      <div className="space-y-5">
        <Section title="About you">
          <Field label="Full name"><input className={cls} value={fullName} onChange={e => setFullName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth"><input type="date" className={cls} value={dob} onChange={e => setDob(e.target.value)} /></Field>
            <Field label="National ID number"><input className={cls} value={nationalId} onChange={e => setNationalId(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input className={cls} value={phone} onChange={e => setPhone(e.target.value)} /></Field>
            <Field label="Email"><input type="email" className={cls} value={email} onChange={e => setEmail(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nationality"><input className={cls} value={nationality} onChange={e => setNationality(e.target.value)} /></Field>
            <Field label="WhatsApp No. (if different)"><input className={cls} value={whatsappAlt} onChange={e => setWhatsappAlt(e.target.value)} /></Field>
          </div>
          <Field label="Permanent / family address"><textarea className={cls} rows={2} value={permanentAddress} onChange={e => setPermanentAddress(e.target.value)} /></Field>
        </Section>

        <Section title="Employment & income">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Occupation"><input className={cls} value={occupation} onChange={e => setOccupation(e.target.value)} /></Field>
            <Field label="Employer"><input className={cls} value={employer} onChange={e => setEmployer(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employment type">
              <select className={cls} value={employmentType} onChange={e => setEmploymentType(e.target.value)}>
                <option value="">Select…</option>
                {EMPLOYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Monthly income (TTD)"><input type="number" min={0} className={cls} value={income} onChange={e => setIncome(e.target.value)} /></Field>
          </div>
          <Field label="Work telephone"><input className={cls} value={workTelephone} onChange={e => setWorkTelephone(e.target.value)} /></Field>
          <Field label="Work address"><textarea className={cls} rows={2} value={workAddress} onChange={e => setWorkAddress(e.target.value)} /></Field>
        </Section>

        <Section title="Household">
          <Field label="No. of authorised occupants"><input type="number" min={0} className={cls} value={occupantsCount} onChange={e => setOccupantsCount(e.target.value)} /></Field>
          <Field label="Occupants' full names & relation to you"><textarea className={cls} rows={2} value={occupantsDetail} onChange={e => setOccupantsDetail(e.target.value)} /></Field>
        </Section>

        <Section title="Emergency contacts">
          <p className="text-xs text-slate-500 -mt-1">Two emergency contacts, not living with you.</p>
          <div className="grid grid-cols-3 gap-2">
            <input className={cls} placeholder="Name" value={emergencyName} onChange={e => setEmergencyName(e.target.value)} />
            <input className={cls} placeholder="Phone" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} />
            <input className={cls} placeholder="Relationship" value={emergencyRelation} onChange={e => setEmergencyRelation(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className={cls} placeholder="Name" value={emergency2Name} onChange={e => setEmergency2Name(e.target.value)} />
            <input className={cls} placeholder="Phone" value={emergency2Phone} onChange={e => setEmergency2Phone(e.target.value)} />
            <input className={cls} placeholder="Relationship" value={emergency2Relation} onChange={e => setEmergency2Relation(e.target.value)} />
          </div>
        </Section>

        <Section title="References">
          <p className="text-xs text-slate-500 -mt-1">Two personal/professional references.</p>
          <div className="grid grid-cols-3 gap-2">
            <input className={cls} placeholder="Name" value={ref1Name} onChange={e => setRef1Name(e.target.value)} />
            <input className={cls} placeholder="Phone" value={ref1Phone} onChange={e => setRef1Phone(e.target.value)} />
            <input className={cls} placeholder="Relationship" value={ref1Rel} onChange={e => setRef1Rel(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className={cls} placeholder="Name" value={ref2Name} onChange={e => setRef2Name(e.target.value)} />
            <input className={cls} placeholder="Phone" value={ref2Phone} onChange={e => setRef2Phone(e.target.value)} />
            <input className={cls} placeholder="Relationship" value={ref2Rel} onChange={e => setRef2Rel(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Previous landlord (name)"><input className={cls} value={landlordName} onChange={e => setLandlordName(e.target.value)} /></Field>
            <Field label="Previous landlord (phone)"><input className={cls} value={landlordPhone} onChange={e => setLandlordPhone(e.target.value)} /></Field>
          </div>
        </Section>

        <Section title="Identification">
          <p className="text-xs text-slate-500 -mt-1">Two forms of ID are required, front and back of each — the landlord will verify your ID number against the photo. Photos or PDFs accepted.</p>
          {[0, 1].map(slotIdx => {
            const idType = idTypes[slotIdx]
            const idLabel = ID_TYPES.find(([v]) => v === idType)?.[1] ?? idType
            const [frontKey, backKey] = idSlotKeys(slotIdx)
            return (
              <div key={slotIdx} className="space-y-2">
                <select
                  className={cls}
                  value={idType}
                  onChange={e => {
                    const next: [string, string] = [...idTypes] as [string, string]
                    next[slotIdx] = e.target.value
                    setIdTypes(next)
                    const relabel = ID_TYPES.find(([v]) => v === e.target.value)?.[1] ?? e.target.value
                    setDocs(d => {
                      const upd = { ...d }
                      if (upd[frontKey]) upd[frontKey] = { ...upd[frontKey], doc_type: e.target.value, label: `${relabel} — Front` }
                      if (upd[backKey]) upd[backKey] = { ...upd[backKey], doc_type: e.target.value, label: `${relabel} — Back` }
                      return upd
                    })
                  }}
                >
                  {ID_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {([[frontKey, 'Front'], [backKey, 'Back']] as const).map(([slotKey, side]) => (
                  <div key={slotKey} className="flex items-center gap-3">
                    <div className="w-16 flex-shrink-0 text-xs text-slate-400">{side}</div>
                    {docs[slotKey] ? (
                      <span className="text-xs text-emerald-400 flex-1 truncate">✓ {docs[slotKey].file_name}</span>
                    ) : uploading[slotKey] ? (
                      <span className="text-xs text-slate-500 flex-1">Uploading…</span>
                    ) : (
                      <label className="text-xs text-emerald-400 cursor-pointer hover:underline flex-1">
                        Choose file
                        <input type="file" accept="image/*,application/pdf" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(slotKey, { doc_type: idType, label: `${idLabel} — ${side}` }, f) }} />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </Section>

        <Section title="Documents">
          {OTHER_DOC_SLOTS.map(slot => (
            <div key={slot.key} className="flex items-center gap-3">
              <div className="flex-1 text-sm text-slate-300">{slot.label}</div>
              {docs[slot.key] ? (
                <span className="text-xs text-emerald-400">✓ {docs[slot.key].file_name}</span>
              ) : uploading[slot.key] ? (
                <span className="text-xs text-slate-500">Uploading…</span>
              ) : (
                <label className="text-xs text-emerald-400 cursor-pointer hover:underline">
                  Choose file
                  <input type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(slot.key, slot, f) }} />
                </label>
              )}
            </div>
          ))}
        </Section>

        {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

        <button onClick={submit} disabled={!canSubmit}
          className={`w-full py-3 rounded-lg font-semibold text-sm transition ${canSubmit ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>
        <p className="text-[11px] text-slate-600 text-center">By submitting, you confirm the information provided is accurate and consent to JAG Properties verifying it.</p>
      </div>
    </Shell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      {children}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <img src="/jag-logo.png" alt="JAG" className="h-8 w-8" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <span className="font-semibold text-slate-200">JAG Properties</span>
        </div>
        {children}
      </div>
    </div>
  )
}
