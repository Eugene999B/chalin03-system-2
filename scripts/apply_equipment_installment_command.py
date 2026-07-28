from __future__ import annotations

import base64
import hashlib
import io
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / "scripts" / f"installment_command_payload_{index:02d}.txt" for index in range(5)]
ARCHIVE_SHA256 = "90094b7f76dd3dbad9f2e155df2f4c2bf79d9abe62dae8d8efd5a5cc838fac72"

EXPECTED_FILES = {
    "backend/routes/equipmentInstallmentCommandRoutes.js",
    "backend/services/equipmentInstallmentCommandService.js",
    "backend/services/equipmentSalesReminderService.js",
    "backend/tests/equipmentInstallmentCommandCentre.test.js",
    "docs/EQUIPMENT_INSTALLMENT_COMMAND_CENTRE.md",
    "frontend/package.json",
    "frontend/public/sw.js",
    "frontend/scripts/equipmentInstallmentCommandTests.mjs",
    "frontend/src/layouts/EquipmentHireLayout.jsx",
    "frontend/src/pages/EquipmentInstallmentCommandPage.jsx",
    "frontend/src/pages/FleetAssetsPage.jsx",
    "frontend/src/styles/equipmentInstallmentCommand.css",
}

ANCHORS = {
    "frontend/src/pages/FleetAssetsPage.jsx": "EquipmentSalesWorkspacePage",
    "frontend/src/layouts/EquipmentHireLayout.jsx": "Sales & Installments",
    "backend/services/equipmentSalesReminderService.js": "startEquipmentSalesReminderScheduler",
    "frontend/package.json": "passwordChangeSessionTests.mjs",
    "frontend/public/sw.js": "chalin03-debt-reminder-automation-v15",
}


def fail(message: str) -> None:
    raise RuntimeError(f"Installment Command Centre package refused: {message}")


def verify_current_source() -> None:
    for relative_path, anchor in ANCHORS.items():
        target = ROOT / relative_path
        if not target.is_file():
            fail(f"required source file is missing: {relative_path}")
        source = target.read_text(encoding="utf-8")
        if anchor not in source:
            fail(f"source anchor changed in {relative_path}: {anchor}")


def read_archive() -> bytes:
    missing = [part.name for part in PARTS if not part.is_file()]
    if missing:
        fail(f"payload part(s) missing: {', '.join(missing)}")

    encoded = "".join(part.read_text(encoding="utf-8").strip() for part in PARTS)
    try:
        archive = base64.b64decode(encoded, validate=True)
    except Exception as error:
        fail(f"payload is not valid base64: {error}")

    digest = hashlib.sha256(archive).hexdigest()
    if digest != ARCHIVE_SHA256:
        fail(f"archive checksum mismatch: expected {ARCHIVE_SHA256}, received {digest}")
    return archive


def safe_member_name(name: str) -> str:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        fail(f"unsafe archive path: {name}")
    return path.as_posix().rstrip("/")


def apply_archive(archive: bytes) -> None:
    extracted_files: set[str] = set()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
        for member in package.getmembers():
            name = safe_member_name(member.name)
            if member.isdir():
                continue
            if member.issym() or member.islnk() or not member.isfile():
                fail(f"unsupported archive member type: {member.name}")
            if name not in EXPECTED_FILES:
                fail(f"unexpected archive file: {name}")
            if name in extracted_files:
                fail(f"duplicate archive file: {name}")

            source = package.extractfile(member)
            if source is None:
                fail(f"could not read archive file: {name}")
            data = source.read()
            target = ROOT / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            extracted_files.add(name)

    missing = EXPECTED_FILES - extracted_files
    if missing:
        fail(f"archive did not contain: {', '.join(sorted(missing))}")


def verify_generated_source() -> None:
    service = (ROOT / "backend/services/equipmentInstallmentCommandService.js").read_text(
        encoding="utf-8"
    )
    forbidden_schema_mutation = ("CREATE TABLE", "ALTER TABLE", "DROP TABLE", "TRUNCATE TABLE")
    for token in forbidden_schema_mutation:
        if token in service.upper():
            fail(f"runtime schema mutation token found in command service: {token}")

    required_markers = {
        "backend/services/equipmentInstallmentCommandService.js": [
            "portfolio_at_risk_rate",
            "promise_to_pay",
            "GET_LOCK",
            "automatic_sms_enabled",
        ],
        "frontend/src/pages/EquipmentInstallmentCommandPage.jsx": [
            "Installment Command Centre",
            "Collections Queue",
            "Portfolio at Risk",
            "Promise to Pay",
        ],
        "frontend/public/sw.js": ["chalin03-installment-command-centre-v16"],
    }
    for relative_path, markers in required_markers.items():
        source = (ROOT / relative_path).read_text(encoding="utf-8")
        for marker in markers:
            if marker not in source:
                fail(f"generated marker missing from {relative_path}: {marker}")


def main() -> None:
    verify_current_source()
    archive = read_archive()
    apply_archive(archive)
    verify_generated_source()
    print(
        f"Applied verified Equipment Installment Command Centre package: "
        f"{len(EXPECTED_FILES)} files, sha256 {ARCHIVE_SHA256}."
    )


if __name__ == "__main__":
    main()
