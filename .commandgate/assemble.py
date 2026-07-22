from __future__ import annotations

import base64
import binascii
import gzip
import hashlib
import re
import tarfile
from pathlib import Path

CHUNK_DIR = Path('.commandgate')
OUTPUT = Path('/tmp/chalin-command-gate.tar.gz')
MANIFEST = Path('/tmp/chalin-command-gate-files.txt')


def natural_key(path: Path):
    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r'(\d+)', path.name)
    ]


def fail(message: str) -> None:
    raise SystemExit(f'::error::{message}')


def main() -> None:
    chunks = sorted(CHUNK_DIR.glob('chunk*.txt'), key=natural_key)
    if not chunks:
        fail('No Command Gate package chunks were found.')

    encoded_parts: list[str] = []
    for chunk in chunks:
        normalized = ''.join(chunk.read_text(encoding='utf-8-sig').split())
        if not normalized:
            fail(f'{chunk} is empty.')
        invalid = re.search(r'[^A-Za-z0-9+/=]', normalized)
        if invalid:
            fail(f'{chunk} contains an invalid base64 character at offset {invalid.start()}.')
        encoded_parts.append(normalized)
        print(f'{chunk}: {len(normalized)} chars')

    encoded = ''.join(encoded_parts)
    print(f'Total: {len(encoded)} chars; remainder: {len(encoded) % 4}')
    encoded += '=' * ((-len(encoded)) % 4)

    try:
        payload = base64.b64decode(encoded, validate=True)
    except binascii.Error as exc:
        fail(f'Base64 package is invalid: {exc}')

    OUTPUT.write_bytes(payload)
    print(f'Decoded: {len(payload)} bytes')
    print(f'SHA-256: {hashlib.sha256(payload).hexdigest()}')

    try:
        with gzip.open(OUTPUT, 'rb') as stream:
            while stream.read(1024 * 1024):
                pass
    except (OSError, EOFError) as exc:
        fail(f'Gzip verification failed: {exc}')

    try:
        with tarfile.open(OUTPUT, mode='r:gz') as archive:
            members = archive.getmembers()
    except (tarfile.TarError, OSError) as exc:
        fail(f'Tar verification failed: {exc}')

    if not members:
        fail('Package archive is empty.')

    unsafe = [
        member.name
        for member in members
        if member.name.startswith('/') or '..' in Path(member.name).parts
    ]
    if unsafe:
        fail(f'Unsafe archive paths detected: {unsafe[:5]}')

    MANIFEST.write_text(
        '\n'.join(member.name for member in members) + '\n',
        encoding='utf-8',
    )
    print(f'Archive members: {len(members)}')


if __name__ == '__main__':
    main()
