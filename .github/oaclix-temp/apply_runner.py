#!/usr/bin/env python3
from __future__ import annotations
import base64, hashlib, io, tarfile
from pathlib import Path

EXPECTED_OLD = {'android/app/src/main/java/app/oaclix/android/imageclipboard/ImageClipboardStore.kt': 'e3c34af63e21b8aee69d0a2f687ac2c261a52f69', 'android/app/src/main/java/app/oaclix/android/share/NativeDirectImageProtocol.kt': 'd20ee84be1ccdbee83e5eae52df37b4d43cd537b', 'android/app/src/main/java/app/oaclix/android/share/NativeImageDeviceRelayReceiver.kt': '229f495d9084e79c708e3d22083b118718d74983', 'android/app/src/test/java/app/oaclix/android/share/NativeDirectImageProtocolTest.kt': '109b01ad634a4a4725e8a11f58decdd7653c3a36', 'android/app/src/main/res/values/strings.xml': 'f23495626fd1cdce439d0ea7beb3f0368c30af0c'}
EXPECTED_NEW = {'android/app/src/main/java/app/oaclix/android/imageclipboard/ImageClipboardStore.kt': '606a0e2c26e42c5a1d1f6782455ba3215e22f2e3', 'android/app/src/main/java/app/oaclix/android/share/NativeDirectImageInbox.kt': '1fb539e7c4454a27330b2b402e44d5680f578527', 'android/app/src/main/java/app/oaclix/android/share/NativeDirectImagePeerManager.kt': 'e81475e3549fd4e9d57514a5268d2b00643422da', 'android/app/src/main/java/app/oaclix/android/share/NativeDirectImageProtocol.kt': 'fcc7f7128df8e00ac149a17c1f678672f7af7d78', 'android/app/src/main/java/app/oaclix/android/share/NativeDirectSignalProtocol.kt': 'd75b56ab6b67e6042010e984b8daf9068b537257', 'android/app/src/main/java/app/oaclix/android/share/NativeImageDeviceRelayReceiver.kt': '0f25113e75d507cc210c862ad95a9f372b63f86b', 'android/app/src/test/java/app/oaclix/android/share/NativeDirectImageProtocolTest.kt': '558b815986205ea950524e89e179035e7b188f10', 'android/app/src/test/java/app/oaclix/android/share/NativeDirectSignalProtocolTest.kt': 'd36e6a682695b66c6358dcf7f36b7c728a69b8b5', 'android/app/src/main/res/values/strings.xml': '1aaf9c0ae780dd624da5c604919b5e984c828df2'}
NEW_ONLY = ['android/app/src/main/java/app/oaclix/android/share/NativeDirectImageInbox.kt', 'android/app/src/main/java/app/oaclix/android/share/NativeDirectImagePeerManager.kt', 'android/app/src/main/java/app/oaclix/android/share/NativeDirectSignalProtocol.kt', 'android/app/src/test/java/app/oaclix/android/share/NativeDirectSignalProtocolTest.kt']
PARTS = ['payload.part.00', 'payload.part.01', 'payload.part.02', 'payload.part.03']

def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()

for rel, sha in EXPECTED_OLD.items():
    path = Path(rel)
    if not path.is_file() or git_blob_sha(path) != sha:
        raise SystemExit(f"Base inesperada para {rel}")
for rel in NEW_ONLY:
    if Path(rel).exists():
        raise SystemExit(f"El archivo nuevo ya existe: {rel}")

encoded = ''.join((Path('.github/oaclix-temp') / name).read_text() for name in PARTS)
raw = base64.b64decode(encoded, validate=True)
with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
    members = [m for m in archive.getmembers() if m.isfile()]
    names = {m.name.removeprefix('./') for m in members}
    if names != set(EXPECTED_NEW):
        raise SystemExit('Payload inesperado')
    for member in members:
        rel = member.name.removeprefix('./')
        if rel not in EXPECTED_NEW or member.name.startswith('/') or '..' in Path(member.name).parts:
            raise SystemExit(f"Ruta inválida en payload: {member.name}")
        target = Path(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit(f"No se pudo extraer {rel}")
        target.write_bytes(source.read())

for rel, sha in EXPECTED_NEW.items():
    path = Path(rel)
    if not path.is_file() or git_blob_sha(path) != sha:
        raise SystemExit(f"Payload alterado para {rel}")
print('Android Direct image patch applied and verified')
