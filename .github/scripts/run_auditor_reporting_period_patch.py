from pathlib import Path

patch_path = Path(".github/scripts/apply_auditor_reporting_period.py")
source = patch_path.read_text(encoding="utf-8")
source = source.replace(
    "source, count = pattern.subn(DATE_HELPERS, source, count=1)",
    "source, count = pattern.subn(lambda _match: DATE_HELPERS, source, count=1)",
    1,
)
exec(compile(source, str(patch_path), "exec"), {"__name__": "__main__"})
