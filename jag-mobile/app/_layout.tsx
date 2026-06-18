import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { isAuthenticated } from '../src/auth/keycloak'
import notifee, { EventType } from '@notifee/react-native'
import { showQuickEntryNotification, registerForegroundHandler } from '../src/services/quickNotification'

notifee.onBackgroundEvent(async () => {})

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  // Show notification as soon as a refresh token exists — no need to wait for full auth
  useEffect(() => {
    SecureStore.getItemAsync('jag_refresh_token').then(token => {
      if (token) showQuickEntryNotification()
    })
    const unsub = registerForegroundHandler(() => router.push('/expense-form'))
    return unsub
  }, [])

  useEffect(() => {
    setChecking(true)
    isAuthenticated().then(ok => {
      setAuthed(ok)
      setChecking(false)
    })
  }, [segments])

  useEffect(() => {
    if (checking) return
    const inAuthGroup = segments[0] === 'login'
    if (!authed && !inAuthGroup) {
      router.replace('/login')
    } else if (authed && inAuthGroup) {
      router.replace('/expense-form')
      showQuickEntryNotification()  // ensure notification is up after fresh login
    }
  }, [checking, authed, segments])

  // Handle app opened via notification action
  useEffect(() => {
    notifee.getInitialNotification().then(n => {
      if (n?.pressAction?.id === 'new-expense') {
        if (authed) router.push('/expense-form')
      }
    })
  }, [authed])

  return <Stack screenOptions={{ headerShown: false }} />
}
