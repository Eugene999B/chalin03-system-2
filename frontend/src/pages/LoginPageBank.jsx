import { useEffect, useRef, useState } from "react";
import LoginPageV4 from "./LoginPageV4.jsx";
import "../styles/commandGateBankPolish.css";

const TOKEN_KEY = "chalin03_token";
const ARRIVAL_KEY = "chalin03_command_arrival";

function FingerprintIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M15 20c1-6 5-9 10-9 7 0 12 5 12 12 0 8-2 14-6 20" />
      <path d="M10 24c0-9 6-16 15-16 10 0 17 7 17 17" />
      <path d="M16 26c0-6 3-10 9-10 5 0 8 4 8 9 0 8-2 13-5 18" />
      <path d="M22 26c0-2 1-4 3-4s3 2 3 4c0 7-1 12-3 17" />
      <path d="M10 31c1 5 3 9 7 12" />
    </svg>
  );
}

export default function LoginPageBank() {
  const [biometricState, setBiometricState] = useState(null);
  const startingTokenRef = useRef("");
  const timersRef = useRef([]);

  useEffect(() => {
    function clearTimers() {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    }

    function showWaitingState() {
      clearTimers();
      startingTokenRef.current = localStorage.getItem(TOKEN_KEY) || "";
      setBiometricState("waiting");

      const timeout = window.setTimeout(() => {
        setBiometricState(null);
      }, 15000);
      timersRef.current.push(timeout);
    }

    function handleClick(event) {
      const button = event.target.closest(
        ".gate2__secondary-actions button:first-child"
      );
      if (button && !button.disabled) {
        showWaitingState();
      }
    }

    const observer = new MutationObserver(() => {
      if (!biometricState) return;

      const currentToken = localStorage.getItem(TOKEN_KEY) || "";
      const arrivalReady = Boolean(sessionStorage.getItem(ARRIVAL_KEY));
      const hasError = Boolean(document.querySelector(".gate2__alert--error"));

      if (
        (currentToken && currentToken !== startingTokenRef.current) ||
        arrivalReady
      ) {
        clearTimers();
        setBiometricState("verified");
        const verifiedTimer = window.setTimeout(() => {
          setBiometricState(null);
        }, 700);
        timersRef.current.push(verifiedTimer);
        return;
      }

      if (hasError) {
        clearTimers();
        setBiometricState(null);
      }
    });

    document.addEventListener("click", handleClick, true);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    return () => {
      clearTimers();
      document.removeEventListener("click", handleClick, true);
      observer.disconnect();
    };
  }, [biometricState]);

  return (
    <>
      <LoginPageV4 />

      {biometricState && (
        <div className="bank-bio" role="status" aria-live="polite">
          <div className={`bank-bio__sheet is-${biometricState}`}>
            <img
              src="/chalin03-logo.png"
              alt="Chalin 03 Company Limited"
            />

            <div className="bank-bio__fingerprint">
              <FingerprintIcon />
              <i />
            </div>

            <small>Secure device sign-in</small>
            <h2>
              {biometricState === "verified"
                ? "Identity verified"
                : "Verify to continue"}
            </h2>
            <p>
              {biometricState === "verified"
                ? "Your face, fingerprint or device PIN has been accepted."
                : "Use your face, fingerprint, Windows Hello or device PIN in the system prompt."}
            </p>

            <div className="bank-bio__status">
              <i />
              {biometricState === "verified"
                ? "Secure verification complete"
                : "Waiting for device verification"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
