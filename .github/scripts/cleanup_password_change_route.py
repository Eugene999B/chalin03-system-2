from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / "backend/routes/authRoutes.js"
text = path.read_text(encoding="utf-8")
old = '''    const userColumns = await getTableColumns("users");
    const updateFields = ["password_hash = ?"];
    const updateParams = [newPasswordHash];

    if (userColumns.has("must_change_password")) {
      updateFields.push("must_change_password = FALSE");
    }

    if (userColumns.has("password_changed_at")) {
      updateFields.push("password_changed_at = CURRENT_TIMESTAMP");
    }

    if (userColumns.has("token_version")) {
      updateFields.push("token_version = token_version + 1");
    }

    await changePasswordAtomically({
'''
new = '''    const userColumns = await getTableColumns("users");

    await changePasswordAtomically({
'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one cleanup target, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Removed obsolete route-local update construction.")
