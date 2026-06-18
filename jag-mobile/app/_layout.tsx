import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { isAuthenticated } from '../src/auth/keycloak'

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  // Re-check on every navigation so post-login token is picked up immediately.
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

  return <Stack screenOptions={{ headerShown: false }} />
}
