import { validateUpdateHealthEndpoint } from '../src/shared/update-health-endpoint.mjs'

const endpoint = validateUpdateHealthEndpoint(
  process.env.AIDE_UPDATE_HEALTH_ENDPOINT ?? null,
)
if (!endpoint) {
  console.error(
    'Tagged releases require a protected custom HTTPS AIDE_UPDATE_HEALTH_ENDPOINT.',
  )
  process.exit(1)
}
