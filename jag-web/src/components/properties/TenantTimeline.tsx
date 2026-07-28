import { useTranslation } from 'react-i18next'
import { fmtDate } from '../../lib/entities'
import type { Lease } from '../../types/properties'

/**
 * Where is this tenant in the tenancy lifecycle, and what happens next?
 *
 * Enquiry → Viewing → Application → Approved → Deposit → Lease → Handover
 *
 * This state is derived, never stored. Nothing in the schema records "this
 * tenant is between approval and lease" -- it was previously stated nowhere in
 * the app, which is why a record sitting at a half-finished step was invisible
 * unless you opened all eight of the old modals and compared them yourself.
 *
 * Every step is computed from data the detail pane has already fetched, so this
 * adds no queries of its own.
 *
 * `UNKNOWN` is deliberately distinct from `PENDING`. Enquiries and viewings
 * carry no tenant_id -- they predate the tenant record and are reachable only
 * through the prospect's phone number -- so for a tenant with no phone on file
 * we genuinely cannot say whether they enquired. Saying "not yet" there would
 * be a guess presented as a fact, which is the same mistake the shared
 * loading/error/empty message made.
 */

export type StepState = 'DONE' | 'CURRENT' | 'PENDING' | 'UNKNOWN'

/** Minimal shape of i18next's `t` that this module needs — key, fallback, interpolation. */
export type Translate = (key: string, fallback: string, opts?: Record<string, unknown>) => string

export interface LifecycleStep {
  id: string
  label: string
  state: StepState
  /** Date or short fact shown under the step, when there is one. */
  detail?: string
}

type Row = Record<string, unknown>

export interface TenantLifecycle {
  steps: LifecycleStep[]
  /** One-line answer to "what is this person to us right now?" */
  headline: string
  /** The single next thing that moves this tenancy forward, if any. */
  nextAction: string | null
}

function hasAny(rows: Row[] | undefined): boolean {
  return Array.isArray(rows) && rows.length > 0
}

/** Earliest `created_at` in a set of rows, for "when did this start". */
function earliest(rows: Row[], key = 'created_at'): string | null {
  const times = rows
    .map(r => (r[key] ? String(r[key]) : null))
    .filter((v): v is string => v !== null)
    .sort()
  return times[0] ?? null
}

