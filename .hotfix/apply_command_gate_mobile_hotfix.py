from __future__ import annotations

from pathlib import Path

ROOT = Path('.').resolve()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
    print(f'updated {path}')


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return content.replace(old, new, 1)


def patch_login() -> None:
    path = 'frontend/src/pages/LoginPage.jsx'
    content = read(path)

    content = replace_once(
        content,
        '  authenticateWithPasskey,\n',
        '  authenticateWithPasskey,\n  registerPasskey,\n',
        'registerPasskey import',
    )

    content = replace_once(
        content,
        '  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);\n',
        '  const [passwordPanelOpen, setPasswordPanelOpen] = useState(true);\n',
        'password panel default',
    )

    content = replace_once(
        content,
        '  const [commandDestination, setCommandDestination] = useState("");\n',
        '  const [commandDestination, setCommandDestination] = useState("");\n  const [deviceSetupMessage, setDeviceSetupMessage] = useState("");\n',
        'device setup state',
    )

    helper_anchor = '''function persistPasskeySession(payload, fallbackWorkspaceCode) {
  const token = String(payload?.token || "").trim();
  const rawUser = payload?.user;

  if (!token || !rawUser) {
    throw new Error("The secure session response is incomplete.");
  }

  const user = {
    ...rawUser,
    workspace_code:
      rawUser.workspace_code || payload?.workspace?.code || fallbackWorkspaceCode,
    active_workspace: rawUser.active_workspace || payload?.workspace || null,
  };

  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));

  return { ...payload, token, user };
}
'''

    helper_replacement = helper_anchor + '''
function getAutomaticDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Device";
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
  return `${mobile ? "Mobile" : "Workstation"} · ${platform}`.slice(0, 120);
}

function isPasskeyPromptCancelled(error) {
  const name = String(error?.name || "");
  return name.includes("NotAllowed") || name.includes("Abort");
}
'''
    if 'function getAutomaticDeviceName()' not in content:
        content = replace_once(
            content,
            helper_anchor,
            helper_replacement,
            'automatic device helper',
        )

    content = replace_once(
        content,
        '''  if (isLoggedIn) {
    const destination = getPostLoginDestination({
''',
        '''  if (isLoggedIn && !loadingMode && commandStage < 0) {
    const destination = getPostLoginDestination({
''',
        'prevent premature redirect',
    )

    finish_anchor = '''  async function finishCommand(sessionPayload) {
    const authenticatedUser = sessionPayload.user;
    const destination = getPostLoginDestination({
      user: authenticatedUser,
      workspaceCode: selectedWorkspaceCode,
      stationCode,
      preferResume: stationCode === "auto",
    });

    if (emergencyMode) {
      openEmergencyCommand(selectedWorkspaceCode);
    }

    setCommandUser(authenticatedUser);
    setCommandDestination(destination);
'''

    finish_replacement = '''  async function finishCommand(sessionPayload, deviceSetupStatus = "") {
    const authenticatedUser = sessionPayload.user;
    const destination = getPostLoginDestination({
      user: authenticatedUser,
      workspaceCode: selectedWorkspaceCode,
      stationCode,
      preferResume: stationCode === "auto",
    });

    if (emergencyMode) {
      openEmergencyCommand(selectedWorkspaceCode);
    }

    sessionStorage.setItem(
      "chalin03_command_arrival",
      JSON.stringify({
        workspaceCode: selectedWorkspaceCode,
        workspaceName: selectedWorkspace.name,
        userName:
          authenticatedUser?.full_name || authenticatedUser?.username || "Authorised worker",
        role: friendlyRole(authenticatedUser),
        destination,
        destinationLabel: describeResumePath(destination),
        deviceSetupStatus,
        createdAt: new Date().toISOString(),
      })
    );

    setCommandUser(authenticatedUser);
    setCommandDestination(destination);
'''
    content = replace_once(content, finish_anchor, finish_replacement, 'arrival workflow')

    password_anchor = '''      const result = await login({
        identifier: username.trim(),
        username: username.trim(),
        password,
        workspaceCode: selectedWorkspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        deviceEvidence,
      });
      await finishCommand(result);
'''

    password_replacement = '''      const result = await login({
        identifier: username.trim(),
        username: username.trim(),
        password,
        workspaceCode: selectedWorkspaceCode,
        branchId: isSpareParts ? Number(selectedBranchId) : null,
        deviceEvidence,
      });

      let deviceSetupStatus = "password-only";
      if (supportsPasskeys()) {
        try {
          setDeviceSetupMessage("Checking this device for secure fingerprint or device-PIN access…");
          const passkeyResponse = await axiosClient.get("/auth/passkeys");
          const passkeys = Array.isArray(passkeyResponse.data?.passkeys)
            ? passkeyResponse.data.passkeys
            : [];

          if (passkeys.length === 0) {
            setDeviceSetupMessage(
              "Use your fingerprint, face, Windows Hello or device PIN to secure this device."
            );
            await registerPasskey({
              currentPassword: password,
              displayName: getAutomaticDeviceName(),
            });
            deviceSetupStatus = "registered";
            setDeviceSetupMessage("Secure device access is ready.");
          } else {
            deviceSetupStatus = "already-ready";
            setDeviceSetupMessage("Secure device access is already ready for this account.");
          }
        } catch (deviceError) {
          deviceSetupStatus = isPasskeyPromptCancelled(deviceError)
            ? "skipped"
            : "unavailable";
          setDeviceSetupMessage(
            isPasskeyPromptCancelled(deviceError)
              ? "Device security setup was skipped. Password login remains available."
              : "Device security could not be completed now. Password login remains available."
          );
        }
      }

      await finishCommand(result, deviceSetupStatus);
'''
    content = replace_once(content, password_anchor, password_replacement, 'automatic passkey setup')

    content = content.replace(
        '<span className="command-sector__code">{cardVisual.code}</span>',
        '<span className="command-sector__code" aria-hidden="true">{workspace.icon}</span>',
    )

    content = content.replace(
        '{loadingMode === "passkey" ? "Verifying device…" : "Unlock Chalin 03"}',
        '{loadingMode === "passkey" ? "Verifying registered device…" : "Use registered device"}',
    )

    content = content.replace(
        '<small>Fingerprint, face, Windows Hello or device PIN</small>',
        '<small>For workers who already completed automatic device setup</small>',
        1,
    )

    form_anchor = '''                <button className="password-console__submit" type="submit" disabled={busy}>
                  {loadingMode === "password" ? "Establishing secure session…" : "Enter with password"}
                </button>
              </form>
            )}
'''

    form_replacement = '''                <button className="password-console__submit" type="submit" disabled={busy}>
                  {loadingMode === "password"
                    ? deviceSetupMessage || "Establishing secure session…"
                    : "Sign in securely"}
                </button>
                <p className="password-console__automatic-note">
                  <span aria-hidden="true">🛡️</span>
                  After a successful password login, Chalin automatically asks this device to
                  enable fingerprint, face, Windows Hello or device-PIN access when needed.
                </p>
              </form>
            )}
'''
    content = replace_once(content, form_anchor, form_replacement, 'automatic setup note')

    content = content.replace(
        '<p className="command-gate__kicker">One identity. Three businesses. Instant command.</p>',
        '<p className="command-gate__kicker">Chalin 03 Group Business System</p>',
    )
    content = content.replace(
        '<h1>Your business is ready.<br /><span>Identify yourself.</span></h1>',
        '<h1>Welcome to <span>Chalin 03.</span></h1>',
    )
    content = content.replace(
        'Chalin recognises the business, operating context and station you need before a menu opens.',
        'Choose your business, sign in with your normal password and continue directly to the work that matters.',
    )
    content = content.replace(
        '<span>Entrance profile</span>',
        '<span>Where Chalin will take you</span>',
    )

    write(path, content)


