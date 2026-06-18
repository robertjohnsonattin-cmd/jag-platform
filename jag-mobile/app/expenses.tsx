import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Platform,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { expensesApi, type Expense } from '../src/api/expenses'
import { CATEGORY_LABELS } from '../src/constants/enums'

const STATUS_COLORS: Record<string, string> = {
  DRAFT:     '#475569',
  SUBMITTED: '#3b82f6',
  APPROVED:  '#22c55e',
  REJECTED:  '#ef4444',
  REVERSED:  '#f59e0b',
}

function fmtAmount(amount: string) {
  return parseFloat(amount).toLocaleString('en-TT', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-TT', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function ExpenseList() {
  const router = useRouter()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const rows = await expensesApi.list({ limit: 50 })
      setExpenses(rows)
    } catch {}
    finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useFocusEffect(useCallback(() => { load() }, []))

  function onRefresh() {
    setRefreshing(true)
    load(true)
  }

  const now = new Date()
  const thisMonth = expenses.filter(e => {
    const d = new Date(e.expense_date)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const monthTotal = thisMonth.reduce((s, e) => s + parseFloat(e.amount_ttd ?? '0'), 0)

  function renderItem({ item: e }: { item: Expense }) {
    const catLabel = CATEGORY_LABELS[e.category as keyof typeof CATEGORY_LABELS] ?? e.category
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.cardDate}>{fmtDate(e.expense_date)}</Text>
          <Text style={styles.cardAmount}>TTD {fmtAmount(e.amount_ttd)}</Text>
        </View>
        <Text style={styles.cardDesc} numberOfLines={1}>{e.description}</Text>
        {e.payee_name ? <Text style={styles.cardPayee}>{e.payee_name}</Text> : null}
        <View style={[styles.cardRow, { marginTop: 8 }]}>
          <Text style={styles.cardCat}>{catLabel}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[e.status] ?? '#475569' }]}>
            <Text style={styles.badgeText}>{e.status}</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Expenses</Text>
        <TouchableOpacity onPress={() => router.push('/expense-form')}>
          <Text style={styles.newBtn}>+ New</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <View>
          <Text style={styles.summaryLabel}>This month</Text>
          <Text style={styles.summaryAmount}>
            TTD {monthTotal.toLocaleString('en-TT', { minimumFractionDigits: 2 })}
          </Text>
        </View>
        <View style={styles.summaryRight}>
          <Text style={styles.summaryLabel}>Transactions</Text>
          <Text style={styles.summaryCount}>{thisMonth.length}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 48 }} size="large" />
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={e => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No expenses yet</Text>
          }
          ListFooterComponent={
            expenses.length === 50
              ? <Text style={styles.footer}>Showing 50 most recent — use web for full history</Text>
              : null
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f172a' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 24, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  back:   { color: '#64748b', fontSize: 15 },
  title:  { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  newBtn: { color: '#3b82f6', fontSize: 15, fontWeight: '600' },

  summary: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1e293b', marginHorizontal: 16, marginTop: 16,
    borderRadius: 12, padding: 16,
  },
  summaryLabel:  { color: '#94a3b8', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  summaryAmount: { color: '#f8fafc', fontSize: 22, fontWeight: '700' },
  summaryRight:  { alignItems: 'flex-end' },
  summaryCount:  { color: '#f8fafc', fontSize: 22, fontWeight: '700' },

  list:  { padding: 16, gap: 10 },
  empty: { color: '#475569', fontSize: 16, textAlign: 'center', marginTop: 48 },
  footer:{ color: '#475569', fontSize: 13, textAlign: 'center', paddingVertical: 16 },

  card: {
    backgroundColor: '#1e293b', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#334155',
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate:   { color: '#64748b', fontSize: 12 },
  cardAmount: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  cardDesc:   { color: '#f8fafc', fontSize: 15, marginTop: 4 },
  cardPayee:  { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  cardCat:    { color: '#64748b', fontSize: 12 },

  badge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
})