export function deriveLifecycle(
  data: {
    hasPhone: boolean
    enquiries: Row[]
    applications: Row[]
    deposits: Row[]
    leases: Lease[]
    handover: Row[]
  },
  t: Translate,
): TenantLifecycle {
  const { hasPhone, enquiries, applications, deposits, leases, handover } = data

  // A record existing is not the same as the thing having happened. Every step
  // below that asserts "this is done" must key off evidence of *completion*,
  // not off the presence of a row:
  //   - a viewing booked for next week is not a viewing that happened, and
  //     neither is a CANCELLED or NO_SHOW one;
  //   - a handover checklist can be drafted weeks before the tenant moves in.
  // Both of those shipped as "done" in the first cut and were wrong on screen.
  const viewedDone   = enquiries.filter(e => e['completed_viewing_at'])
  const viewBooked   = enquiries.filter(e => e['latest_viewing_at'])
  const approvedApps = applications.filter(a => String(a['status']) === 'APPROVED')
  const activeLease  = leases.find(l => l.status === 'ACTIVE') ?? null
  const entryHandover = handover.filter(h => String(h['type']) === 'ENTRY')
  const entryDone     = entryHandover.filter(h => h['completed_at'])

  // A step is DONE when its evidence exists. CURRENT is assigned afterwards to
  // the first step that is not DONE, so exactly one step is ever CURRENT.
  const raw: { id: string; label: string; done: boolean; unknown?: boolean; detail?: string }[] = [
    {
      id: 'enquiry',
      label: t('tenants.lifecycle.enquiry', 'Enquiry'),
      done: hasAny(enquiries),
      unknown: !hasPhone,
      detail: hasAny(enquiries) ? (earliest(enquiries) ? fmtDate(earliest(enquiries)!) : undefined) : undefined,
    },
    {
      id: 'viewing',
      label: t('tenants.lifecycle.viewing', 'Viewing'),
      done: hasAny(viewedDone),
      unknown: !hasPhone,
      // A booked-but-not-completed viewing is shown as a booking, never as a
      // completed one — the date alone would read as "they viewed on this day".
      detail: hasAny(viewedDone)
        ? fmtDate(String(viewedDone[0]['completed_viewing_at']))
        : hasAny(viewBooked)
          ? t('tenants.lifecycle.viewingBooked', 'booked {{d}}', { d: fmtDate(String(viewBooked[0]['latest_viewing_at'])) })
          : undefined,
    },
    {
      id: 'application',
      label: t('tenants.lifecycle.application', 'Application'),
      done: hasAny(applications),
      detail: hasAny(applications) && applications[0]['submitted_at']
        ? fmtDate(String(applications[0]['submitted_at']))
        : undefined,
    },
    {
      id: 'approved',
      label: t('tenants.lifecycle.approved', 'Approved'),
      done: hasAny(approvedApps),
      detail: hasAny(approvedApps) && approvedApps[0]['decision_at']
        ? fmtDate(String(approvedApps[0]['decision_at']))
        : undefined,
    },
    {
      id: 'deposit',
      label: t('tenants.lifecycle.deposit', 'Deposit'),
      done: hasAny(deposits),
      detail: hasAny(deposits) && deposits[0]['received_date']
        ? fmtDate(String(deposits[0]['received_date']))
        : undefined,
    },
    {
      id: 'lease',
      label: t('tenants.lifecycle.lease', 'Lease'),
      done: leases.length > 0,
      detail: activeLease
        ? fmtDate(activeLease.start_date)
        : leases.length > 0
          ? t('tenants.lifecycle.leaseEnded', 'ended')
          : undefined,
    },
    {
      id: 'handover',
      label: t('tenants.lifecycle.handover', 'Handover'),
      // `created_at` is when the checklist row was made, which is not when the
      // tenant took possession. Only `completed_at` says the handover happened.
      done: hasAny(entryDone),
      detail: hasAny(entryDone)
        ? fmtDate(String(entryDone[0]['completed_at']))
        : hasAny(entryHandover) && entryHandover[0]['created_at']
          ? t('tenants.lifecycle.handoverDrafted', 'checklist started {{d}}', { d: fmtDate(String(entryHandover[0]['created_at'])) })
          : undefined,
    },
  ]

  const firstIncomplete = raw.findIndex(s => !s.done && !s.unknown)

  const steps: LifecycleStep[] = raw.map((s, i) => ({
    id: s.id,
    label: s.label,
    detail: s.detail,
    state: s.done ? 'DONE' : s.unknown ? 'UNKNOWN' : i === firstIncomplete ? 'CURRENT' : 'PENDING',
  }))

  // ── Headline ────────────────────────────────────────────────────────────────
  // Read from the far end backwards: the furthest thing that is true is the
  // truest description of this person.
  let headline: string
  if (activeLease) {
    headline = t('tenants.lifecycle.statusCurrent', 'Current tenant')
  } else if (leases.length > 0) {
    headline = t('tenants.lifecycle.statusFormer', 'Former tenant — no active lease')
  } else if (hasAny(approvedApps)) {
    headline = t('tenants.lifecycle.statusApproved', 'Approved — no lease created yet')
  } else if (hasAny(applications)) {
    headline = t('tenants.lifecycle.statusApplicant', 'Applicant — awaiting a decision')
  } else if (hasAny(enquiries)) {
    headline = t('tenants.lifecycle.statusEnquiry', 'Enquiry — no application yet')
  } else {
    headline = t('tenants.lifecycle.statusNone', 'No tenancy activity recorded')
  }

  // ── Next action ─────────────────────────────────────────────────────────────
  const NEXT: Record<string, string> = {
    enquiry:     t('tenants.lifecycle.nextEnquiry', 'No enquiry on file — log one, or add the tenancy directly.'),
    viewing:     t('tenants.lifecycle.nextViewing', 'Schedule a viewing for this prospect.'),
    application: t('tenants.lifecycle.nextApplication', 'No application yet — send the application link, or record one.'),
    approved:    t('tenants.lifecycle.nextApproved', 'Application is awaiting a decision — approve or reject it.'),
    deposit:     t('tenants.lifecycle.nextDeposit', 'Record the security deposit in Money → Deposits.'),
    lease:       t('tenants.lifecycle.nextLease', 'Create the lease — this is what starts the rent schedule.'),
    handover:    hasAny(entryHandover)
      ? t('tenants.lifecycle.nextHandoverFinish', 'The ENTRY handover checklist is started but not signed off — complete it to record the move-in.')
      : t('tenants.lifecycle.nextHandover', 'Do the move-in (ENTRY) handover checklist and issue keys.'),
  }

  const current = steps.find(s => s.state === 'CURRENT')
  const nextAction = current ? (NEXT[current.id] ?? null) : null

  return { steps, headline, nextAction }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const STEP_STYLE: Record<StepState, { dot: string; label: string }> = {
  DONE:    { dot: 'bg-green-500 border-green-400',            label: 'text-slate-200' },
  CURRENT: { dot: 'bg-blue-500 border-blue-300 ring-2 ring-blue-500/30', label: 'text-white font-medium' },
  PENDING: { dot: 'bg-slate-700 border-slate-600',            label: 'text-slate-500' },
  UNKNOWN: { dot: 'bg-slate-800 border-dashed border-slate-500', label: 'text-slate-500' },
}

export default function TenantTimeline({ lifecycle }: { lifecycle: TenantLifecycle }) {
  const { t } = useTranslation()
  const { steps, headline, nextAction } = lifecycle

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t('tenants.lifecycle.title', 'Tenancy status')}
          </p>
          <p className="text-sm text-slate-100 mt-0.5">{headline}</p>
        </div>
        {nextAction && (
          <div className="text-right max-w-xs">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {t('tenants.lifecycle.nextUp', 'Next')}
            </p>
            <p className="text-xs text-blue-300 mt-0.5">{nextAction}</p>
          </div>
        )}
      </div>

      {/* Steps — horizontal strip that scrolls rather than wrapping mid-chain,
          so the order of the lifecycle stays readable on a phone. */}
      <div className="mt-4 overflow-x-auto">
        <div className="flex items-start gap-0 min-w-max pb-1">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-start">
              <div className="flex flex-col items-center w-24 px-1">
                <div className={`w-3.5 h-3.5 rounded-full border-2 ${STEP_STYLE[s.state].dot}`} />
                <p className={`text-xs mt-1.5 text-center leading-tight ${STEP_STYLE[s.state].label}`}>
                  {s.label}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 text-center leading-tight">
                  {s.state === 'UNKNOWN'
                    ? t('tenants.lifecycle.unknown', 'no phone on file')
                    : (s.detail ?? '')}
                </p>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 w-5 mt-[7px] ${
                  steps[i + 1].state === 'DONE' ? 'bg-green-600/70' : 'bg-slate-700'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
