import type { DeviceRouteStatus } from '../realtime/lanStatus'
import {
  decideGeneralExplicitDestination,
  requireGeneralExplicitDestination,
  type GeneralExplicitDestinationPlan,
} from './generalExplicitDestination.ts'

const MAX_GENERAL_TEXT_LENGTH = 8_000

export type GeneralExplicitSendDependencies = {
  getRouteStatus: (roomId: string, targetDeviceId: string) => DeviceRouteStatus
  requireAuthorizedTarget: (roomId: string, targetDeviceId: string) => Promise<void>
  sendDirect: (roomId: string, targetDeviceId: string, text: string) => Promise<void>
  sendCloud: (roomId: string, targetDeviceId: string, text: string) => Promise<void>
}

export type GeneralExplicitSendResult = GeneralExplicitDestinationPlan & {
  textLength: number
}

function validGeneralText(text: string) {
  return text.length > 0
    && text.length <= MAX_GENERAL_TEXT_LENGTH
    && text.trim().length > 0
}

export async function sendGeneralTextExplicitly(
  roomId: string,
  targetDeviceId: string,
  text: string,
  dependencies: GeneralExplicitSendDependencies,
): Promise<GeneralExplicitSendResult> {
  if (!roomId.startsWith('room_')) throw new Error('General no está disponible')
  if (!validGeneralText(text)) throw new Error('Texto de General inválido')

  await dependencies.requireAuthorizedTarget(roomId, targetDeviceId)

  const plan = requireGeneralExplicitDestination(
    decideGeneralExplicitDestination(
      targetDeviceId,
      dependencies.getRouteStatus(roomId, targetDeviceId),
    ),
  )

  if (plan.route === 'direct') {
    await dependencies.sendDirect(roomId, plan.targetDeviceId, text)
  } else {
    await dependencies.sendCloud(roomId, plan.targetDeviceId, text)
  }

  return {
    ...plan,
    textLength: text.length,
  }
}
