import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import "./publicTechnicalFinish.css";

const RECOVERY_PATHS = Object.freeze([
  ["Businesses", "/businesses", "Enter Spare Parts, Mining or Equipment."],
  ["Equipment", "/equipment", "Explore machines approved for public display."],
  ["Projects", "/projects", "Open the published field archive."],
  ["Newsroom", "/news", "Follow the latest approved company signal."],
  ["Careers", "/careers", "See published opportunities."],
  ["Contact", "/contact", "Start with what you need."],
]);

function ensureMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function isStagingHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".pages.dev") ||
    host.endsWith(".up.railway.app")
  );
}

function currentSocialImage() {
  const image = document.querySelector(
    ".c1-route-stage main .c1-page-hero img, .c1-route-stage main .c1-media img, .c1-route-stage main img"
  );
  if (!(image instanceof HTMLImageElement) || !image.src) return null;
  try {
    const url = new URL(image.src, window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return {
      url: url.href,
      alt: image.alt || "CHALIN ONE published media",
    };
  } catch {
    return null;
  }
}

function syncTechnicalMetadata() {
  const staging = isStagingHost(window.location.hostname);
  ensureMeta('meta[name="robots"]', {
    name: "robots",
    content: staging
      ? "noindex,nofollow,noarchive"
      : "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
  });
  ensureMeta('meta[property="og:site_name"]', {
    property: "og:site_name",
    content: "CHALIN ONE",
  });
  ensureMeta('meta[name="twitter:url"]', {
    name: "twitter:url",
    content: window.location.href,
  });

  const socialImage = currentSocialImage();
  if (socialImage) {
    ensureMeta('meta[property="og:image"]', { property: "og:image", content: socialImage.url });
    ensureMeta('meta[property="og:image:alt"]', { property: "og:image:alt", content: socialImage.alt });
    ensureMeta('meta[name="twitter:image"]', { name: "twitter:image", content: socialImage.url });
    ensureMeta('meta[name="twitter:image:alt"]', { name: "twitter:image:alt", content: socialImage.alt });
  }

  let structured = document.head.querySelector("#chalin-one-public-structured-data");
  if (!structured) {
    structured = document.createElement("script");
    structured.id = "chalin-one-public-structured-data";
    structured.type = "application/ld+json";
    document.head.appendChild(structured);
  }
  structured.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${window.location.origin}/#organization`,
        name: "Chalin 03 Company Limited",
        url: `${window.location.origin}/`,
        logo: `${window.location.origin}/chalin03-logo.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${window.location.origin}/#website`,
        name: "CHALIN ONE",
        url: `${window.location.origin}/`,
        publisher: { "@id": `${window.location.origin}/#organization` },
      },
    ],
  });
}

function useRecoveryTarget(pathname) {
  const [target, setTarget] = useState(null);

  useEffect(() => {
    setTarget(null);
    let active = true;
    let observer;

    const resolve = () => {
      if (!active) return false;
      const node = document.querySelector(".c1-route-stage main.c1-not-found > div");
      if (!node) return false;
      setTarget(node);
      return true;
    };

    if (!resolve()) {
      observer = new MutationObserver(() => {
        if (resolve()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [pathname]);

  return target;
}

function RecoveryPanel({ pathname }) {
  return (
    <section className="c1-recovery-panel" aria-label="CHALIN ONE recovery navigation">
      <header>
        <span>RECOVER THE JOURNEY</span>
        <p>Requested path: <code>{pathname}</code></p>
      </header>
      <div>
        {RECOVERY_PATHS.map(([label, path, text]) => (
          <Link to={path} key={path}>
            <strong>{label}</strong>
            <p>{text}</p>
            <b>↗</b>
          </Link>
        ))}
      </div>
      <small>Tip: press <kbd>/</kbd> anywhere on the public website to search published CHALIN ONE content.</small>
    </section>
  );
}

export default function PublicTechnicalFinish() {
  const location = useLocation();
  const previousPath = useRef(null);
  const recoveryTarget = useRecoveryTarget(location.pathname);

  useEffect(() => {
    document.documentElement.lang = document.documentElement.lang || "en";

    const first = window.setTimeout(() => {
      syncTechnicalMetadata();
      const main = document.querySelector(".c1-route-stage main");
      if (!main) return;
      main.setAttribute("tabindex", "-1");
      if (previousPath.current && previousPath.current !== location.pathname) {
        try {
          main.focus({ preventScroll: true });
        } catch {
          main.focus();
        }
      }
      previousPath.current = location.pathname;
    }, 120);

    const second = window.setTimeout(syncTechnicalMetadata, 850);

    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [location.pathname, location.search]);

  return recoveryTarget
    ? createPortal(<RecoveryPanel pathname={location.pathname} />, recoveryTarget)
    : null;
}
