import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import { isAuthenticated } from '../src/auth/keycloak'
import notifee from '@notifee/react-native'
import { showQuickEntryNotification, registerForegroundHandler } from '../src/services/quickNotification'
import { syncHealthConnect } from '../src/services/healthConnect'

notifee.onBackgroundEvent(async () => {})

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const rootNavigationState = useRootNavigationState()
  const [authed, setAuthed]     = useState(false)
  const [checking, setChecking] = useState(true)
  const [locked, setLocked]     = useState(true)   // biometric gate
  const [bioReady, setBioReady] = useState(false)  // biometrics available + enrolled
  const [bioLoading, setBioLoading] = useState(false)

  // Show notification as soon as a refresh token exists
  useEffect(() => {
    SecureStore.getItemAsync('jag_refresh_token').then(token => {
      if (token) showQuickEntryNotification()
    })
    const unsub = registerForegroundHandler(() => router.push('/expense-form'))
    return unsub
  }, [])

  // Auth check on every navigation
  useEffect(() => {
    setChecking(true)
    isAuthenticated().then(ok => {
      setAuthed(ok)
      setChecking(false)
    })
  }, [segments])

  // Route guard
  useEffect(() => {
    // Hooks always run regardless of which JSX branch this component returns —
    // while the lock screen below is showing, <Stack /> (the Root Layout's own
    // navigator) has never actually mounted yet, and even just after it mounts
    // the navigator needs a moment to actually attach. rootNavigationState.key
    // is expo-router's own readiness signal (undefined until attached) — more
    // reliable than inferring readiness from locked/bioReady alone. Calling
    // router.replace() before this is ready throws "Attempted to navigate
    // before mounting the Root Layout component", which login.tsx's biometric
    // flow was catching and mislabeling as a "Biometric error" (the fingerprint
    // auth itself was always fine).
    if (locked && bioReady) return
    if (!rootNavigationState?.key) return
    if (checking) return
    const inAuthGroup = segments[0] === 'login'
    if (!authed && !inAuthGroup) {
      router.replace('/login')
    } else if (authed && inAuthGroup) {
      router.replace('/expense-form')
      showQuickEntryNotification()
    }
  }, [checking, authed, segments, locked, bioReady, rootNavigationState?.key])

  // Health Connect sync — fire once per cold start once we know the user is
  // authenticated. Non-blocking, silently no-ops if Health Connect / perms aren't
  // available (see syncHealthConnect's own try/catch). Delayed because Android
  // only allows one permission-request dialog in flight at a time — the notifee
  // notification-permission request (fired from the refresh-token effect above,
  // near-simultaneously on cold start) would otherwise win the race and silently
  // starve this one (logged as "Can request only one set of permissions at a
  // time", no crash, no dialog ever shown for Health Connect).
  useEffect(() => {
    if (!authed) return
    const timer = setTimeout(() => { syncHealthConnect() }, 4000)
    return () => clearTimeout(timer)
  }, [authed])

  // Handle app opened via notification action
  useEffect(() => {
    notifee.getInitialNotification().then(n => {
      if (n?.pressAction?.id === 'new-expense') {
        if (authed && !locked) router.push('/expense-form')
      }
    })
  }, [authed, locked])

  // Biometric gate — runs once on cold start
  useEffect(() => {
    async function checkAndPrompt() {
      try {
        const [hasHw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ])
        if (!hasHw || !enrolled) {
          setLocked(false)
          return
        }
        setBioReady(true)
        await promptBiometric()
      } catch {
        setLocked(false)
      }
    }
    checkAndPrompt()
  }, [])

  async function promptBiometric() {
    setBioLoading(true)
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify identity to access JAG',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      })
      if (result.success) setLocked(false)
    } finally {
      setBioLoading(false)
    }
  }

  // Show biometric lock screen over everything while locked and authenticated
  if (locked && bioReady) {
    return (
      <View style={styles.lockScreen}>
        <Text style={styles.lockLogo}>JAG</Text>
        <Text style={styles.lockSubtitle}>Tap to unlock</Text>
        <TouchableOpacity
          style={[styles.lockBtn, bioLoading && styles.lockBtnDisabled]}
          onPress={promptBiometric}
          disabled={bioLoading}
          activeOpacity={0.8}
        >
          {bioLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.lockBtnText}>Use Fingerprint</Text>}
        </TouchableOpacity>
      </View>
    )
  }

  return <Stack screenOptions={{ headerShown: false }} />
}

const styles = StyleSheet.create({
  lockScreen: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  lockLogo: {
    fontSize: 56,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 8,
    marginBottom: 8,
  },
  lockSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 48,
    letterSpacing: 1,
  },
  lockBtn: {
    backgroundColor: '#059669',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 240,
    alignItems: 'center',
  },
  lockBtnDisabled: { opacity: 0.6 },
  lockBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
