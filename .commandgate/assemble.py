from __future__ import annotations

import base64
import binascii
import hashlib
import io
import re
import tarfile
import zlib
from pathlib import Path

CHUNK_DIR = Path('.commandgate')
GZIP_OUTPUT = Path('/tmp/chalin-command-gate.tar.gz')
TAR_OUTPUT = Path('/tmp/chalin-command-gate.tar')
MANIFEST = Path('/tmp/chalin-command-gate-files.txt')
RECOVERED_SCRIPT = CHUNK_DIR / 'recovered_apply_command_gate.py.partial'
RECOVERY_INFO = CHUNK_DIR / 'recovery-info.txt'
BLOCK_SIZE = 512


def natural_key(path: Path):
    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r'(\d+)', path.name)
    ]


def fail(message: str) -> None:
    raise SystemExit(f'::error::{message}')


def parse_octal(field: bytes, label: str) -> int:
    cleaned = field.rstrip(b'\0 ').lstrip(b' ')
    if not cleaned:
        return 0
    try:
        return int(cleaned, 8)
    except ValueError as exc:
        fail(f'Invalid tar {label}: {cleaned!r}')
        raise AssertionError from exc


def recover_incomplete_script(
    data: bytes,
    *,
    content_start: int,
    full_name: str,
    expected_size: int,
) -> None:
    partial = data[content_start:]
    RECOVERED_SCRIPT.write_bytes(partial)
    RECOVERY_INFO.write_text(
        '\n'.join(
            [
                f'member={full_name}',
                f'expected_bytes={expected_size}',
                f'recovered_bytes={len(partial)}',
                f'missing_bytes={max(0, expected_size - len(partial))}',
                f'recovered_sha256={hashlib.sha256(partial).hexdigest()}',
            ]
        )
        + '\n',
        encoding='utf-8',
    )
    print(
        f'::warning::Recovered {len(partial)} of {expected_size} bytes from '
        f'{full_name}; missing {max(0, expected_size - len(partial))} bytes.'
    )
    raise SystemExit(42)


def validate_complete_tar(data: bytes) -> tuple[int, str]:
    offset = 0
    member_count = 0
    last_member = '<none>'

    while offset + BLOCK_SIZE <= len(data):
        header = data[offset:offset + BLOCK_SIZE]

        if header == b'\0' * BLOCK_SIZE:
            second_start = offset + BLOCK_SIZE
            second_end = second_start + BLOCK_SIZE
            if second_end > len(data):
                fail(
                    f'Tar archive has only one end block after {last_member}; '
                    f'{second_end - len(data)} more byte(s) are required.'
                )
            if data[second_start:second_end] != b'\0' * BLOCK_SIZE:
                fail(f'Tar archive has a malformed end marker after {last_member}.')
            return member_count, last_member

        stored_checksum = parse_octal(header[148:156], 'header checksum')
        calculated_checksum = sum(header[:148]) + (32 * 8) + sum(header[156:])
        if stored_checksum != calculated_checksum:
            fail(
                f'Tar header checksum failed at byte {offset}: '
                f'expected {stored_checksum}, calculated {calculated_checksum}.'
            )

        name = header[0:100].split(b'\0', 1)[0].decode('utf-8', errors='replace')
        prefix = header[345:500].split(b'\0', 1)[0].decode('utf-8', errors='replace')
        full_name = f'{prefix}/{name}' if prefix else name
        size = parse_octal(header[124:136], f'size for {full_name}')
        padded_size = ((size + BLOCK_SIZE - 1) // BLOCK_SIZE) * BLOCK_SIZE
        content_start = offset + BLOCK_SIZE
        member_end = content_start + padded_size

        if member_end > len(data):
            if full_name == 'apply_command_gate.py':
                recover_incomplete_script(
                    data,
                    content_start=content_start,
                    full_name=full_name,
                    expected_size=size,
                )
            fail(
                f'Tar member {full_name!r} is incomplete: '
                f'{member_end - len(data)} more byte(s) are required.'
            )

        member_count += 1
        last_member = full_name
        offset = member_end

    fail(
        f'Tar archive is truncated after {last_member}; '
        f'{BLOCK_SIZE - (len(data) - offset)} more byte(s) are required for the next block.'
    )
    raise AssertionError


def decode_gzip_payload(payload: bytes) -> tuple[bytes, bool]:
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
    parts: list[bytes] = []

    try:
        for start in range(0, len(payload), 4096):
            parts.append(decompressor.decompress(payload[start:start + 4096]))
        parts.append(decompressor.flush())
    except zlib.error as exc:
        fail(f'Gzip compressed data is invalid: {exc}')

    return b''.join(parts), decompressor.eof


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

    GZIP_OUTPUT.write_bytes(payload)
    print(f'Decoded: {len(payload)} bytes')
    print(f'Compressed SHA-256: {hashlib.sha256(payload).hexdigest()}')

    tar_data, gzip_complete = decode_gzip_payload(payload)
    print(f'Decompressed: {len(tar_data)} bytes; gzip_eof={gzip_complete}')

    member_count, last_member = validate_complete_tar(tar_data)
    TAR_OUTPUT.write_bytes(tar_data)

    try:
        with tarfile.open(fileobj=io.BytesIO(tar_data), mode='r:') as archive:
            members = archive.getmembers()
    except (tarfile.TarError, OSError) as exc:
        fail(f'Tar verification failed: {exc}')

    if not members or len(members) != member_count:
        fail(
            f'Tar member count mismatch: parser={member_count}, '
            f'tarfile={len(members)}.'
        )

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

    if not gzip_complete:
        print(
            '::warning::The gzip footer is missing, but the inner tar archive '
            'is complete, checksum-valid, safely terminated, and will be used.'
        )
    print(f'Archive members: {member_count}; last member: {last_member}')


if __name__ == '__main__':
    main()
