from __future__ import annotations

import json
from pathlib import Path

ROOT = Path('.').resolve()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')
    print(f'Updated {path}')


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return content.replace(old, new, 1)


def replace_first(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count < 1:
        raise SystemExit(f'{label}: expected at least one match, found {count}')
    print(f'{label}: using the first of {count} matching block(s)')
    return content.replace(old, new, 1)


def update_auth_context() -> None:
    path = 'frontend/src/context/AuthContext.jsx'
    content = read(path)
    if 'function establishSession(sessionPayload)' not in content:
        anchor = '''  function saveSession(newToken, newUser) {
    const normalizedUser = normalizeUser(newUser);

    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(normalizedUser));
    setToken(newToken);
    setUser(normalizedUser);
  }
'''
        replacement = anchor + '''
  function establishSession(sessionPayload) {
    const newToken = String(sessionPayload?.token || "").trim();
    const rawUser = sessionPayload?.user;

    if (!newToken || !rawUser) {
      throw new Error("The secure session response is incomplete.");
    }

    const responseUser = {
      ...rawUser,
      workspace_code:
        rawUser.workspace_code ||
        sessionPayload?.workspace?.code ||
        DEFAULT_WORKSPACE_CODE,
      active_workspace:
        rawUser.active_workspace || sessionPayload?.workspace || null,
    };

    saveSession(newToken, responseUser);

    return {
      token: newToken,
      user: normalizeUser(responseUser),
    };
  }
'''
        content = replace_once(content, anchor, replacement, 'AuthContext establishSession')

    if '      establishSession,\n      login,' not in content:
        content = replace_once(
            content,
            '      login,\n      logout,\n',
            '      establishSession,\n      login,\n      logout,\n',
            'AuthContext public session method',
        )
    write(path, content)


def update_app() -> None:
    path = 'frontend/src/App.jsx'
    content = read(path)

    if 'import LastWorkTracker from "./components/LastWorkTracker";' not in content:
        content = replace_once(
            content,
            'import PageErrorBoundary from "./components/PageErrorBoundary";\n',
            'import PageErrorBoundary from "./components/PageErrorBoundary";\nimport LastWorkTracker from "./components/LastWorkTracker";\n',
            'App LastWorkTracker import',
        )

    if 'import DeviceAccessPage from "./pages/DeviceAccessPage";' not in content:
        content = replace_once(
            content,
            'import LoginPage from "./pages/LoginPage";\n',
            'import LoginPage from "./pages/LoginPage";\nimport DeviceAccessPage from "./pages/DeviceAccessPage";\nimport EmergencyOperationsPage from "./pages/EmergencyOperationsPage";\n',
            'App Command Gate page imports',
        )

    if '<LastWorkTracker />' not in content:
        content = replace_once(
            content,
            '        <BrowserRouter>\n        <Routes>\n',
            '        <BrowserRouter>\n          <LastWorkTracker />\n          <Routes>\n',
            'App work tracker mount',
        )

    if content.count('path="device-access"') == 0:
        content = replace_once(
            content,
            '            <Route path="change-password" element={safe(<ChangePasswordPage />)} />\n',
            '            <Route path="change-password" element={safe(<ChangePasswordPage />)} />\n            <Route path="device-access" element={safe(<DeviceAccessPage />)} />\n            <Route path="emergency-operations" element={safe(<EmergencyOperationsPage />)} />\n',
            'App Spare Parts Command Gate routes',
        )

    mining_anchor = '''            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
          </Route>
'''
    if content.count('path="device-access"') < 2:
        mining_replacement = '''            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
            <Route path="device-access" element={safe(<DeviceAccessPage />)} />
            <Route path="emergency-operations" element={safe(<EmergencyOperationsPage />)} />
          </Route>
'''
        content = replace_first(
            content,
            mining_anchor,
            mining_replacement,
            'App Mining Command Gate routes',
        )

    hire_anchor = '''            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
          </Route>

          {/* Group Executive'''
    if content.count('path="device-access"') < 3:
        hire_replacement = '''            <Route
              path="change-password"
              element={safe(<ChangePasswordPage />)}
            />
            <Route path="device-access" element={safe(<DeviceAccessPage />)} />
            <Route path="emergency-operations" element={safe(<EmergencyOperationsPage />)} />
          </Route>

          {/* Group Executive'''
        content = replace_once(
            content,
            hire_anchor,
            hire_replacement,
            'App Hire Command Gate routes',
        )

    write(path, content)


def update_tracker() -> None:
    path = 'frontend/src/components/LastWorkTracker.jsx'
    content = read(path)
    anchor = '  "/equipment-hire-operations/device-access",\n'
    addition = '''  "/equipment-hire-operations/device-access",
  "/emergency-operations",
  "/mining/emergency-operations",
  "/equipment-hire-operations/emergency-operations",
'''
    if '  "/emergency-operations",' not in content:
        content = replace_once(content, anchor, addition, 'LastWorkTracker exclusions')
    write(path, content)


def update_workspace_layout(path: str, change_password_path: str, device_path: str) -> None:
    content = read(path)
    if device_path in content:
        return
    anchor = f'''      {{
        title: "Change Password",
        description: "Update your secure account password",
        path: "{change_password_path}",
        icon: "🔐",
      }},
'''
    replacement = f'''      {{
        title: "Trusted Devices",
        description: "Passkeys, device unlock and station mode",
        path: "{device_path}",
        icon: "◎",
      }},
''' + anchor
    content = replace_once(content, anchor, replacement, f'{path} trusted devices nav')
    write(path, content)


def update_spare_parts_layout() -> None:
    path = 'frontend/src/components/Layout.jsx'
    content = read(path)
    if 'path: "/device-access"' in content:
        return

    auditor_anchor = '''          {
            title: "Change Password",
            description: "Update your auditor login password",
            path: "/change-password",
            icon: "🔐",
            keywords: "password security change login auditor",
          },
'''
    auditor_replacement = auditor_anchor + '''          {
            title: "Trusted Devices",
            description: "Passkeys, device unlock and station mode",
            path: "/device-access",
            icon: "◎",
            keywords: "passkey biometric fingerprint face windows hello trusted device station",
          },
'''
    content = replace_once(content, auditor_anchor, auditor_replacement, 'Spare Parts auditor device nav')

    staff_anchor = '''          {
            title: "Change Password",
            description: "Update your staff login password",
            path: "/change-password",
            icon: "🔐",
            keywords: "password security change login",
          },
'''
    staff_replacement = staff_anchor + '''          {
            title: "Trusted Devices",
            description: "Passkeys, device unlock and station mode",
            path: "/device-access",
            icon: "◎",
            keywords: "passkey biometric fingerprint face windows hello trusted device station",
          },
'''
    content = replace_once(content, staff_anchor, staff_replacement, 'Spare Parts staff device nav')
    write(path, content)


def add_release_test() -> None:
    path = 'frontend/scripts/commandGateReleaseTests.mjs'
    content = '''import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const login = read("src/pages/LoginPage.jsx");
const app = read("src/App.jsx");
const auth = read("src/context/AuthContext.jsx");
const commandGate = read("src/utils/commandGate.js");
const deviceAccess = read("src/pages/DeviceAccessPage.jsx");
const emergency = read("src/pages/EmergencyOperationsPage.jsx");

assert.match(login, /Unlock Chalin 03/);
assert.match(login, /authenticateWithPasskey/);
assert.match(login, /Password login/);
assert.match(login, /Emergency operations/);
assert.match(login, /request-otp/);
assert.match(auth, /establishSession/);
assert.match(app, /LastWorkTracker/);
assert.match(app, /DeviceAccessPage/);
assert.match(app, /EmergencyOperationsPage/);
assert.match(commandGate, /getPostLoginDestination/);
assert.match(commandGate, /saveStationMode/);
assert.match(deviceAccess, /registerPasskey/);
assert.match(deviceAccess, /auth\/passkeys/);
assert.match(emergency, /never bypasses permissions/i);

console.log("Command Gate frontend release contracts passed.");
'''
    write(path, content)

    package_path = 'frontend/package.json'
    data = json.loads(read(package_path))
    test_script = data['scripts']['test']
    command = 'node scripts/commandGateReleaseTests.mjs'
    if command not in test_script:
        data['scripts']['test'] = f'{test_script} && {command}'
    write(package_path, json.dumps(data, indent=2) + '\n')


def main() -> None:
    update_auth_context()
    update_app()
    update_tracker()
    update_workspace_layout(
        'frontend/src/layouts/MiningLayout.jsx',
        '/mining/change-password',
        '/mining/device-access',
    )
    update_workspace_layout(
        'frontend/src/layouts/EquipmentHireLayout.jsx',
        '/equipment-hire-operations/change-password',
        '/equipment-hire-operations/device-access',
    )
    update_spare_parts_layout()
    add_release_test()


if __name__ == '__main__':
    main()