def add_arrival_banner() -> None:
    path = 'frontend/src/components/CommandArrivalBanner.jsx'
    content = '''import { useEffect, useState } from "react";
import { describeResumePath } from "../utils/commandGate";
import "../styles/commandGateExtensions.css";

const KEY = "chalin03_command_arrival";

function readArrival() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (!value) return null;
    const age = Date.now() - new Date(value.createdAt || 0).getTime();
    if (!Number.isFinite(age) || age > 60_000) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return value;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export default function CommandArrivalBanner() {
  const [arrival, setArrival] = useState(() => readArrival());

  useEffect(() => {
    if (!arrival) return undefined;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(KEY);
      setArrival(null);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [arrival]);

  if (!arrival) return null;

  const securityText =
    arrival.deviceSetupStatus === "registered"
      ? "Device security enabled automatically"
      : arrival.deviceSetupStatus === "already-ready"
      ? "Trusted device recognised"
      : "Secure password session established";

  return (
    <aside className="command-arrival" role="status" aria-live="polite">
      <div className="command-arrival__icon" aria-hidden="true">✓</div>
      <div className="command-arrival__copy">
        <small>{arrival.workspaceName || "Chalin 03"}</small>
        <strong>Welcome back, {arrival.userName}.</strong>
        <span>
          {arrival.role} · Opening {arrival.destinationLabel || describeResumePath(arrival.destination)}
        </span>
        <em>{securityText}</em>
      </div>
      <button
        type="button"
        aria-label="Dismiss welcome message"
        onClick={() => {
          sessionStorage.removeItem(KEY);
          setArrival(null);
        }}
      >
        ×
      </button>
    </aside>
  );
}
'''
    write(path, content)

    main_path = 'frontend/src/main.jsx'
    main = read(main_path)
    if 'CommandArrivalBanner' not in main:
        main = replace_once(
            main,
            'import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";\n',
            'import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";\nimport CommandArrivalBanner from "./components/CommandArrivalBanner.jsx";\n',
            'arrival banner import',
        )
        main = replace_once(
            main,
            '    <EmergencyCommandOverlay />\n',
            '    <EmergencyCommandOverlay />\n    <CommandArrivalBanner />\n',
            'arrival banner mount',
        )
    write(main_path, main)


