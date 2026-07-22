from __future__ import annotations

import base64
import re
from pathlib import Path

ROOT = Path('.').resolve()
PARTIAL = Path('.commandgate/recovered_apply_command_gate.py.partial')
ENTRY_PATTERN = re.compile(r"'([^'\\]+)': '([A-Za-z0-9+/=]+)'(?:,|})")


def safe_target(relative_path: str) -> Path:
    target = (ROOT / relative_path).resolve()
    if ROOT not in target.parents:
        raise SystemExit(f'Unsafe recovered path: {relative_path}')
    return target


def main() -> None:
    text = PARTIAL.read_text(encoding='utf-8')
    matches = list(ENTRY_PATTERN.finditer(text))
    if not matches:
        raise SystemExit('No complete recovered file entries were found.')

    for match in matches:
        relative_path = match.group(1)
        decoded = base64.b64decode(match.group(2), validate=True)
        target = safe_target(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(decoded)
        print(f'Applied {relative_path} ({len(decoded)} bytes)')

    print(f'Applied {len(matches)} complete recovered files.')


if __name__ == '__main__':
    main()
