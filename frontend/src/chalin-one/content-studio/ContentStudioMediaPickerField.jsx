import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import { listMediaPro } from "./contentStudioMediaProApi";
import {
  formatMediaBytes,
  mediaDimensions,
} from "./contentStudioMediaProModel";
import { CONTENT_STUDIO_PERMISSIONS } from "./contentStudioModel";
import "./contentStudioMediaPickerField.css";

function cleanId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function assetName(asset = {}) {
  return asset.display_name || asset.original_filename || asset.asset_key || `Asset #${asset.id || ""}`;
}

function matchesAcceptedType(asset, accept) {
  if (!accept || accept === "any") return true;
  if (Array.isArray(accept)) return accept.includes(asset?.media_type);
  return asset?.media_type === accept;
}

function MediaThumb({ asset }) {
  if (asset?.media_type === "image" && asset?.public_url) {
    return (
      <img
        src={asset.public_url}
        alt={asset.alt_text || assetName(asset)}
        loading="lazy"
      />
    );
  }
  return (
    <div className="cs-media-picker-placeholder" aria-hidden="true">
      <span>{asset?.media_type === "video" ? "VIDEO" : "MEDIA"}</span>
      <strong>{String(asset?.file_extension || asset?.media_type || "asset").toUpperCase()}</strong>
    </div>
  );
}

export default function ContentStudioMediaPickerField({
  label = "Media asset",
  value = "",
  onChange,
  disabled = false,
  required = false,
  hint = "Choose from public-ready Media Library assets.",
  accept = "image",
  allowClear = true,
}) {
  const auth = useAuth();
  const canViewMedia = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.mediaView);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [orientation, setOrientation] = useState("");
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const closeButtonRef = useRef(null);
  const triggerRef = useRef(null);
  const cleanValue = cleanId(value);

  const acceptedLabel = useMemo(() => {
    if (!accept || accept === "any") return "media";
    if (Array.isArray(accept)) return accept.join(" / ");
    return accept;
  }, [accept]);

  const load = useCallback(async ({ signal } = {}) => {
    if (!open || !canViewMedia) return;
    setLoading(true);
    setError("");
    try {
      const mediaType = Array.isArray(accept) || accept === "any" ? "" : accept;
      const result = await listMediaPro(
        {
          media_type: mediaType,
          visibility: "public",
          readiness: "public_ready",
          search,
          orientation,
          sort: "newest",
          limit: 60,
          offset: 0,
        },
        { signal }
      );
      if (signal?.aborted) return;
      const items = (Array.isArray(result?.items) ? result.items : []).filter((asset) =>
        matchesAcceptedType(asset, accept)
      );
      setAssets(items);
      setTotal(Number(result?.total || items.length));
      if (cleanValue) {
        const current = items.find((asset) => Number(asset.id) === cleanValue) || null;
        if (current) setSelectedAsset(current);
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [accept, canViewMedia, cleanValue, open, orientation, search]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => load({ signal: controller.signal }), 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function choose(asset) {
    setSelectedAsset(asset);
    onChange?.(String(asset.id), asset);
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function clear() {
    setSelectedAsset(null);
    onChange?.("", null);
  }

  return (
    <div className="cs-media-picker-field">
      <div className="cs-media-picker-field-label">
        <span>{label}</span>
        {required ? <b>Required</b> : null}
      </div>
      <div className="cs-media-picker-control">
        <button
          ref={triggerRef}
          type="button"
          className="cs-media-picker-trigger"
          disabled={disabled || !canViewMedia}
          onClick={() => setOpen(true)}
        >
          <span className="cs-media-picker-trigger-mark">ML</span>
          <span>
            <strong>{cleanValue ? selectedAsset ? assetName(selectedAsset) : `Media asset #${cleanValue}` : `Choose ${acceptedLabel}`}</strong>
            <small>{cleanValue ? `Selected asset ID ${cleanValue}` : "Search the governed Media Library"}</small>
          </span>
          <b>Choose ↗</b>
        </button>
        {cleanValue && allowClear && !disabled ? (
          <button type="button" className="cs-media-picker-clear" onClick={clear} aria-label={`Clear ${label}`}>Clear</button>
        ) : null}
      </div>
      {hint ? <small className="cs-media-picker-hint">{hint}</small> : null}
      {!canViewMedia ? <small className="cs-media-picker-hint is-warning">Your Studio role does not include Media Library access.</small> : null}

      {open ? (
        <div className="cs-media-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-media-picker-title">
          <button type="button" className="cs-media-picker-backdrop" aria-label="Close Media Library picker" onClick={() => setOpen(false)} />
          <section className="cs-media-picker-panel">
            <header className="cs-media-picker-head">
              <div>
                <span>GOVERNED MEDIA PICKER</span>
                <h2 id="cs-media-picker-title">Choose publication-ready {acceptedLabel}</h2>
                <p>Only public assets that pass Media Library processing, HTTPS delivery and image accessibility checks are offered here.</p>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)}>Close ×</button>
            </header>

            <div className="cs-media-picker-filters">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, filename, alt text, caption or credit"
                autoFocus
              />
              <select value={orientation} onChange={(event) => setOrientation(event.target.value)}>
                <option value="">Any orientation</option>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
                <option value="square">Square</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            {error ? <div className="cs-media-picker-error" role="alert"><span>{error}</span><button type="button" onClick={() => load()}>Retry</button></div> : null}
            <div className="cs-media-picker-result-meta"><strong>{assets.length} shown</strong><span>{total.toLocaleString("en-GH")} matching assets</span></div>

            <div className="cs-media-picker-grid" aria-busy={loading ? "true" : "false"}>
              {assets.map((asset) => (
                <button
                  type="button"
                  key={asset.id}
                  className={Number(asset.id) === cleanValue ? "is-current" : ""}
                  onClick={() => choose(asset)}
                >
                  <div className="cs-media-picker-thumb"><MediaThumb asset={asset} />{Number(asset.id) === cleanValue ? <b>CURRENT</b> : null}</div>
                  <div className="cs-media-picker-copy">
                    <strong>{assetName(asset)}</strong>
                    <span>{asset.folder_name || "Uncategorized"}</span>
                    <small>{mediaDimensions(asset)} · {formatMediaBytes(asset.file_size_bytes)}</small>
                  </div>
                  <div className="cs-media-picker-foot"><span>{asset.usage_count || 0} ref{Number(asset.usage_count || 0) === 1 ? "" : "s"}</span><b>Select</b></div>
                </button>
              ))}
            </div>
            {loading ? <div className="cs-media-picker-empty">Loading approved media…</div> : null}
            {!loading && !error && !assets.length ? <div className="cs-media-picker-empty"><strong>No publication-ready assets match.</strong><span>Use Media Library Pro to process media, add alt text and make the asset public first.</span></div> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
