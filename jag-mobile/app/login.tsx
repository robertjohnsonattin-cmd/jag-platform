import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import { login, getValidAccessToken } from '../src/auth/keycloak'

export default function LoginScreen() {
  const router = useRouter()
  const [loading, setLoading]       = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioLoading, setBioLoading] = useState(false)

  useEffect(() => {
    async function checkBiometric() {
      try {
        const refreshToken = await SecureStore.getItemAsync('jag_refresh_token')
        if (!refreshToken) return
        const [hasHw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ])
        if (hasHw && enrolled) {
          setBioAvailable(true)
          promptFingerprint()
        }
      } catch {}
    }
    checkBiometric()
  }, [])

  async function promptFingerprint() {
    setBioLoading(true)
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify identity to access JAG',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      })
      if (result.success) {
        const token = await getValidAccessToken()
        if (token) {
          router.replace('/expense-form')
        } else {
          Alert.alert('Session expired', 'Please sign in with Keycloak to continue.')
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Biometric failed'
      Alert.alert('Biometric error', msg)
    } finally {
      setBioLoading(false)
    }
  }

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

  const busy = loading || bioLoading

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>JAG</Text>
      <Text style={styles.subtitle}>Integrated Business Platform</Text>

      {bioAvailable && (
        <TouchableOpacity
          style={[styles.button, styles.bioButton, busy && styles.buttonDisabled]}
          onPress={promptFingerprint}
          disabled={busy}
          activeOpacity={0.8}
        >
          {bioLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Use Fingerprint</Text>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.button, bioAvailable && styles.kcButtonSecondary, busy && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={busy}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color={bioAvailable ? '#94a3b8' : '#fff'} />
        ) : (
          <Text style={[styles.buttonText, bioAvailable && styles.kcButtonSecondaryText]}>
            Sign in with Keycloak
          </Text>
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
  bioButton: {
    backgroundColor: '#059669',
  },
  kcButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#334155',
  },
  kcButtonSecondaryText: {
    color: '#64748b',
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
