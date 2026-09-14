import { OACLIX_BUILD_VERSION } from '../pwa/appVersion'

export function BuildVersionBadge() {
  return (
    <div className="build-version-badge" aria-label={`Versión ${OACLIX_BUILD_VERSION}`}>
      {OACLIX_BUILD_VERSION}
    </div>
  )
}
