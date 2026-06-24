import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tenancyApi } from '../../api/tenancy'

const TYPE_LABEL: Record<string, string> = {
  RENT_FORMAL_DEMAND: 'Formal Demand (D+7)',
  RENT_LEGAL_NOTICE:  'Legal Notice (D+14)',
  DEPOSIT_RECON:      'Deposit Reconciliation',
}

const TYPE_COLOR: Record<string, string> = {
  RENT_FORMAL_DEMAND: 'bg-orange-900/50 text-orange-300 border-orange-700',
  RENT_LEGAL_NOTICE:  'bg-red-900/50 text-red-300 border-red-700',
  DEPOSIT_RECON:      'bg-blue-900/50 text-blue-300 border-blue-700',
}

export default function PropertiesWaApprovalsPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('PENDING')

  const { data: approvals = [] } = useQuery({
    queryKey: ['wa-approvals', statusFilter],
    queryFn: () => tenancyApi.getWaApprovals(statusFilter),
    refetchInterval: 60_000,
  })

  const sendMut = useMutation({
    mutationFn: (id: string) => tenancyApi.sendWaApproval(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-approvals'] }),
  })

  const dismissMut = useMutation({
    mutationFn: (id: string) => tenancyApi.dismissWaApproval(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-approvals'] }),
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-base font-semibold text-slate-200">{t('tenancy.pendingApprovals', 'WhatsApp Pending Approvals')}</h2>
        <select
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="PENDING">{t('tenancy.pending', 'Pending')}</option>
          <option value="SENT">{t('tenancy.sent', 'Sent')}</option>
          <option value="DISMISSED">{t('tenancy.dismissed', 'Dismissed')}</option>
        </select>
        {approvals.length > 0 && statusFilter === 'PENDING' && (
          <span className="text-xs bg-orange-700 text-orange-100 px-2 py-0.5 rounded-full font-semibold">
            {approvals.length} {t('tenancy.awaitingReview', 'awaiting review')}
          </span>
        )}
      </div>

      {approvals.length === 0 && (
        <p className="text-sm text-slate-500 py-8 text-center">
          {statusFilter === 'PENDING'
            ? t('tenancy.noApprovals', 'No messages pending approval.')
            : t('tenancy.noHistory', 'No history for this status.')}
        </p>
      )}

      <div className="space-y-3">
        {approvals.map((approval: Record<string, unknown>) => (
          <div key={String(approval['id'])} className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${TYPE_COLOR[String(approval['approval_type'])] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                    {TYPE_LABEL[String(approval['approval_type'])] ?? String(approval['approval_type'])}
                  </span>
                  <span className="text-xs font-mono text-slate-400">{String(approval['to_phone'])}</span>
                </div>
                <p className="text-sm text-slate-300 truncate">{String(approval['context_label'])}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {t('tenancy.template', 'Template')}: <span className="font-mono">{String(approval['template_name'])}</span>
                  {' · '}
                  {new Date(String(approval['created_at'])).toLocaleString('en-TT')}
                </p>
                {Boolean(approval['sent_at']) && (
                  <p className="text-xs text-green-400 mt-1">
                    {t('tenancy.sentAt', 'Sent')} {new Date(String(approval['sent_at'])).toLocaleString('en-TT')}
                  </p>
                )}
              </div>
            </div>

            {/* Preview the message components */}
            <details className="mb-3">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">{t('tenancy.previewComponents', 'Preview message data')}</summary>
              <pre className="mt-2 text-xs text-slate-400 bg-slate-900 rounded p-2 overflow-x-auto max-h-32">
                {JSON.stringify(approval['components'], null, 2) ?? ''}
              </pre>
            </details>

            {String(approval['status']) === 'PENDING' && (
              <div className="flex gap-2">
                <button
                  onClick={() => sendMut.mutate(String(approval['id']))}
                  disabled={sendMut.isPending}
                  className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-40"
                >
                  {sendMut.isPending ? t('common.sending', 'Sending...') : t('tenancy.approveAndSend', 'Approve & Send')}
                </button>
                <button
                  onClick={() => dismissMut.mutate(String(approval['id']))}
                  disabled={dismissMut.isPending}
                  className="px-3 py-1.5 text-xs border border-slate-600 text-slate-400 hover:text-slate-200 rounded disabled:opacity-40"
                >
                  {t('tenancy.dismiss', 'Dismiss')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
