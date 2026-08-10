import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import {
  getPublicDataUseDisclosure,
  recordPublicPageView,
} from "./publicAnalyticsApi";
import "./publicAnalyticsRuntime.css";

function disclosureItems(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export default function PublicAnalyticsRuntime() {
  const location = useLocation();
  const [footerTarget, setFooterTarget] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [disclosure, setDisclosure] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    recordPublicPageView(location.pathname, { signal: controller.signal }).catch(() => {
      // Aggregate analytics is optional and must never interfere with browsing.
    });
    return () => controller.abort();
  }, [location.pathname]);

  useEffect(() => {
    const findTarget = () => {
      const target = document.querySelector(".c1-footer-bottom");
      if (target) setFooterTarget(target);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open || disclosure || loading) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getPublicDataUseDisclosure({ signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setDisclosure(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("The data-use details could not be loaded right now.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [disclosure, loading, open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const analytics = disclosure?.analytics || {};
  const forms = disclosure?.forms || {};

  return (
    <>
      {footerTarget
        ? createPortal(
            <button
              type="button"
              className="c1-data-use-link"
              onClick={() => setOpen(true)}
            >
              Data use
            </button>,
            footerTarget
          )
        : null}

      {open
        ? createPortal(
            <div className="c1-data-use-dialog" role="dialog" aria-modal="true" aria-labelledby="c1-data-use-title">
              <button
                type="button"
                className="c1-data-use-backdrop"
                aria-label="Close data use notice"
                onClick={() => setOpen(false)}
              />
              <section className="c1-data-use-panel">
                <header>
                  <div>
                    <span>CHALIN ONE / PUBLIC DATA USE</span>
                    <h2 id="c1-data-use-title">What this website records.</h2>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close data use notice">
                    Close ×
                  </button>
                </header>

                {loading ? (
                  <p role="status">Loading the current data-use disclosure…</p>
                ) : error ? (
                  <p role="alert">{error}</p>
                ) : (
                  <div className="c1-data-use-grid">
                    <article>
                      <span>AGGREGATE WEBSITE ANALYTICS</span>
                      <h3>{analytics.purpose || "Understand aggregate use of published CHALIN ONE pages."}</h3>
                      <p>The public counter is deliberately non-identifying. It groups page views by UTC date and published route.</p>
                      <strong>Stored</strong>
                      <ul>
                        {disclosureItems(analytics.storage).map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </article>
                    <article>
                      <span>EXCLUDED FROM ANALYTICS</span>
                      <h3>No visitor profile is created.</h3>
                      <ul>
                        {disclosureItems(analytics.excluded).map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </article>
                    <article>
                      <span>PUBLIC FORMS</span>
                      <h3>{forms.purpose || "Process information a visitor chooses to submit."}</h3>
                      <p>{forms.note || "Form submissions are handled separately and are not copied into aggregate page-view analytics."}</p>
                    </article>
                  </div>
                )}

                <footer>
                  <span>No analytics cookie · no persistent visitor ID · no staff activity</span>
                  <button type="button" onClick={() => setOpen(false)}>Done</button>
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
