from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / "frontend/src/api/axiosClient.js"
text = path.read_text(encoding="utf-8")

old_order = '''    const isTemporaryProfileFailure =
      requestPath === "/auth/me" &&
      Boolean(activeToken) &&
      requestToken === activeToken &&
      Boolean(cachedUser) &&
      (statusCode === undefined || statusCode === 0 || statusCode === 400 || statusCode >= 500);
    const isChangePasswordCredentialFailure =
      requestPath === "/auth/change-password" &&
      statusCode === 401 &&
      (errorCode === "CURRENT_PASSWORD_INCORRECT" ||
        errorMessage === "Current password is incorrect.");
'''
new_order = '''    const isChangePasswordCredentialFailure =
      requestPath === "/auth/change-password" &&
      statusCode === 401 &&
      (errorCode === "CURRENT_PASSWORD_INCORRECT" ||
        errorMessage === "Current password is incorrect.");
    const isTemporaryProfileFailure =
      requestPath === "/auth/me" &&
      Boolean(activeToken) &&
      requestToken === activeToken &&
      Boolean(cachedUser) &&
      (statusCode === undefined || statusCode === 0 || statusCode === 400 || statusCode >= 500);
'''
if text.count(old_order) != 1:
    raise SystemExit(f"Expected one guard-order target, found {text.count(old_order)}")
text = text.replace(old_order, new_order, 1)

old_if = '''    if (
      statusCode === 401 &&
      !isOwnerRecoveryRequest &&
      !isOwnerRecoveryPage &&
      !isChangePasswordCredentialFailure
    ) {
'''
new_if = '''    if (statusCode === 401 &&
      !isOwnerRecoveryRequest &&
      !isOwnerRecoveryPage &&
      !isChangePasswordCredentialFailure
    ) {
'''
if text.count(old_if) != 1:
    raise SystemExit(f"Expected one 401-condition target, found {text.count(old_if)}")
text = text.replace(old_if, new_if, 1)

path.write_text(text, encoding="utf-8")
print("Aligned password credential guard with existing desktop resilience contracts.")
