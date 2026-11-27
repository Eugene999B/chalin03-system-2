import { useEffect } from "react";

const PRIVATE_TITLE = "Chalin 03 Group Operations Platform";
const PRIVATE_DESCRIPTION =
  "Secure staff operations portal for Chalin 03 Company Limited.";

function ensureMeta(attribute, key) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  return element;
}

function ensureCanonical() {
  let element = document.head.querySelector('link[rel="canonical"]');

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }

  return element;
}

function setMeta(attribute, key, content) {
  ensureMeta(attribute, key).setAttribute("content", content);
}

function applyPrivateMetadata() {
  document.title = PRIVATE_TITLE;
  setMeta("name", "description", PRIVATE_DESCRIPTION);
  setMeta("name", "robots", "noindex, nofollow, noarchive");
  setMeta("property", "og:title", PRIVATE_TITLE);
  setMeta("property", "og:description", PRIVATE_DESCRIPTION);
  setMeta("property", "og:type", "website");
  setMeta("name", "twitter:card", "summary");
  ensureCanonical().setAttribute("href", "https://chalin03.com/login");
}

export default function PublicPageMeta({
  title,
  description,
  canonicalPath,
}) {
  useEffect(() => {
    const pageTitle = String(title || "Chalin 03 Company Limited").trim();
    const pageDescription = String(
      description ||
        "Chalin 03 Company Limited provides spare-parts, mining-operations and equipment-hire services in Ghana."
    ).trim();
    const safePath = String(canonicalPath || "/company/").startsWith("/")
      ? String(canonicalPath || "/company/")
      : `/${canonicalPath}`;
    // Dedicated public hostnames canonicalize to their own landing page when
    // the same division is visited at the root. Existing apex paths remain
    // canonical for direct /excavators, /shop and other internal links.
    const publicHomeHosts = {
      "homepage.chalin03.com":"/",
      "spareparts.chalin03.com":"/shop",
      "excavators.chalin03.com":"/excavators",
      "machines.chalin03.com":"/heavy-machines",
      "motorcycles.chalin03.com":"/motorcycles",
      "automobiles.chalin03.com":"/automobiles",
      "gold.chalin03.com":"/gold",
      "transport.chalin03.com":"/machine-transport",
      "hire.chalin03.com":"/equipment-hire-services",
      "help.chalin03.com":"/customer-help",
    };
    const hostname = window.location.hostname.toLowerCase();
    const officialLanding = publicHomeHosts[hostname] === safePath && window.location.pathname === "/";
    const preferredHost=Object.entries(publicHomeHosts).find(([,path])=>path===safePath)?.[0];
    const canonicalUrl = officialLanding ? window.location.origin + "/" : preferredHost ? `https://${preferredHost}/` : `https://homepage.chalin03.com${safePath}`;

    document.title = pageTitle;
    setMeta("name", "description", pageDescription);
    setMeta("name", "robots", "index, follow, max-image-preview:large");
    setMeta("property", "og:site_name", "Chalin 03 Company Limited");
    setMeta("property", "og:title", pageTitle);
    setMeta("property", "og:description", pageDescription);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:image", "https://homepage.chalin03.com/chalin03-logo.png");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", pageTitle);
    setMeta("name", "twitter:description", pageDescription);
    ensureCanonical().setAttribute("href", canonicalUrl);

    return applyPrivateMetadata;
  }, [canonicalPath, description, title]);

  return null;
}
