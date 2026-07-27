# Password Change Security Note

An incorrect current password must not be interpreted as evidence that the authenticated session itself is invalid. The server now reports a validation error while the browser preserves the active session. Only genuine session-authentication failures clear stored authentication state.
