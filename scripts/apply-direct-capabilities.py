from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


Path('src/realtime/directCapabilities.ts').write_text("""export const DIRECT_CAPABILITIES = ['room-core', 'image-direct'] as const

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
""")

p = 'src/realtime/lanPeerManager.ts'
replace_once(p,
    "import { publishCloudSyncHint } from './cloudSyncHintBus'\n",
    "import { publishCloudSyncHint } from './cloudSyncHintBus'\nimport {\n  localDirectCapabilities,\n  resolveRemoteDirectCapabilities,\n  validDirectCapabilities,\n  type DirectCapability,\n} from './directCapabilities'\n",
)
replace_once(p,
    "  probeToken: string | null\n  validated: boolean\n",
    "  probeToken: string | null\n  validated: boolean\n  capabilities: Set<DirectCapability>\n",
)
replace_once(p,
    "  | { type: 'probe'; token: string }\n  | { type: 'probe-ack'; token: string }\n",
    "  | { type: 'probe'; token: string; capabilities?: DirectCapability[] }\n  | { type: 'probe-ack'; token: string; capabilities?: DirectCapability[] }\n",
)
replace_once(p,
    "  const message = value as { type?: unknown; token?: unknown; change?: unknown; ack?: unknown; transfer?: unknown }\n",
    "  const message = value as {\n    type?: unknown\n    token?: unknown\n    change?: unknown\n    ack?: unknown\n    transfer?: unknown\n    capabilities?: unknown\n  }\n",
)
replace_once(p,
    "  return (message.type === 'probe' || message.type === 'probe-ack')\n    && typeof message.token === 'string'\n    && /^[a-f0-9]{24}$/.test(message.token)\n",
    "  return (message.type === 'probe' || message.type === 'probe-ack')\n    && typeof message.token === 'string'\n    && /^[a-f0-9]{24}$/.test(message.token)\n    && validDirectCapabilities(message.capabilities)\n",
)
replace_once(p,
    "  getValidatedPeerIds() {\n    return Array.from(this.peers.entries())\n      .filter(([, peer]) => peer.validated && peer.channel?.readyState === 'open')\n      .map(([deviceId]) => deviceId)\n  }\n",
    "  getValidatedPeerIds() {\n    return Array.from(this.peers.entries())\n      .filter(([, peer]) => (\n        peer.validated\n        && peer.channel?.readyState === 'open'\n        && peer.capabilities.has('room-core')\n      ))\n      .map(([deviceId]) => deviceId)\n  }\n\n  getImageDirectPeerIds() {\n    return Array.from(this.peers.entries())\n      .filter(([, peer]) => (\n        peer.validated\n        && peer.channel?.readyState === 'open'\n        && peer.capabilities.has('image-direct')\n      ))\n      .map(([deviceId]) => deviceId)\n  }\n",
)
replace_once(p,
    "      if (!peer.validated || peer.channel?.readyState !== 'open') continue\n      peer.channel.send(serialized)\n",
    "      if (\n        !peer.validated\n        || peer.channel?.readyState !== 'open'\n        || !peer.capabilities.has('room-core')\n      ) continue\n      peer.channel.send(serialized)\n",
)
replace_once(p,
    "    if (!peer?.validated || peer.channel?.readyState !== 'open') return false\n    peer.channel.send(JSON.stringify({ type: 'clipboard-change', change } satisfies DirectMessage))\n",
    "    if (\n      !peer?.validated\n      || peer.channel?.readyState !== 'open'\n      || !peer.capabilities.has('room-core')\n    ) return false\n    peer.channel.send(JSON.stringify({ type: 'clipboard-change', change } satisfies DirectMessage))\n",
)
replace_once(p,
    "    if (!peer?.validated || peer.channel?.readyState !== 'open') return false\n    peer.channel.send(JSON.stringify({ type: 'local-clipboard-transfer', transfer } satisfies DirectMessage))\n",
    "    if (\n      !peer?.validated\n      || peer.channel?.readyState !== 'open'\n      || !peer.capabilities.has('room-core')\n    ) return false\n    peer.channel.send(JSON.stringify({ type: 'local-clipboard-transfer', transfer } satisfies DirectMessage))\n",
)
replace_once(p,
    "    if (!peer?.validated || peer.channel?.readyState !== 'open') return false\n    peer.channel.send(JSON.stringify({ type: 'local-clipboard-transfer-ack', ack } satisfies DirectMessage))\n",
    "    if (\n      !peer?.validated\n      || peer.channel?.readyState !== 'open'\n      || !peer.capabilities.has('room-core')\n    ) return false\n    peer.channel.send(JSON.stringify({ type: 'local-clipboard-transfer-ack', ack } satisfies DirectMessage))\n",
)
replace_once(p,
    "    if (!peer?.validated || !channel || channel.readyState !== 'open') return false\n\n    this.sendingDirectImagePeers.add(remoteDeviceId)\n",
    "    if (\n      !peer?.validated\n      || !channel\n      || channel.readyState !== 'open'\n      || !peer.capabilities.has('image-direct')\n    ) return false\n\n    this.sendingDirectImagePeers.add(remoteDeviceId)\n",
)
replace_once(p,
    "    if (!peer?.validated || peer.channel?.readyState !== 'open') return false\n    peer.channel.send(JSON.stringify({ type: 'local-image-direct-ack', ack } satisfies DirectMessage))\n",
    "    if (\n      !peer?.validated\n      || peer.channel?.readyState !== 'open'\n      || !peer.capabilities.has('image-direct')\n    ) return false\n    peer.channel.send(JSON.stringify({ type: 'local-image-direct-ack', ack } satisfies DirectMessage))\n",
)
replace_once(p,
    "    if (!peer?.validated || peer.channel?.readyState !== 'open') return false\n    peer.channel.send(JSON.stringify({ type: 'direct-first-ack', ack } satisfies DirectMessage))\n",
    "    if (\n      !peer?.validated\n      || peer.channel?.readyState !== 'open'\n      || !peer.capabilities.has('room-core')\n    ) return false\n    peer.channel.send(JSON.stringify({ type: 'direct-first-ack', ack } satisfies DirectMessage))\n",
)
replace_once(p,
    "    if (!peer.validated || this.peers.get(remoteDeviceId) !== peer) return\n    const incoming = this.incomingDirectImages.get(remoteDeviceId)\n",
    "    if (\n      !peer.validated\n      || !peer.capabilities.has('image-direct')\n      || this.peers.get(remoteDeviceId) !== peer\n    ) return\n    const incoming = this.incomingDirectImages.get(remoteDeviceId)\n",
)
replace_once(p,
    "      validated: false,\n      sessionId,\n",
    "      validated: false,\n      capabilities: new Set(),\n      sessionId,\n",
)
replace_once(p,
    "    peer.channel = channel\n    channel.binaryType = 'arraybuffer'\n    peer.validated = false\n",
    "    peer.channel = channel\n    channel.binaryType = 'arraybuffer'\n    peer.validated = false\n    peer.capabilities = new Set()\n",
)
replace_once(p,
    "      channel.send(JSON.stringify({ type: 'probe', token } satisfies DirectMessage))\n",
    "      channel.send(JSON.stringify({\n        type: 'probe',\n        token,\n        capabilities: localDirectCapabilities(),\n      } satisfies DirectMessage))\n",
)
replace_once(p,
    "      if (message.type === 'probe') {\n        if (channel.readyState === 'open') {\n          channel.send(JSON.stringify({ type: 'probe-ack', token: message.token } satisfies DirectMessage))\n          this.publishDiagnostic(remoteDeviceId, 'probe-received')\n        }\n        return\n      }\n\n      if (message.type === 'probe-ack') {\n        if (message.token === peer.probeToken) {\n          peer.validated = true\n",
    "      if (message.type === 'probe') {\n        peer.capabilities = resolveRemoteDirectCapabilities(message.capabilities)\n        if (channel.readyState === 'open') {\n          channel.send(JSON.stringify({\n            type: 'probe-ack',\n            token: message.token,\n            capabilities: localDirectCapabilities(),\n          } satisfies DirectMessage))\n          this.publishDiagnostic(remoteDeviceId, 'probe-received')\n        }\n        return\n      }\n\n      if (message.type === 'probe-ack') {\n        if (message.token === peer.probeToken) {\n          peer.capabilities = resolveRemoteDirectCapabilities(message.capabilities)\n          peer.validated = true\n",
)
replace_once(p,
    "      if (message.type === 'local-clipboard-transfer') {\n        if (\n",
    "      if (message.type === 'local-clipboard-transfer') {\n        if (!peer.capabilities.has('room-core')) return\n        if (\n",
)
replace_once(p,
    "      if (message.type === 'local-clipboard-transfer-ack') {\n        if (\n",
    "      if (message.type === 'local-clipboard-transfer-ack') {\n        if (!peer.capabilities.has('room-core')) return\n        if (\n",
)
replace_once(p,
    "      if (message.type === 'local-image-direct-start') {\n        if (\n",
    "      if (message.type === 'local-image-direct-start') {\n        if (!peer.capabilities.has('image-direct')) return\n        if (\n",
)
replace_once(p,
    "      if (message.type === 'local-image-direct-ack') {\n        if (\n",
    "      if (message.type === 'local-image-direct-ack') {\n        if (!peer.capabilities.has('image-direct')) return\n        if (\n",
)
replace_once(p,
    "      if (message.type === 'direct-first-ack') {\n        if (message.ack.authorDeviceId !== this.ownDeviceId) return\n",
    "      if (message.type === 'direct-first-ack') {\n        if (!peer.capabilities.has('room-core')) return\n        if (message.ack.authorDeviceId !== this.ownDeviceId) return\n",
)

