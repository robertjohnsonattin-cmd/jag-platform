import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

const STATUS_COLORS: Record<string, string> = {
  PENDING:      'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  UNDER_REVIEW: 'bg-blue-900/50 text-blue-300 border-blue-700',
  APPROVED:     'bg-green-900/50 text-green-300 border-green-700',
  REJECTED:     'bg-red-900/50 text-red-300 border-red-700',
  WITHDRAWN:    'bg-slate-700 text-slate-500 border-slate-600',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-slate-500 w-44 flex-shrink-0">{label}</span>
      <span className="text-slate-200">{value ?? '—'}</span>
    </div>
  )
}

export default function PropertiesApplicationsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [decisionModal, setDecisionModal] = useState<'APPROVED' | 'REJECTED' | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  const { data: applications = [] } = useQuery({
    queryKey: ['applications'],
    queryFn: () => tenancyApi.getApplications(),
  })

  const { data: detail } = useQuery({
    queryKey: ['application', selected],
    queryFn: () => tenancyApi.getApplication(selected!),
    enabled: !!selected,
  })

  const decideMut = useMutation({
    mutationFn: ({ decision, reason }: { decision: string; reason?: string }) =>
      tenancyApi.decideApplication(selected!, decision, reason),
    onSuccess: () => { setDecisionModal(null); qc.invalidateQueries({ queryKey: ['applications'] }); qc.invalidateQueries({ queryKey: ['application', selected] }) },
  })

  return (
    <div className="flex gap-4 h-[700px]">
      <div className="w-80 overflow-y-auto">
        {applications.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('tenancy.noApplications', 'No applications yet.')}</p>}
        {applications.map((a: Record<string, unknown>) => (
          <div key={String(a['id'])} onClick={() => setSelected(String(a['id']))}
            className={`p-3 rounded border mb-2 cursor-pointer transition-colors ${selected === String(a['id']) ? 'border-blue-500 bg-slate-700' : 'border-slate-700 bg-slate-800 hover:bg-slate-750'}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-200">{String(a['full_name'])}</p>
              <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[String(a['status'])] ?? ''}`}>
                {String(a['status'])}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Unit {String(a['unit_number'] ?? '—')}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 border-l border-slate-700 pl-4 overflow-y-auto">
        {!selected && <p className="text-sm text-slate-500 mt-8 text-center">{t('tenancy.selectApplication', 'Select an application.')}</p>}
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-200">{String(detail['full_name'])}</h3>
              <span className={`text-xs px-2 py-1 rounded border ${STATUS_COLORS[String(detail['status'])] ?? ''}`}>{String(detail['status'])}</span>
            </div>
            <div className="space-y-2">
              <InfoRow label={t('tenancy.phone', 'Phone')} value={String(detail['phone'] ?? '')} />
              <InfoRow label={t('tenancy.email', 'Email')} value={String(detail['email'] ?? '')} />
              <InfoRow label={t('tenancy.nationalId', 'National ID')} value={String(detail['national_id'] ?? '')} />
              <InfoRow label={t('tenancy.employer', 'Employer')} value={String(detail['employer_name'] ?? '')} />
              <InfoRow label={t('tenancy.employmentType', 'Employment')} value={String(detail['employment_type'] ?? '')} />
              <InfoRow label={t('tenancy.monthlyIncome', 'Monthly Income TTD')}
                value={detail['monthly_income_ttd'] ? `$${parseFloat(String(detail['monthly_income_ttd'])).toLocaleString('en-TT', { minimumFractionDigits: 2 })}` : null} />
              <InfoRow label={t('tenancy.ref1', 'Reference 1')} value={detail['reference_1_name'] ? `${detail['reference_1_name']} (${detail['reference_1_relation']}) ${detail['reference_1_phone']}` : null} />
              <InfoRow label={t('tenancy.ref2', 'Reference 2')} value={detail['reference_2_name'] ? `${detail['reference_2_name']} (${detail['reference_2_relation']}) ${detail['reference_2_phone']}` : null} />
              <InfoRow label={t('tenancy.priorLandlord', 'Prior Landlord')} value={detail['prior_landlord_name'] ? `${detail['prior_landlord_name']} ${detail['prior_landlord_phone']}` : null} />
            </div>
            {String(detail['status']) === 'PENDING' || String(detail['status']) === 'UNDER_REVIEW' ? (
              <div className="flex gap-2 pt-2">
                <button onClick={() => setDecisionModal('APPROVED')}
                  className="px-4 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded">
                  {t('tenancy.approve', 'Approve')}
                </button>
                <button onClick={() => setDecisionModal('REJECTED')}
                  className="px-4 py-2 text-sm bg-red-800 hover:bg-red-700 text-white rounded">
                  {t('tenancy.reject', 'Reject')}
                </button>
              </div>
            ) : null}
            {Boolean(detail['rejection_reason']) && (
              <p className="text-sm text-red-400">{t('tenancy.rejectedReason', 'Reason')}: {String(detail['rejection_reason'])}</p>
            )}
          </div>
        )}
      </div>

      {decisionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold mb-3">{decisionModal === 'APPROVED' ? t('tenancy.confirmApprove', 'Approve Application?') : t('tenancy.confirmReject', 'Reject Application?')}</h3>
            {decisionModal === 'REJECTED' && (
              <textarea className={cls} rows={3} placeholder={t('tenancy.rejectionReason', 'Reason for rejection...')}
                value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
            )}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setDecisionModal(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel','Cancel')}</button>
              <button onClick={() => decideMut.mutate({ decision: decisionModal, reason: rejectionReason || undefined })}
                disabled={decideMut.isPending}
                className={`px-4 py-2 text-sm text-white rounded disabled:opacity-40 ${decisionModal === 'APPROVED' ? 'bg-green-700 hover:bg-green-600' : 'bg-red-800 hover:bg-red-700'}`}>
                {decideMut.isPending ? t('common.saving','Saving...') : t('common.confirm','Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
