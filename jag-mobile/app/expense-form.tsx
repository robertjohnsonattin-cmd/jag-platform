import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { logout } from '../src/auth/keycloak'
import { expensesApi, creditCardsApi, fxRatesApi, type CreditCard } from '../src/api/expenses'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  ENTITY_OPTIONS,
  CURRENCIES,
  type ExpenseCategory,
  type PaymentMethod,
  type Currency,
} from '../src/constants/enums'

const FALLBACK_FX: Record<string, number> = {
  TTD: 1, USD: 6.78, CNY: 0.94, EUR: 7.35, GBP: 8.60,
}

function toTTD(amount: number, currency: Currency, rateMap: Record<string, number>): number {
  const rate = rateMap[currency] ?? FALLBACK_FX[currency] ?? 1
  return parseFloat((amount * rate).toFixed(2))
}

function randomKey(): string {
  return `mob-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function cardLabel(card: CreditCard): string {
  return card.last_four ? `${card.card_name} •••• ${card.last_four}` : card.card_name
}

type PickerField = 'category' | 'entity' | 'paymentMethod' | 'currency' | 'card' | null

export default function ExpenseForm() {
  const router = useRouter()

  const today = new Date().toISOString().slice(0, 10)
  const [amount, setAmount]               = useState('')
  const [currency, setCurrency]           = useState<Currency>('TTD')
  const [category, setCategory]           = useState<ExpenseCategory>('PERSONAL_EXPENSE')
  const [entityId, setEntityId]           = useState<string>(ENTITY_OPTIONS[0].id)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [description, setDescription]    = useState('')
  const [payee, setPayee]               = useState('')
  const [note, setNote]                   = useState('')
  const [expenseDate, setExpenseDate]     = useState(today)
  const [receiptUri, setReceiptUri]       = useState<string | null>(null)

  const [activePicker, setActivePicker]   = useState<PickerField>(null)
  const [saving, setSaving]               = useState(false)

  // Credit card state
  const [cards, setCards]                 = useState<CreditCard[]>([])
  const [addingCard, setAddingCard]       = useState(false)
  const [newCardName, setNewCardName]     = useState('')
  const [newCardLast4, setNewCardLast4]   = useState('')
  const [savingCard, setSavingCard]       = useState(false)

  // Live FX rates fetched from API — fallback to hardcoded if unavailable
  const [rateMap, setRateMap] = useState<Record<string, number>>(FALLBACK_FX)

  useEffect(() => {
    creditCardsApi.list().then(setCards).catch(() => {})
    fxRatesApi.getAll().then(rates => {
      const map: Record<string, number> = { TTD: 1 }
      rates.forEach(r => { map[r.currency] = parseFloat(r.rate_to_ttd) })
      setRateMap(map)
    }).catch(() => {}) // keep fallback on network error
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function pickReceipt() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to photograph receipts.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    })
    if (!result.canceled && result.assets[0]) setReceiptUri(result.assets[0].uri)
  }

  async function pickReceiptFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required to attach receipts.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    })
    if (!result.canceled && result.assets[0]) setReceiptUri(result.assets[0].uri)
  }

  async function handleAddCard() {
    if (!newCardName.trim()) { Alert.alert('Required', 'Card name is required.'); return }
    if (newCardLast4 && !/^\d{4}$/.test(newCardLast4)) {
      Alert.alert('Invalid', 'Last 4 digits must be exactly 4 numbers.')
      return
    }
    setSavingCard(true)
    try {
      const card = await creditCardsApi.create({
        card_name: newCardName.trim(),
        last_four: newCardLast4 || undefined,
      })
      const updated = [...cards, card]
      setCards(updated)
      setSelectedCardId(card.id)
      setNewCardName('')
      setNewCardLast4('')
      setAddingCard(false)
      setActivePicker(null)
    } catch {
      Alert.alert('Error', 'Could not save card.')
    } finally {
      setSavingCard(false)
    }
  }

  async function handleSave() {
    const numAmount = parseFloat(amount)
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Validation', 'Please enter a valid amount.')
      return
    }
    if (!description.trim()) {
      Alert.alert('Validation', 'Description is required.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      Alert.alert('Validation', 'Date must be YYYY-MM-DD.')
      return
    }

    setSaving(true)
    try {
      const expense = await expensesApi.create({
        owner_entity_id: entityId,
        expense_date:    expenseDate,
        description:     description.trim(),
        payee_name:      payee.trim() || undefined,
        amount:          numAmount,
        currency,
        amount_ttd:      toTTD(numAmount, currency, rateMap),
        payment_method:  paymentMethod,
        category,
        card_id:         (paymentMethod === 'CREDIT_CARD' || paymentMethod === 'DEBIT_CARD') ? selectedCardId ?? undefined : undefined,
        notes:           note.trim() || undefined,
        idempotency_key: randomKey(),
      })

      if (receiptUri) {
        const form = new FormData()
        form.append('receipt', {
          uri: receiptUri, name: 'receipt.jpg', type: 'image/jpeg',
        } as unknown as Blob)
        await expensesApi.uploadReceipt(expense.id, form)
      }

      await expensesApi.submit(expense.id)

      Alert.alert('Saved', 'Expense submitted successfully.', [{
        text: 'OK',
        onPress: () => {
          setAmount('')
          setDescription('')
          setPayee('')
          setNote('')
          setReceiptUri(null)
          setSelectedCardId(null)
          setExpenseDate(new Date().toISOString().slice(0, 10))
        },
      }])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      Alert.alert('Error', msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    await logout()
    router.replace('/login')
  }

  // ── Picker sheet ───────────────────────────────────────────────────────────

  function PickerSheet() {
    if (!activePicker) return null

    // Add-card inline form
    if (activePicker === 'card' && addingCard) {
      return (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Add New Card</Text>
            <TextInput
              style={styles.pickerInput}
              placeholder="Card name (e.g. Scotiabank Visa)"
              placeholderTextColor="#475569"
              value={newCardName}
              onChangeText={setNewCardName}
            />
            <TextInput
              style={styles.pickerInput}
              placeholder="Last 4 digits (optional)"
              placeholderTextColor="#475569"
              value={newCardLast4}
              onChangeText={setNewCardLast4}
              keyboardType="number-pad"
              maxLength={4}
            />
            <TouchableOpacity
              style={[styles.addCardSave, savingCard && { opacity: 0.6 }]}
              onPress={handleAddCard}
              disabled={savingCard}
            >
              {savingCard
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.addCardSaveText}>Save Card</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickerCancel} onPress={() => { setAddingCard(false); setActivePicker(null) }}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )
    }

    type Option = { label: string; value: string }
    let options: Option[] = []
    let current = ''
    let onSelect: (v: string) => void = () => {}
    let extra: React.ReactNode = null

    if (activePicker === 'currency') {
      options  = CURRENCIES.map(c => ({ label: c, value: c }))
      current  = currency
      onSelect = v => { setCurrency(v as Currency); setActivePicker(null) }
    } else if (activePicker === 'category') {
      options  = CATEGORIES.map(c => ({ label: CATEGORY_LABELS[c], value: c }))
      current  = category
      onSelect = v => { setCategory(v as ExpenseCategory); setActivePicker(null) }
    } else if (activePicker === 'entity') {
      options  = ENTITY_OPTIONS.map(e => ({ label: e.name, value: e.id }))
      current  = entityId
      onSelect = v => { setEntityId(v); setActivePicker(null) }
    } else if (activePicker === 'paymentMethod') {
      options  = PAYMENT_METHODS.map(p => ({ label: PAYMENT_METHOD_LABELS[p], value: p }))
      current  = paymentMethod
      onSelect = v => {
        setPaymentMethod(v as PaymentMethod)
        if (v !== 'CREDIT_CARD' && v !== 'DEBIT_CARD') setSelectedCardId(null)
        setActivePicker(null)
      }
    } else if (activePicker === 'card') {
      options  = [
        { label: 'No card', value: '' },
        ...cards.map(c => ({ label: cardLabel(c), value: c.id })),
      ]
      current  = selectedCardId ?? ''
      onSelect = v => { setSelectedCardId(v || null); setActivePicker(null) }
      extra = (
        <TouchableOpacity
          style={styles.addCardBtn}
          onPress={() => setAddingCard(true)}
        >
          <Text style={styles.addCardBtnText}>+ Add New Card</Text>
        </TouchableOpacity>
      )
    }

    return (
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerSheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {options.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.pickerOption, opt.value === current && styles.pickerOptionActive]}
                onPress={() => onSelect(opt.value)}
              >
                <Text style={[styles.pickerOptionText, opt.value === current && styles.pickerOptionTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
            {extra}
          </ScrollView>
          <TouchableOpacity style={styles.pickerCancel} onPress={() => setActivePicker(null)}>
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const entityName   = ENTITY_OPTIONS.find(e => e.id === entityId)?.name ?? ''
  const selectedCard = cards.find(c => c.id === selectedCardId)

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <Text style={styles.title}>New Expense</Text>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <TouchableOpacity onPress={() => router.push('/expenses')}>
              <Text style={styles.logoutText}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout}>
              <Text style={styles.logoutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Amount + Currency */}
        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountRow}>
          <TouchableOpacity style={styles.currencyPill} onPress={() => setActivePicker('currency')}>
            <Text style={styles.currencyText}>{currency} ▾</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor="#475569"
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
        </View>
        {amount && !isNaN(parseFloat(amount)) && currency !== 'TTD' && (
          <Text style={styles.hint}>
            ≈ TTD {toTTD(parseFloat(amount), currency, rateMap).toLocaleString('en-TT', { minimumFractionDigits: 2 })}
          </Text>
        )}

        {/* Description */}
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="What was this expense for?"
          placeholderTextColor="#475569"
          returnKeyType="next"
        />

        {/* Payee */}
        <Text style={styles.label}>Payee (optional)</Text>
        <TextInput
          style={styles.input}
          value={payee}
          onChangeText={setPayee}
          placeholder="Who was paid?"
          placeholderTextColor="#475569"
          returnKeyType="next"
        />

        {/* Category */}
        <Text style={styles.label}>Category</Text>
        <TouchableOpacity style={styles.select} onPress={() => setActivePicker('category')}>
          <Text style={styles.selectText}>{CATEGORY_LABELS[category]}</Text>
          <Text style={styles.chevron}>▾</Text>
        </TouchableOpacity>

        {/* Entity */}
        <Text style={styles.label}>Entity</Text>
        <TouchableOpacity style={styles.select} onPress={() => setActivePicker('entity')}>
          <Text style={styles.selectText}>{entityName}</Text>
          <Text style={styles.chevron}>▾</Text>
        </TouchableOpacity>

        {/* Payment Method */}
        <Text style={styles.label}>Payment Method</Text>
        <TouchableOpacity style={styles.select} onPress={() => setActivePicker('paymentMethod')}>
          <Text style={styles.selectText}>{PAYMENT_METHOD_LABELS[paymentMethod]}</Text>
          <Text style={styles.chevron}>▾</Text>
        </TouchableOpacity>

        {/* Card — shown for Credit Card and Debit Card */}
        {(paymentMethod === 'CREDIT_CARD' || paymentMethod === 'DEBIT_CARD') && (
          <>
            <Text style={styles.label}>Card</Text>
            <TouchableOpacity
              style={[styles.select, !selectedCardId && styles.selectPlaceholder]}
              onPress={() => { setAddingCard(false); setActivePicker('card') }}
            >
              <Text style={[styles.selectText, !selectedCardId && styles.placeholderText]}>
                {selectedCard ? cardLabel(selectedCard) : 'Select card...'}
              </Text>
              <Text style={styles.chevron}>▾</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Date */}
        <Text style={styles.label}>Date</Text>
        <TextInput
          style={styles.input}
          value={expenseDate}
          onChangeText={setExpenseDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#475569"
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          maxLength={10}
        />

        {/* Note */}
        <Text style={styles.label}>Note (optional)</Text>
        <TextInput
          style={[styles.input, styles.noteInput]}
          value={note}
          onChangeText={setNote}
          placeholder="Additional details..."
          placeholderTextColor="#475569"
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        {/* Receipt */}
        <Text style={styles.label}>Receipt</Text>
        {receiptUri ? (
          <View style={styles.receiptPreview}>
            <Image source={{ uri: receiptUri }} style={styles.receiptImage} resizeMode="cover" />
            <TouchableOpacity style={styles.receiptRemove} onPress={() => setReceiptUri(null)}>
              <Text style={styles.receiptRemoveText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.receiptButtons}>
            <TouchableOpacity style={styles.receiptBtn} onPress={pickReceipt}>
              <Text style={styles.receiptBtnText}>📷  Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.receiptBtn} onPress={pickReceiptFromLibrary}>
              <Text style={styles.receiptBtnText}>🖼  Library</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Submit Expense</Text>}
        </TouchableOpacity>

      </ScrollView>

      {PickerSheet()}
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 20, paddingBottom: 48 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 28, marginTop: Platform.OS === 'ios' ? 48 : 16,
  },
  title:      { fontSize: 24, fontWeight: '700', color: '#f8fafc' },
  logoutText: { fontSize: 14, color: '#64748b' },

  label: { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginBottom: 6, marginTop: 16, letterSpacing: 0.5 },

  input: {
    backgroundColor: '#1e293b', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    color: '#f8fafc', fontSize: 16,
    borderWidth: 1, borderColor: '#334155',
  },
  noteInput: { minHeight: 80 },

  amountRow:   { flexDirection: 'row', gap: 10 },
  currencyPill: {
    backgroundColor: '#1e293b', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#334155', justifyContent: 'center',
  },
  currencyText: { color: '#38bdf8', fontWeight: '700', fontSize: 16 },
  amountInput: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    color: '#f8fafc', fontSize: 22, fontWeight: '600',
    borderWidth: 1, borderColor: '#334155',
  },
  hint: { fontSize: 12, color: '#64748b', marginTop: 4 },

  select: {
    backgroundColor: '#1e293b', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#334155',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  selectPlaceholder: { borderColor: '#1e3a5f' },
  selectText:        { color: '#f8fafc', fontSize: 16 },
  placeholderText:   { color: '#475569' },
  chevron:           { color: '#64748b', fontSize: 14 },

  receiptButtons: { flexDirection: 'row', gap: 10 },
  receiptBtn: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 10,
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#334155', borderStyle: 'dashed',
  },
  receiptBtnText:    { color: '#94a3b8', fontSize: 15 },
  receiptPreview:    { alignItems: 'center', gap: 8 },
  receiptImage:      { width: '100%', height: 180, borderRadius: 10 },
  receiptRemove:     { paddingVertical: 6 },
  receiptRemoveText: { color: '#ef4444', fontSize: 14 },

  saveBtn:         { marginTop: 32, backgroundColor: '#3b82f6', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText:     { color: '#fff', fontSize: 17, fontWeight: '700' },

  pickerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '65%', paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  pickerTitle:  { color: '#f8fafc', fontSize: 16, fontWeight: '700', textAlign: 'center', paddingVertical: 12 },
  pickerOption: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  pickerOptionActive:     { backgroundColor: '#172554' },
  pickerOptionText:       { color: '#cbd5e1', fontSize: 16 },
  pickerOptionTextActive: { color: '#60a5fa', fontWeight: '600' },
  pickerCancel: {
    marginHorizontal: 20, marginTop: 8, paddingVertical: 12,
    alignItems: 'center', backgroundColor: '#334155', borderRadius: 10,
  },
  pickerCancelText: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },

  addCardBtn:     { paddingHorizontal: 20, paddingVertical: 14 },
  addCardBtnText: { color: '#38bdf8', fontSize: 16, fontWeight: '600' },

  pickerInput: {
    backgroundColor: '#0f172a', borderRadius: 8,
    marginHorizontal: 20, marginVertical: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    color: '#f8fafc', fontSize: 16,
    borderWidth: 1, borderColor: '#334155',
  },
  addCardSave: {
    marginHorizontal: 20, marginTop: 8, paddingVertical: 12,
    alignItems: 'center', backgroundColor: '#3b82f6', borderRadius: 10,
  },
  addCardSaveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
