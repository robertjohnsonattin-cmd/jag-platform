import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { isAuthenticated } from '../src/auth/keycloak'
import notifee, { EventType } from '@notifee/react-native'
import { showQuickEntryNotification, registerForegroundHandler } from '../src/services/quickNotification'

// Handle notification action when app is launched from background/closed
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'new-expense') {
    // App will launch via launchActivity: 'default' — deep link handled in useEffect below
  }
})

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

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
    }
  }, [checking, authed, segments])

  // Show persistent notification and wire up foreground handler
  useEffect(() => {
    if (!authed) return
    showQuickEntryNotification()
    const unsub = registerForegroundHandler(() => router.push('/expense-form'))
    return unsub
  }, [authed])

  // Handle app opened via notification action (background → foreground)
  useEffect(() => {
    notifee.getInitialNotification().then(n => {
      if (n?.pressAction?.id === 'new-expense' && authed) {
        router.push('/expense-form')
      }
    })
  }, [authed])

  return <Stack screenOptions={{ headerShown: false }} />
}
