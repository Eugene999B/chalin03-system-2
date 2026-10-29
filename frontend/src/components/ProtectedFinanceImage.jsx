import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const IMAGE_TIMEOUT_MS = 12000;

// Phase-One bootstrap images are signed absolute URLs, not professional
// register protected-image paths. Rebase only valid signed Finance links to
// the configured API, so bearer credentials never go to an external host.
export function signedFinanceImagePath(value, expectedAssetId) {
  const source = String(value || "").trim();
  if (!source || !Number.isSafeInteger(expectedAssetId) || expectedAssetId < 1) return "";
  let url;
  try {
    url = new URL(source, "https://chalin03.invalid");
  } catch {
    return "";
  }
  const match = url.pathname.match(
    /^\/(?:api\/)?equipment-catalogue\/sales\/phase-one\/machine-image\/([1-9]\d*)\/(legacy|[1-9]\d*)$/
  );
  if (!match || Number(match[1]) !== expectedAssetId) return "";
  const expires = url.searchParams.get("expires") || "";
  const signature = url.searchParams.get("signature") || "";
  if (!/^\d{10,12}$/.test(expires) || !/^[0-9a-f]{64}$/i.test(signature)) return "";
  const photoId = match[2];
  return "/equipment-catalogue/sales/phase-one/machine-image/" +
    expectedAssetId + "/" + photoId + "?expires=" + expires + "&signature=" + signature;
}

export function financeMachineImagePath(machine = {}) {
  if (machine.main_image_path) return machine.main_image_path;
  const media = Array.isArray(machine.media) ? machine.media : [];
  const primary = media.find((item) => item.is_primary && item.image_path);
  const first = media.find((item) => item.image_path);
  if (primary?.image_path || first?.image_path) {
    return primary?.image_path || first.image_path;
  }

  const assetId = Number(machine.id);
  if (!Number.isSafeInteger(assetId) || assetId < 1) return "";
  const signedPrimary = signedFinanceImagePath(machine.main_image_url, assetId);
  const signedMedia = media.map((item) => signedFinanceImagePath(item.file_url, assetId)).find(Boolean);
  if (signedPrimary || signedMedia) return signedPrimary || signedMedia;
  const legacyPrimary = media.find((item) => item.is_primary && Number(item.id) > 0);
  const legacyFirst = media.find((item) => Number(item.id) > 0);
  const photoId = Number(legacyPrimary?.id || legacyFirst?.id || 0);
  if (Number.isSafeInteger(photoId) && photoId > 0) {
    return `/equipment-catalogue/sales/protected-images/assets/${assetId}/${photoId}`;
  }
  if (machine.has_legacy_image || machine.main_image_url) {
    return `/equipment-catalogue/sales/protected-images/assets/${assetId}/legacy`;
  }
  return "";
}

// Only permit Finance API-relative image paths. The Axios interceptor adds
// the active staff bearer, so external/image-data URLs must never reach it.
export function normalizeFinanceImageSource(value) {
  const source = String(value || "").trim();
  const apiPath = source.startsWith("/api/") ? source.slice(4) : source;
  if (!/^\/equipment-catalogue\/sales\/[a-zA-Z0-9/?=&._%-]+$/.test(apiPath)) return "";
  return apiPath;
}

function responseMimeType(response) {
  const header =
    response?.headers?.get?.("content-type") ||
    response?.headers?.["content-type"] ||
    response?.data?.type ||
    "";
  return String(header).split(";")[0].trim().toLowerCase();
}

export default function ProtectedFinanceImage({
  src,
  alt,
  className = "",
  fallback = "🚜",
  onClick,
  eager = false,
}) {
  const normalizedSource = normalizeFinanceImageSource(src);
  const [attempt, setAttempt] = useState(0);
  const [objectUrl, setObjectUrl] = useState("");
  const [state, setState] = useState(normalizedSource ? "loading" : "no-photo");

  useEffect(() => {
    if (!normalizedSource) {
      setObjectUrl("");
      setState("no-photo");
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    let createdUrl = "";
    setObjectUrl("");
    setState("loading");

    axiosClient
      .get(normalizedSource, {
        responseType: "blob",
        signal: controller.signal,
        timeout: IMAGE_TIMEOUT_MS,
        headers: { Accept: "image/*" },
      })
      .then((response) => {
        if (!active) return;
        const mimeType = responseMimeType(response);
        const blob =
          response.data instanceof Blob
            ? response.data
            : new Blob([response.data], { type: mimeType });
        if (response.status !== 200) {
          throw new Error("The protected picture request did not return HTTP 200.");
        }
        if (!mimeType.startsWith("image/") || !String(blob.type || mimeType).startsWith("image/")) {
          throw new Error("The protected picture response is not an image.");
        }
        if (blob.size < 1) {
          throw new Error("The protected picture response is empty.");
        }
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch((error) => {
        if (!active || error?.code === "ERR_CANCELED") return;
        setObjectUrl("");
        setState("failed");
      });

    return () => {
      active = false;
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attempt, normalizedSource]);

  const clickable = typeof onClick === "function";
  const classes = useMemo(
    () => ["finance-protected-image", className].filter(Boolean).join(" "),
    [className]
  );

  function openImage() {
    if (clickable && state === "ready") onClick();
  }

  function handleKeyDown(event) {
    if (!clickable || state !== "ready") return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  function handleImageLoad(event) {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setState("ready");
    } else {
      setState("failed");
    }
  }

  return (
    <div
      className={classes}
      data-testid="finance-protected-image"
      data-image-state={state}
      role={clickable && state === "ready" ? "button" : undefined}
      tabIndex={clickable && state === "ready" ? 0 : undefined}
      onClick={openImage}
      onKeyDown={handleKeyDown}
      aria-label={clickable && state === "ready" ? `View full photo of ${alt}` : undefined}
    >
      {state === "no-photo" ? (
        <span className="finance-protected-image__fallback" aria-label="No excavator photo">
          {fallback}
        </span>
      ) : null}
      {state === "loading" ? (
        <span className="finance-protected-image__status">Loading photo…</span>
      ) : null}
      {objectUrl ? (
        <img
          src={objectUrl}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={handleImageLoad}
          onError={() => setState("failed")}
        />
      ) : null}
      {state === "failed" ? (
        <span className="finance-protected-image__error" role="status">
          <b>Photo unavailable</b>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setAttempt((current) => current + 1);
            }}
          >
            Retry
          </button>
        </span>
      ) : null}
    </div>
  );
}

export { IMAGE_TIMEOUT_MS };