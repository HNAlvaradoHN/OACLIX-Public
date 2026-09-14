import { DirectFirstPrepCoordinator } from '../transport/directFirstPrepCoordinator'
import { readDirectFirstState, writeDirectFirstState } from './directFirstStateStore'

export function loadBrowserDirectFirstPrepCoordinator(roomId: string, localDeviceId: string) {
  return DirectFirstPrepCoordinator.load(roomId, localDeviceId, {
    read: readDirectFirstState,
    write: writeDirectFirstState,
  })
}
