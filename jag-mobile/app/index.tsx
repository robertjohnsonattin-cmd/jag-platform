import { Redirect } from 'expo-router'

// Handles jagmobile:/// (bare scheme with no path).
// The root layout's auth check will redirect to the right screen.
export default function Index() {
  return <Redirect href="/login" />
}
