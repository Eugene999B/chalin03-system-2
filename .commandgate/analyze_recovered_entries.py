from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

PARTIAL = Path('.commandgate/recovered_apply_command_gate.py.partial')
OUTPUT = Path('.commandgate/recovered-manifest.json')
ENTRY_PATTERN = re.compile(r"'([^'\\]+)': '([A-Za-z0-9+/=]+)'(?:,|})")


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
    incomplete_match = re.search(r"'([^'\\]+)': '([A-Za-z0-9+/=]*)$", tail)
    manifest = {
        'partial_chars': len(text),
        'complete_entries': len(entries),
        'entries': entries,
        'unparsed_tail_chars': len(tail),
        'incomplete_path': incomplete_match.group(1) if incomplete_match else None,
        'incomplete_encoded_chars': len(incomplete_match.group(2)) if incomplete_match else None,
        'tail_prefix': tail[:300],
        'tail_suffix': tail[-300:],
    }
    OUTPUT.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    print(f"Recovered complete file entries: {len(entries)}")
    for entry in entries:
        print(f"- {entry['path']} ({entry['decoded_bytes']} bytes)")
    print(f"Unparsed tail characters: {len(tail)}")
    print(f"Incomplete path: {manifest['incomplete_path']}")
    print(f"Incomplete encoded characters: {manifest['incomplete_encoded_chars']}")


if __name__ == '__main__':
    main()
