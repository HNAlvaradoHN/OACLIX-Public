export type DirectFirstCoverageMode = 'all-direct' | 'mixed' | 'cloud-only' | 'unavailable'

export type DirectFirstCoverageDecision = {
  mode: DirectFirstCoverageMode
  requiredDeviceIds: string[]
  directDeviceIds: string[]
  cloudDeviceIds: string[]
  missingDeviceIds: string[]
}

function unique(values: Iterable<string>) {
  return Array.from(new Set(values))
}

export function decideDirectFirstCoverage({
  requiredDeviceIds,
  directDeviceIds,
  cloudAvailable,
  cloudFallbackAllowed,
}: {
  requiredDeviceIds: Iterable<string>
  directDeviceIds: Iterable<string>
  cloudAvailable: boolean
  cloudFallbackAllowed: boolean
}): DirectFirstCoverageDecision {
  const required = unique(requiredDeviceIds)
  const directSet = new Set(directDeviceIds)
  const direct = required.filter((deviceId) => directSet.has(deviceId))
  const notDirect = required.filter((deviceId) => !directSet.has(deviceId))

  if (notDirect.length === 0) {
    return {
      mode: 'all-direct',
      requiredDeviceIds: required,
      directDeviceIds: direct,
      cloudDeviceIds: [],
      missingDeviceIds: [],
    }
  }

  if (cloudAvailable && cloudFallbackAllowed) {
    return {
      mode: direct.length > 0 ? 'mixed' : 'cloud-only',
      requiredDeviceIds: required,
      directDeviceIds: direct,
      cloudDeviceIds: notDirect,
      missingDeviceIds: [],
    }
  }

  return {
    mode: 'unavailable',
    requiredDeviceIds: required,
    directDeviceIds: direct,
    cloudDeviceIds: [],
    missingDeviceIds: notDirect,
  }
}
