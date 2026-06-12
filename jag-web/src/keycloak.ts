import Keycloak from 'keycloak-js'

const keycloak = new Keycloak({
  url: 'https://auth.jagcorporate.com',
  realm: 'jag',
  clientId: 'jag-web',
})

export default keycloak
