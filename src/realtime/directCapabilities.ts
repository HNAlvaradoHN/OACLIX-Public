export const DIRECT_CAPABILITIES = ['room-core', 'image-direct'] as const

export type DirectCapability = typeof DIRECT_CAPABILITIES[number]

const DIRECT_CAPABILITY_SET = new Set<string>(DIRECT_CAPABILITIES)

export function localDirectCapabilities(): DirectCapability[] {
  return [...DIRECT_CAPABILITIES]
}

export function validDirectCapabilities(value: unknown): value is DirectCapability[] | undefined {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length === 0 || value.length > DIRECT_CAPABILITIES.length) return false
  if (!value.every((capability) => typeof capability === 'string' && DIRECT_CAPABILITY_SET.has(capability))) return false
  return new Set(value).size === value.length
}

export function resolveRemoteDirectCapabilities(value: unknown): Set<DirectCapability> {
  if (value === undefined) return new Set(DIRECT_CAPABILITIES)
  if (!validDirectCapabilities(value)) return new Set()
  return new Set(value)
}