def append_styles() -> None:
    path = 'frontend/src/styles/commandGateExtensions.css'
    content = read(path)
    marker = '/* Command Gate mobile visibility hotfix */'
    if marker in content:
        return

    content += '''

/* Command Gate mobile visibility hotfix */
.command-gate {
  --command-gold: #f2c94c;
  --command-navy: #06182d;
  --command-blue: #2f80ed;
  --command-green: #27ae60;
  padding: 18px;
  color: #f8fbff;
  background:
    radial-gradient(circle at 8% 6%, rgba(242, 201, 76, 0.42), transparent 31%),
    radial-gradient(circle at 92% 12%, rgba(47, 128, 237, 0.38), transparent 34%),
    radial-gradient(circle at 75% 94%, rgba(39, 174, 96, 0.24), transparent 36%),
    linear-gradient(145deg, #031225 0%, #092a4c 48%, #07182c 100%);
}

.command-gate--mining {
  background:
    radial-gradient(circle at 8% 8%, rgba(242, 153, 74, 0.48), transparent 32%),
    radial-gradient(circle at 90% 14%, rgba(242, 201, 76, 0.3), transparent 34%),
    radial-gradient(circle at 78% 94%, rgba(39, 174, 96, 0.2), transparent 35%),
    linear-gradient(145deg, #211204 0%, #5a3514 48%, #1d1308 100%);
}

.command-gate--hire {
  background:
    radial-gradient(circle at 8% 7%, rgba(86, 204, 242, 0.45), transparent 31%),
    radial-gradient(circle at 92% 14%, rgba(47, 128, 237, 0.43), transparent 34%),
    radial-gradient(circle at 75% 94%, rgba(242, 201, 76, 0.2), transparent 35%),
    linear-gradient(145deg, #04172c 0%, #0b4778 48%, #061a30 100%);
}

.command-gate__shell {
  border-color: rgba(255, 255, 255, 0.24);
  background: linear-gradient(145deg, rgba(8, 28, 52, 0.9), rgba(4, 18, 36, 0.84));
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.36), inset 0 1px rgba(255, 255, 255, 0.16);
}

.command-gate__hero h1 {
  max-width: 820px;
  font-size: clamp(48px, 6vw, 84px);
  line-height: 0.96;
}

.command-gate__lead,
.command-gate__context > p,
.command-gate__resume p,
.command-sector__copy em {
  color: rgba(249, 252, 255, 0.82);
}

.command-gate__signal-card {
  border-color: rgba(255, 255, 255, 0.24);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.17), rgba(255, 255, 255, 0.08));
}

.command-sector {
  min-height: 142px;
  border-color: rgba(255, 255, 255, 0.24);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.065));
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.12);
}

.command-sector.is-selected {
  border-color: #f2c94c;
  background: linear-gradient(145deg, rgba(242, 201, 76, 0.28), rgba(255, 255, 255, 0.12));
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.22), inset 0 0 0 1px rgba(242, 201, 76, 0.22);
}

.command-sector__code {
  width: 58px;
  height: 58px;
  flex-basis: 58px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 19px;
  font-size: 30px;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.22), rgba(0, 0, 0, 0.12));
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.2);
}

.command-sector__copy strong {
  font-size: 20px;
}

.command-gate__console {
  grid-template-columns: minmax(280px, 0.72fr) minmax(420px, 1.28fr);
}

.command-gate__context {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.065));
}

.command-gate__access {
  display: flex;
  flex-direction: column;
  background: #ffffff;
  color: #10223a;
  border-color: rgba(255, 255, 255, 0.7);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
}

.command-gate__access .command-gate__resume {
  order: 0;
  padding: 4px 5px 14px;
}

.command-gate__access .command-gate__resume span {
  color: #8a6200;
}

.command-gate__access .command-gate__resume p {
  color: #5f6d80;
}

.command-gate__access .password-console {
  order: 1;
  display: block;
  margin-top: 0;
  border-color: #dbe3ed;
  background: #f7f9fc;
}

.command-gate__access .command-gate__secondary-row {
  order: 2;
  padding: 13px 5px 4px;
}

.command-gate__access .command-gate__secondary-row button,
.command-gate__access .command-gate__resume > button {
  color: #35506f;
}

.command-gate__access .command-gate__secondary-row button:hover,
.command-gate__access .command-gate__secondary-row button.is-active,
.command-gate__access .command-gate__resume > button:hover {
  color: #9a6b00;
}

.command-gate__access .command-unlock {
  order: 3;
  min-height: 54px;
  margin-top: 10px;
  padding: 13px 16px;
  color: #254363;
  border: 1px solid #cdd9e8;
  background: #edf4fb;
  box-shadow: none;
}

.command-gate__access .command-unlock__icon {
  font-size: 25px;
  color: #2f80ed;
}

.command-gate__access .command-unlock small {
  color: #6c7e91;
}

.command-field > span {
  color: #4f6075;
}

.command-field input,
.command-field select {
  color: #14243a;
  border-color: #cfd9e6;
  background: #ffffff;
}

.command-checkbox {
  color: #5c6d81;
}

.password-console__submit {
  min-height: 51px;
  color: #081426;
  border: 0;
  background: linear-gradient(135deg, #f5d65d, #e5b92d);
  box-shadow: 0 12px 26px rgba(212, 166, 24, 0.22);
  font-size: 14px;
}

.password-console__automatic-note {
  display: flex;
  gap: 9px;
  margin: 12px 2px 0;
  color: #607087;
  font-size: 10px;
  line-height: 1.5;
}

.password-console__automatic-note span {
  font-size: 16px;
}

.command-gate__access .command-alert--error {
  order: 4;
}

.command-arrival {
  position: fixed;
  z-index: 15000;
  top: 18px;
  left: 50%;
  width: min(620px, calc(100% - 28px));
  transform: translateX(-50%);
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 16px;
  color: #10223a;
  border: 1px solid rgba(39, 174, 96, 0.36);
  border-radius: 19px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 24px 70px rgba(3, 18, 36, 0.28);
  animation: commandArrivalIn 260ms ease-out;
}

@keyframes commandArrivalIn {
  from { opacity: 0; transform: translate(-50%, -18px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.command-arrival__icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  color: #ffffff;
  border-radius: 14px;
  background: linear-gradient(145deg, #2ecc71, #1e9f54);
  box-shadow: 0 10px 24px rgba(39, 174, 96, 0.24);
  font-weight: 950;
}

.command-arrival__copy {
  min-width: 0;
  flex: 1;
}

.command-arrival__copy small,
.command-arrival__copy strong,
.command-arrival__copy span,
.command-arrival__copy em {
  display: block;
}

.command-arrival__copy small {
  color: #9a6b00;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.command-arrival__copy strong {
  margin-top: 3px;
  font-size: 17px;
}

.command-arrival__copy span {
  margin-top: 3px;
  color: #516177;
  font-size: 12px;
}

.command-arrival__copy em {
  margin-top: 6px;
  color: #16864a;
  font-size: 10px;
  font-style: normal;
  font-weight: 850;
}

.command-arrival > button {
  border: 0;
  color: #68778b;
  background: transparent;
  cursor: pointer;
  font-size: 20px;
}

@media (max-width: 760px) {
  .command-gate {
    min-height: 100dvh;
    overflow: auto;
    padding: 8px;
  }

  .command-gate__grid,
  .command-gate__scan,
  .command-gate__signal-card,
  .command-gate__footer {
    display: none;
  }

  .command-gate__shell {
    padding: 12px;
    border-radius: 22px;
  }

  .command-gate__header {
    padding: 2px 2px 14px;
  }

  .command-gate__mark {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    font-size: 13px;
  }

  .command-gate__brand strong {
    font-size: 18px;
  }

  .command-gate__online {
    font-size: 8px;
    letter-spacing: 0.08em;
  }

  .command-gate__hero {
    display: block;
    padding: 24px 3px 19px;
  }

  .command-gate__hero h1 {
    max-width: 100%;
    font-size: clamp(42px, 14vw, 58px);
    line-height: 0.96;
  }

  .command-gate__lead {
    margin-top: 15px;
    font-size: 14px;
    line-height: 1.55;
  }

  .command-gate__workspace-zone {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding: 2px 1px 11px;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }

  .command-gate__workspace-zone::-webkit-scrollbar {
    display: none;
  }

  .command-sector {
    min-width: min(82vw, 315px);
    min-height: 118px;
    flex: 0 0 auto;
    scroll-snap-align: center;
    padding: 15px;
    border-radius: 20px;
  }

  .command-sector__code {
    width: 52px;
    height: 52px;
    flex-basis: 52px;
    font-size: 27px;
  }

  .command-sector__copy strong {
    font-size: 17px;
  }

  .command-sector__copy em {
    display: block;
    max-width: 190px;
    font-size: 10px;
  }

  .command-gate__console {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 2px;
  }

  .command-gate__access {
    order: 1;
    padding: 13px;
    border-radius: 20px;
  }

  .command-gate__context {
    order: 2;
    padding: 17px;
    border-radius: 19px;
  }

  .command-gate__context > strong {
    font-size: 21px;
  }

  .command-gate__resume {
    align-items: flex-start;
  }

  .command-gate__resume strong {
    font-size: 16px;
  }

  .station-picker {
    grid-template-columns: 1fr;
  }

  .command-unlock b {
    display: none;
  }

  .command-unlock strong {
    font-size: 14px;
  }

  .command-arrival {
    top: 8px;
    width: calc(100% - 16px);
    padding: 13px;
    border-radius: 16px;
  }

  .command-arrival__icon {
    width: 36px;
    height: 36px;
    flex-basis: 36px;
    border-radius: 12px;
  }
}
'''
    write(path, content)


def patch_release_test() -> None:
    path = 'frontend/scripts/commandGateReleaseTests.mjs'
    content = read(path)
    if 'registerPasskey' not in content:
        content = content.replace(
            'assert.match(login, /authenticateWithPasskey/);\n',
            'assert.match(login, /authenticateWithPasskey/);\nassert.match(login, /registerPasskey/);\nassert.match(login, /Checking this device for secure fingerprint/);\nassert.match(login, /isLoggedIn && !loadingMode && commandStage < 0/);\n',
        )
    if 'CommandArrivalBanner' not in content:
        content = content.replace(
            'assert.match(main, /EmergencyCommandOverlay/);\n',
            'assert.match(main, /EmergencyCommandOverlay/);\nassert.match(main, /CommandArrivalBanner/);\n',
        )
    write(path, content)


def main() -> None:
    patch_login()
    add_arrival_banner()
    append_styles()
    patch_release_test()


if __name__ == '__main__':
    main()
