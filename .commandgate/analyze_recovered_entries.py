from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

PARTIAL = Path('.commandgate/recovered_apply_command_gate.py.partial')
OUTPUT = Path('.commandgate/recovered-manifest.json')
RECOVERED_PARTIAL_FILE = Path('.commandgate/recovered_DeviceAccessPage.jsx.partial')
ENTRY_PATTERN = re.compile(r"'([^'\\]+)': '([A-Za-z0-9+/=]+)'(?:,|})")
PARTIAL_ENTRY_PATTERN = re.compile(r"\s*'([^'\\]+)': '([A-Za-z0-9+/=]+)")


def decode_complete_prefix(encoded: str) -> bytes:
    usable_length = len(encoded) - (len(encoded) % 4)
    if usable_length <= 0:
        return b''
    return base64.b64decode(encoded[:usable_length], validate=True)


def main() -> None:
    text = PARTIAL.read_text(encoding='utf-8')
    entries = []
    last_end = 0

    for match in ENTRY_PATTERN.finditer(text):
        path = match.group(1)
        encoded = match.group(2)
        decoded = base64.b64decode(encoded, validate=True)
        entries.append(
            {
                'path': path,
                'encoded_chars': len(encoded),
                'decoded_bytes': len(decoded),
                'sha256': hashlib.sha256(decoded).hexdigest(),
            }
        )
        last_end = match.end()

    tail = text[last_end:]
    partial_match = PARTIAL_ENTRY_PATTERN.match(tail)
    partial_path = partial_match.group(1) if partial_match else None
    partial_encoded = partial_match.group(2) if partial_match else ''
    partial_decoded = decode_complete_prefix(partial_encoded)

    if partial_path == 'frontend/src/pages/DeviceAccessPage.jsx' and partial_decoded:
        RECOVERED_PARTIAL_FILE.write_bytes(partial_decoded)

    first_invalid_offset = None
    invalid_context = None
    if partial_match:
        first_invalid_offset = partial_match.end(2)
        invalid_context = tail[first_invalid_offset:first_invalid_offset + 120]

    manifest = {
        'partial_chars': len(text),
        'complete_entries': len(entries),
        'entries': entries,
        'unparsed_tail_chars': len(tail),
        'partial_path': partial_path,
        'partial_encoded_chars': len(partial_encoded),
        'partial_decoded_bytes': len(partial_decoded),
        'partial_decoded_sha256': (
            hashlib.sha256(partial_decoded).hexdigest() if partial_decoded else None
        ),
        'first_invalid_tail_offset': first_invalid_offset,
        'invalid_context': invalid_context,
        'tail_prefix': tail[:300],
        'tail_suffix': tail[-300:],
    }
    OUTPUT.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    print(f"Recovered complete file entries: {len(entries)}")
    for entry in entries:
        print(f"- {entry['path']} ({entry['decoded_bytes']} bytes)")
    print(f"Unparsed tail characters: {len(tail)}")
    print(f"Partial path: {partial_path}")
    print(f"Partial encoded characters: {len(partial_encoded)}")
    print(f"Partial decoded bytes: {len(partial_decoded)}")
    print(f"Invalid context: {invalid_context!r}")


if __name__ == '__main__':
    main()
