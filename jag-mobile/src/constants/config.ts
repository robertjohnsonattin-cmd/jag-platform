export const JAG_API_BASE    = 'https://api.jagcorporate.com/api/v1'
export const JAG_AUTH_ISSUER = 'https://auth.jagcorporate.com/realms/jag'

// Mobile-specific public Keycloak client (no client secret — PKCE only).
//
// One-time Keycloak setup (admin console → Clients → Create client):
//   Client ID:              jag-mobile
//   Client authentication:  OFF  (public client)
//   Standard flow:          ON
//   Direct access grants:   OFF
//   Valid redirect URIs:    jagmobile://auth/callback
//   Valid post-logout URIs: jagmobile://
//
// After creating the client, add the existing "jag_user_id" and
// "jag_tenant_id" protocol mappers from jag-api client to jag-mobile.
export const KC_CLIENT_ID                 = 'jag-mobile'
export const KC_REDIRECT_URI              = 'jagauth://callback'
export const KC_POST_LOGOUT_REDIRECT_URI  = 'jagauth://'
