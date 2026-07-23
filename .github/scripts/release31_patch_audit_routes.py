from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
ROUTES = ROOT / "backend" / "routes"

READINESS_IMPORT = '''const {
  assertAuditSchemaReady,
  sendAuditSchemaReadinessError,
} = require("../services/auditSchemaReadinessService");
'''

FORBIDDEN_DDL = re.compile(
    r"\b(?:CREATE\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW)|"
    r"ALTER\s+TABLE|DROP\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW|DATABASE|SCHEMA)|"
    r"TRUNCATE\s+TABLE|RENAME\s+TABLE)\b",
    re.IGNORECASE,
)


def insert_readiness_import(source: str) -> str:
    if "auditSchemaReadinessService" in source:
        return source
    marker = 'const { requireAuth } = require("../middleware/authMiddleware");\n'
    if marker not in source:
        raise RuntimeError("requireAuth import marker not found")
    return source.replace(marker, marker + READINESS_IMPORT, 1)


def add_route_error_handling(source: str) -> str:
    route_positions = [
        position
        for position in (
            source.find("router.get("),
            source.find("router.post("),
            source.find("router.patch("),
            source.find("router.put("),
            source.find("router.delete("),
        )
        if position >= 0
    ]
    if not route_positions:
        raise RuntimeError("No route handlers found")
    route_start = min(route_positions)
    prefix, body = source[:route_start], source[route_start:]
    marker = "} catch (error) {\n"
    replacement = (
        "} catch (error) {\n"
        "    if (sendAuditSchemaReadinessError(res, error)) return;\n"
    )
    body = re.sub(
        r"\} catch \(error\) \{\n(?!\s*if \(sendAuditSchemaReadinessError)",
        replacement,
        body,
    )
    return prefix + body


def patch_signoff() -> None:
    path = ROUTES / "auditSignoffRoutes.js"
    source = insert_readiness_import(path.read_text(encoding="utf-8"))

    if "let tableReadyPromise = null;" in source:
        start = source.index("let tableReadyPromise = null;")
        end = source.index("function getBranchId(req)")
        source = source[:start] + source[end:]

    if "async function ensureColumn(" in source:
        start = source.index("async function ensureColumn(")
        end = source.index("async function safeLogActivity(")
        replacement = '''async function ensureAuditSignoffsTable(connection = pool) {
  return assertAuditSchemaReady(connection);
}

async function ensureAuditReapprovalLogTable(connection = pool) {
  return assertAuditSchemaReady(connection);
}

'''
        source = source[:start] + replacement + source[end:]

    source = add_route_error_handling(source)
    path.write_text(source, encoding="utf-8", newline="\n")


def patch_unlock() -> None:
    path = ROUTES / "auditUnlockRequestRoutes.js"
    source = insert_readiness_import(path.read_text(encoding="utf-8"))

    if "async function ensureColumn(" in source:
        start = source.index("async function ensureColumn(")
        end = source.index("function normalizeRequestArea(")
        replacement = '''async function ensureAuditUnlockRequestTable(connection = pool) {
  return assertAuditSchemaReady(connection);
}

'''
        source = source[:start] + replacement + source[end:]

    source = add_route_error_handling(source)
    path.write_text(source, encoding="utf-8", newline="\n")


def verify() -> None:
    for name in ("auditSignoffRoutes.js", "auditUnlockRequestRoutes.js"):
        source = (ROUTES / name).read_text(encoding="utf-8")
        if "auditSchemaReadinessService" not in source:
            raise RuntimeError(f"{name}: readiness service import missing")
        if FORBIDDEN_DDL.search(source):
            raise RuntimeError(f"{name}: runtime DDL remains")
        if "sendAuditSchemaReadinessError(res, error)" not in source:
            raise RuntimeError(f"{name}: controlled readiness response missing")


if __name__ == "__main__":
    patch_signoff()
    patch_unlock()
    verify()
    print("Release 3.1 audit route patch applied and verified.")
