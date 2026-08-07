import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import PublicHomepageExperience from "./PublicHomepageExperience";
import PublicWebsiteApp from "./PublicWebsiteApp";
import {
  getPublicHomepage,
  publicWebsiteErrorMessage,
} from "./publicWebsiteApi";

const PUBLIC_ROOT = "/website";

export default function PublicWebsiteStandaloneApp() {
  const location = useLocation();
  const isRoot =
    location.pathname === PUBLIC_ROOT || location.pathname === `${PUBLIC_ROOT}/`;
  const [state, setState] = useState({
    loading: isRoot,
    page: null,
    error: "",
  });

  useEffect(() => {
    if (!isRoot) {
      setState({ loading: false, page: null, error: "" });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setState({ loading: true, page: null, error: "" });

    getPublicHomepage({ signal: controller.signal })
      .then((page) => {
        if (active && !controller.signal.aborted) {
          setState({ loading: false, page, error: "" });
        }
      })
      .catch((error) => {
        if (active && !controller.signal.aborted) {
          setState({
            loading: false,
            page: null,
            error: publicWebsiteErrorMessage(error),
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isRoot]);

  if (isRoot && state.loading) {
    return (
      <main className="pw-unavailable" role="status" aria-live="polite">
        <div>
          <img className="c1h-loading-logo" src="/chalin03-logo.png" alt="" />
          <h1>Opening published homepage…</h1>
          <p>Checking the latest approved CHALIN ONE homepage.</p>
        </div>
      </main>
    );
  }

  if (isRoot && state.error) {
    return (
      <main className="pw-unavailable" role="alert">
        <div>
          <span className="pw-brand-mark" aria-hidden="true">C1</span>
          <h1>Homepage unavailable</h1>
          <p>{state.error}</p>
        </div>
      </main>
    );
  }

  if (isRoot && state.page?.slug) {
    return <PublicHomepageExperience page={state.page} />;
  }

  return <PublicWebsiteApp />;
}
