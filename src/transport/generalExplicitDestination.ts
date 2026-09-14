import type { DeviceRouteStatus } from '../realtime/lanStatus'

export type GeneralExplicitRoute = 'direct' | 'cloud'

export type GeneralExplicitDestinationPlan = {
  targetDeviceId: string
  route: GeneralExplicitRoute
}

export type GeneralExplicitDestinationUnavailable = {
  targetDeviceId: string
  route: null
  reason: 'checking' | 'offline'
}

export type GeneralExplicitDestinationDecision =
  | GeneralExplicitDestinationPlan
  | GeneralExplicitDestinationUnavailable

export function decideGeneralExplicitDestination(
  targetDeviceId: string,
  routeStatus: DeviceRouteStatus,
): GeneralExplicitDestinationDecision {
  if (!targetDeviceId.startsWith('dev_')) {
    throw new Error('Destino de General inválido')
  }

  if (routeStatus === 'direct') {
    return { targetDeviceId, route: 'direct' }
  }

  if (routeStatus === 'cloud') {
    return { targetDeviceId, route: 'cloud' }
  }

  return {
    targetDeviceId,
    route: null,
    reason: routeStatus === 'offline' ? 'offline' : 'checking',
  }
}

export function requireGeneralExplicitDestination(
  decision: GeneralExplicitDestinationDecision,
): GeneralExplicitDestinationPlan {
  if (decision.route) return decision
  throw new Error(
    decision.reason === 'offline'
      ? 'Ese dispositivo está offline'
      : 'Todavía se está comprobando la ruta al dispositivo',
  )
}
