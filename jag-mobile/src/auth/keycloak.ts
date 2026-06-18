import {
  authorize,
  refresh,
  revoke,
  type AuthorizeResult,
  type RefreshResult,
} from 'react-native-app-auth'
import * as SecureStore from 'expo-secure-store'
import {
  JAG_AUTH_ISSUER,
  KC_CLIENT_ID,
  KC_REDIRECT_URI,
  KC_POST_LOGOUT_REDIRECT_URI,
} from '../constants/config'

const OIDC_CONFIG = {
  issuer:      JAG_AUTH_ISSUER,
  clientId:    KC_CLIENT_ID,
  redirectUrl: KC_REDIRECT_URI,
  scopes:      ['openid', 'profile', 'email'],
  usePKCE:     true,
  additionalParameters: {},
  serviceConfiguration: {
    // Explicit endpoints avoids a discovery round-trip on cold launch.
    authorizationEndpoint: `${JAG_AUTH_ISSUER}/protocol/openid-connect/auth`,
    tokenEndpoint:         `${JAG_AUTH_ISSUER}/protocol/openid-connect/token`,
    revocationEndpoint:    `${JAG_AUTH_ISSUER}/protocol/openid-connect/revoke`,
    endSessionEndpoint:    `${JAG_AUTH_ISSUER}/protocol/openid-connect/logout?post_logout_redirect_uri=${encodeURIComponent(KC_POST_LOGOUT_REDIRECT_URI)}&client_id=${KC_CLIENT_ID}`,
  },
}

const KEY_ACCESS_TOKEN  = 'jag_access_token'
const KEY_REFRESH_TOKEN = 'jag_refresh_token'
const KEY_EXPIRY        = 'jag_token_expiry'

// ── Public API ────────────────────────────────────────────────────────────────

export async function login(): Promise<void> {
  const result = await authorize(OIDC_CONFIG)
  await storeTokens(result)
}

export async function logout(): Promise<void> {
  const token = await SecureStore.getItemAsync(KEY_REFRESH_TOKEN)
  if (token) {
    try {
      await revoke(OIDC_CONFIG, { tokenToRevoke: token, sendClientId: true })
    } catch {
      // best-effort revocation; clear locally regardless
    }
  }
  await clearTokens()
}

/**
 * Returns a valid access token, refreshing silently if within 30 s of expiry.
 * Returns null if the session is fully expired or was never established.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const [token, expiry, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(KEY_ACCESS_TOKEN),
    SecureStore.getItemAsync(KEY_EXPIRY),
    SecureStore.getItemAsync(KEY_REFRESH_TOKEN),
  ])

  if (!token || !expiry || !refreshToken) return null

  // Still valid with 30-second buffer
  if (Date.now() < new Date(expiry).getTime() - 30_000) return token

  // Attempt silent refresh
  try {
    const result = await refresh(OIDC_CONFIG, { refreshToken })
    await storeTokens(result)
    return result.accessToken
  } catch {
    await clearTokens()
    return null
  }
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getValidAccessToken()) !== null
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function storeTokens(result: AuthorizeResult | RefreshResult): Promise<void> {
  const ops: Promise<void>[] = [
    SecureStore.setItemAsync(KEY_ACCESS_TOKEN, result.accessToken),
    SecureStore.setItemAsync(KEY_EXPIRY, result.accessTokenExpirationDate),
  ]
  // Keycloak only returns a new refresh token when rotation is enabled;
  // keep the existing one if the server didn't issue a replacement.
  if (result.refreshToken) {
    ops.push(SecureStore.setItemAsync(KEY_REFRESH_TOKEN, result.refreshToken))
  }
  await Promise.all(ops)
}

async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN),
    SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN),
    SecureStore.deleteItemAsync(KEY_EXPIRY),
  ])
}
