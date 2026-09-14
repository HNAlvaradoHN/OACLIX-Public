import type { DirectFirstCoverageDecision } from './directFirstCoverage'

export type DirectFirstCloudCopyGateSnapshot = {
  version: 1
  cloudCopyCommitted: boolean
}

export class DirectFirstCloudCopyGate {
  private cloudCopyCommitted = false

  static restore(snapshot: DirectFirstCloudCopyGateSnapshot) {
    if (snapshot.version !== 1 || typeof snapshot.cloudCopyCommitted !== 'boolean') {
      throw new Error('Snapshot de copia cloud inválido')
    }
    const gate = new DirectFirstCloudCopyGate()
    gate.cloudCopyCommitted = snapshot.cloudCopyCommitted
    return gate
  }

  async ensureRequiredCloudCopy(
    coverage: DirectFirstCoverageDecision,
    persistCloudCopy: () => Promise<void>,
  ) {
    if (coverage.mode === 'unavailable') throw new Error('Cobertura direct-first incompleta')
    if (coverage.cloudDeviceIds.length === 0) return false
    if (this.cloudCopyCommitted) return false

    await persistCloudCopy()
    this.cloudCopyCommitted = true
    return true
  }

  hasCommittedCloudCopy() {
    return this.cloudCopyCommitted
  }

  snapshot(): DirectFirstCloudCopyGateSnapshot {
    return {
      version: 1,
      cloudCopyCommitted: this.cloudCopyCommitted,
    }
  }
}