p = 'src/realtime/localImageDirectTransfer.ts'
replace_once(p,
    "export type LocalImageDirectSender = {\n  getValidatedPeerIds(): string[]\n",
    "export type LocalImageDirectSender = {\n  getImageDirectPeerIds(): string[]\n",
)

p = 'src/transport/localImageDirectTransport.ts'
replace_once(p,
    "  if (!sender || !sender.getValidatedPeerIds().includes(remoteDeviceId)) {\n",
    "  if (!sender || !sender.getImageDirectPeerIds().includes(remoteDeviceId)) {\n",
)

Path('tests/directCapabilities.test.ts').write_text("""import assert from 'node:assert/strict'
import test from 'node:test'

import {
  localDirectCapabilities,
  resolveRemoteDirectCapabilities,
  validDirectCapabilities,
} from '../src/realtime/directCapabilities.ts'

test('advertises room core and image Direct independently', () => {
  assert.deepEqual(localDirectCapabilities(), ['room-core', 'image-direct'])
})

test('legacy peer without capability field preserves current PWA interoperability', () => {
  const resolved = resolveRemoteDirectCapabilities(undefined)
  assert.equal(resolved.has('room-core'), true)
  assert.equal(resolved.has('image-direct'), true)
})

test('image-only peer cannot be mistaken for text/general Direct', () => {
  const resolved = resolveRemoteDirectCapabilities(['image-direct'])
  assert.equal(resolved.has('image-direct'), true)
  assert.equal(resolved.has('room-core'), false)
})

test('rejects unknown, duplicate, empty, or malformed capability declarations', () => {
  assert.equal(validDirectCapabilities(['room-core', 'unknown']), false)
  assert.equal(validDirectCapabilities(['image-direct', 'image-direct']), false)
  assert.equal(validDirectCapabilities([]), false)
  assert.equal(validDirectCapabilities('image-direct'), false)
})
""")
