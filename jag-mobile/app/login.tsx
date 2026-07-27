import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native'
import { useRouter, useRootNavigationState } from 'expo-router'
import { getValidAccessToken, login } from '../src/auth/keycloak'

// Fingerprint verification already happened in _layout.tsx's app-level lock
// screen before this route is ever reachable — a second, independent biometric
// prompt here was redundant and, worse, was racing that lock screen's own
// re-render/navigation cycle (repeated fingerprint prompts, and a navigation
// call landing before the root navigator had attached — surfaced as a
// misleading "Biometric error" alert). This screen now only does a silent
// token check (no fingerprint) and falls back to the Keycloak button.
export default function LoginScreen() {
  const router = useRouter()
  const rootNavigationState = useRootNavigationState()
  const [loading, setLoading] = useState(false)
  const [wantsExpenseForm, setWantsExpenseForm] = useState(false)

  useEffect(() => {
    getValidAccessToken().then(token => {
      if (token) setWantsExpenseForm(true)
    }).catch(() => {})
  }, [])

  // useRootNavigationState().key is undefined until the root navigator has
  // actually attached — waiting on it (rather than guessing a delay) avoids
  // "Attempted to navigate before mounting the Root Layout component".
  useEffect(() => {
    if (wantsExpenseForm && rootNavigationState?.key) {
      router.replace('/expense-form')
    }
  }, [wantsExpenseForm, rootNavigationState?.key])

  async function handleLogin() {
    setLoading(true)
    try {
      await login()
      router.replace('/expense-form')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      Alert.alert('Login failed', msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>JAG</Text>
      <Text style={styles.subtitle}>Integrated Business Platform</Text>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign in with Keycloak</Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logo: {
    fontSize: 56,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 8,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 64,
    letterSpacing: 1,
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 240,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
