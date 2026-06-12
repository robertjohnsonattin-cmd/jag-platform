import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../api/finance'
import { api } from '../../api/client'
import { fmtDate } from '../../lib/entities'

export default function FxRatesPanel() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ currency: '', rate_date: '', rate_to_ttd: '' })
  const [formError, setFormError] = useState('')

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['finance', 'fx-rates'],
    queryFn: financeApi.getFxRates,
  })

  const { mutate: upsertRate, isPending } = useMutation({
    mutationFn: () =>
      api.post('/finance/fx-rates', {
        currency: form.currency.toUpperCase(),
        rate_date: form.rate_date,
        rate_to_ttd: parseFloat(form.rate_to_ttd),
        source: 'MANUAL',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'fx-rates'] })
      setForm({ currency: '', rate_date: '', rate_to_ttd: '' })
      setFormError('')
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Failed to save rate.'),
  })

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    setFormError('')
    if (!form.currency || form.currency.length !== 3) { setFormError('Currency must be 3 letters.'); return }
    if (!form.rate_date) { setFormError('Date is required.'); return }
    if (!form.rate_to_ttd || parseFloat(form.rate_to_ttd) <= 0) { setFormError('Rate must be a positive number.'); return }
    upsertRate()
  }

  return (
    <div>
      {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}

      {rates.length > 0 && (
        <div className="rounded-lg overflow-hidden border border-slate-700 mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Currency</th>
                <th className="text-right px-4 py-2">Rate to TTD</th>
                <th className="text-right px-4 py-2">Date</th>
                <th className="text-right px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {rates.map((r) => (
                <tr key={r.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-100">{r.currency}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-300">
                    {parseFloat(r.rate_to_ttd).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400">{fmtDate(r.rate_date)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / update rate form */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 max-w-md">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Add / Update Rate</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Currency (ISO)</label>
              <input
                maxLength={3}
                placeholder="USD"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Rate to TTD</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="6.7800"
                value={form.rate_to_ttd}
                onChange={(e) => setForm((f) => ({ ...f, rate_to_ttd: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Date</label>
            <input
              type="date"
              value={form.rate_date}
              onChange={(e) => setForm((f) => ({ ...f, rate_date: e.target.value }))}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {formError && <p className="text-red-400 text-xs">{formError}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? 'Saving…' : 'Save Rate'}
          </button>
        </form>
      </div>
    </div>
  )
}
