import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  archiveMediaAsset,
  archiveMediaFolder,
  createMediaFolder,
  getMediaUsage,
  listMediaFolders,
  registerMediaVideo,
  updateMediaAsset,
  updateMediaFolder,
  uploadMediaImage,
} from "./contentStudioOperationsApi";
import {
  getMediaLibraryIntelligence,
  listMediaPro,
} from "./contentStudioMediaProApi";
import {
  formatMediaBytes,
  mediaDimensions,
  mediaHealthTone,
  mediaReadinessIssues,
  mediaVariantList,
  normalizeMediaIntelligence,
} from "./contentStudioMediaProModel";
import { CONTENT_STUDIO_PERMISSIONS } from "./contentStudioModel";
import "./contentStudioMediaPro.css";

const EMPTY_ASSET = Object.freeze({
  display_name: "",
  alt_text: "",
  caption: "",
  credit: "",
  folder_id: "",
  visibility: "private",
});
const EMPTY_VIDEO = Object.freeze({
  url: "",
  display_name: "",
  original_filename: "external-video",
  alt_text: "",
  caption: "",
  credit: "",
  duration_seconds: "",
  folder_id: "",
});
const EMPTY_FOLDER = Object.freeze({
  folder_key: "",
  name: "",
  description: "",
  parent_id: "",
  sort_order: 0,
});
const EMPTY_FILTERS = Object.freeze({
  search: "",
  media_type: "",
  visibility: "",
  processing_status: "",
  folder_id: "",
  readiness: "",
  usage: "",
  alt_status: "",
  duplicate: "",
  orientation: "",
  min_width: "",
  max_width: "",
  sort: "newest",
});

function Field({ label, hint, children }) {
  return <label className="cs-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Notice({ error, message, clear }) {
  const value = error || message;
  if (!value) return null;
  return (
    <div className={`cs-media-pro-notice ${error ? "is-error" : "is-success"}`} role={error ? "alert" : "status"}>
      <div><strong>{error ? "Action not completed" : "Media Library updated"}</strong><span>{value}</span></div>
      <button type="button" onClick={clear}>Close</button>
    </div>
  );
}

function Status({ tone = "neutral", children }) {
  return <span className={`cs-media-pro-status is-${tone}`}>{children}</span>;
}

function AssetThumb({ asset, large = false }) {
  const name = asset.display_name || asset.original_filename || "Media asset";
  if (asset.media_type === "image" && asset.public_url) {
    return <img className={large ? "is-large" : ""} src={asset.public_url} alt={asset.alt_text || name} loading="lazy" />;
  }
  return (
    <div className={`cs-media-pro-placeholder ${large ? "is-large" : ""}`} aria-label={`${asset.media_type || "media"} preview`}>
      <span>{asset.media_type === "video" ? "VIDEO" : "FILE"}</span>
      <strong>{String(asset.file_extension || asset.media_type || "asset").toUpperCase()}</strong>
    </div>
  );
}

function Kpi({ label, value, note, tone = "", onClick }) {
  const body = <><span>{label}</span><strong>{value}</strong><small>{note}</small></>;
  return onClick ? <button type="button" className={`cs-media-pro-kpi ${tone ? `is-${tone}` : ""}`} onClick={onClick}>{body}</button> : <article className={`cs-media-pro-kpi ${tone ? `is-${tone}` : ""}`}>{body}</article>;
}

function compactName(asset) {
  return asset?.display_name || asset?.original_filename || asset?.asset_key || `Asset #${asset?.id || ""}`;
}

export default function ContentStudioMediaManagerPro() {
  const auth = useAuth();
  const canManage = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.mediaManage);
  const [tab, setTab] = useState("library");
  const [view, setView] = useState("grid");
  const [assets, setAssets] = useState([]);
  const [folders, setFolders] = useState([]);
  const [intelligence, setIntelligence] = useState(() => normalizeMediaIntelligence());
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterForm, setFilterForm] = useState({ ...EMPTY_FILTERS });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetForm, setAssetForm] = useState({ ...EMPTY_ASSET });
  const [usage, setUsage] = useState([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [uploadForm, setUploadForm] = useState({ ...EMPTY_ASSET });
  const [videoForm, setVideoForm] = useState({ ...EMPTY_VIDEO });
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [folderForm, setFolderForm] = useState({ ...EMPTY_FOLDER });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const folderOptions = useMemo(
    () => folders.map((folder) => ({ value: String(folder.id), label: folder.name })),
    [folders]
  );
  const variants = useMemo(() => mediaVariantList(selectedAsset || {}), [selectedAsset]);
  const readinessIssues = useMemo(() => mediaReadinessIssues(selectedAsset || {}), [selectedAsset]);
  const pageSize = 40;

  const loadLibrary = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listMediaPro({ ...filters, limit: pageSize, offset }, { signal });
      if (!signal?.aborted) {
        setAssets(Array.isArray(result?.items) ? result.items : []);
        setTotal(Number(result?.total || 0));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filters, offset]);

  const loadIntelligence = useCallback(async ({ signal } = {}) => {
    try {
      const result = await getMediaLibraryIntelligence({ signal });
      if (!signal?.aborted) setIntelligence(normalizeMediaIntelligence(result || {}));
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    }
  }, []);

  const loadFolders = useCallback(async ({ signal } = {}) => {
    try {
      const result = await listMediaFolders({ signal });
      if (!signal?.aborted) setFolders(Array.isArray(result) ? result : []);
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    }
  }, []);

  const refreshAll = useCallback(async ({ signal } = {}) => {
    await Promise.all([loadLibrary({ signal }), loadIntelligence({ signal }), loadFolders({ signal })]);
  }, [loadFolders, loadIntelligence, loadLibrary]);

  useEffect(() => {
    const controller = new AbortController();
    refreshAll({ signal: controller.signal });
    return () => controller.abort();
  }, [refreshAll]);

  async function chooseAsset(asset) {
    setSelectedAsset(asset);
    setAssetForm({
      display_name: asset.display_name || "",
      alt_text: asset.alt_text || "",
      caption: asset.caption || "",
      credit: asset.credit || "",
      folder_id: asset.folder_id || "",
      visibility: asset.visibility || "private",
    });
    setUsage([]);
    setUsageLoading(true);
    setError("");
    try {
      const result = await getMediaUsage(asset.id);
      setUsage(Array.isArray(result) ? result : Array.isArray(result?.usage) ? result.usage : []);
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setUsageLoading(false);
    }
  }

  async function runMutation(action, message) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(message);
      await Promise.all([loadLibrary(), loadIntelligence(), loadFolders()]);
      return result;
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
      return null;
    } finally {
      setSaving(false);
    }
  }

  function applyFilters(event) {
    event?.preventDefault?.();
    setOffset(0);
    setFilters({ ...filterForm });
  }

  function resetFilters() {
    setOffset(0);
    setFilterForm({ ...EMPTY_FILTERS });
    setFilters({ ...EMPTY_FILTERS });
  }

  function quickFilter(patch) {
    const next = { ...EMPTY_FILTERS, ...patch };
    setFilterForm(next);
    setFilters(next);
    setOffset(0);
    setTab("library");
  }

  async function saveAsset(event) {
    event.preventDefault();
    if (!selectedAsset) return;
    const result = await runMutation(
      () => updateMediaAsset(selectedAsset.id, assetForm),
      "Media metadata and visibility were updated safely."
    );
    if (result) await chooseAsset({ ...selectedAsset, ...result });
  }

  async function archiveAsset() {
    if (!selectedAsset || usageLoading || usage.length > 0) return;
    if (!window.confirm(`Archive “${compactName(selectedAsset)}”? The backend will re-check all references before completing the action.`)) return;
    const result = await runMutation(
      () => archiveMediaAsset(selectedAsset.id, "Archived from Media Library Pro"),
      "The unused asset was archived without deleting its stored object."
    );
    if (result) {
      setSelectedAsset(null);
      setUsage([]);
    }
  }

  async function uploadImage(event) {
    event.preventDefault();
    if (!imageFile) {
      setError("Choose a JPEG, PNG or WebP image first.");
      return;
    }
    const result = await runMutation(
      () => uploadMediaImage(imageFile, uploadForm),
      "The image was decoded, re-encoded and indexed safely."
    );
    if (!result) return;
    if (result.duplicate && result.asset) {
      setNotice(`Duplicate detected. Existing asset “${compactName(result.asset)}” was reused instead of storing another copy.`);
      await chooseAsset(result.asset);
      setTab("library");
    } else {
      setImageFile(null);
      setUploadForm({ ...EMPTY_ASSET });
    }
  }

  async function registerVideo(event) {
    event.preventDefault();
    const result = await runMutation(
      () => registerMediaVideo({
        ...videoForm,
        duration_seconds: videoForm.duration_seconds === "" ? null : Number(videoForm.duration_seconds),
        folder_id: videoForm.folder_id || null,
      }),
      "The approved external video was registered safely."
    );
    if (result) setVideoForm({ ...EMPTY_VIDEO });
  }

  function chooseFolder(folder) {
    setSelectedFolder(folder);
    setFolderForm({
      folder_key: folder.folder_key || "",
      name: folder.name || "",
      description: folder.description || "",
      parent_id: folder.parent_id || "",
      sort_order: Number(folder.sort_order || 0),
    });
  }

  async function saveFolder(event) {
    event.preventDefault();
    const payload = {
      ...folderForm,
      parent_id: folderForm.parent_id || null,
      sort_order: Number(folderForm.sort_order) || 0,
    };
    const result = await runMutation(
      () => selectedFolder ? updateMediaFolder(selectedFolder.id, payload) : createMediaFolder(payload),
      selectedFolder ? "Media folder updated safely." : "Media folder created safely."
    );
    if (result) {
      setSelectedFolder(null);
      setFolderForm({ ...EMPTY_FOLDER });
    }
  }

  async function archiveFolder() {
    if (!selectedFolder || !window.confirm("Archive this folder? Active child folders or media will block the action.")) return;
    const result = await runMutation(
      () => archiveMediaFolder(selectedFolder.id, "Archived from Media Library Pro"),
      "The empty media folder was archived safely."
    );
    if (result) {
      setSelectedFolder(null);
      setFolderForm({ ...EMPTY_FOLDER });
    }
  }

  const summary = intelligence.summary;

  return (
    <div className="cs-media-pro-shell">
      <section className="cs-media-pro-hero">
        <div className="cs-media-pro-mark" aria-hidden="true">ML</div>
        <div><span>ASSET INTELLIGENCE / PHASE 2G</span><h2>Media Library Pro</h2><p>Find, judge, fix and safely retire every public website asset from one governed digital asset workspace.</p></div>
        <div className="cs-media-pro-health"><strong>{summary.publicReady}/{summary.total}</strong><span>public-ready assets</span></div>
      </section>

      <Notice error={error} message={notice} clear={() => { setError(""); setNotice(""); }} />

      <section className="cs-media-pro-kpis">
        <Kpi label="TOTAL ASSETS" value={summary.total} note={formatMediaBytes(summary.totalBytes)} onClick={() => quickFilter({})} />
        <Kpi label="PUBLIC READY" value={summary.publicReady} note="safe URL + processing + alt" tone="success" onClick={() => quickFilter({ readiness: "public_ready" })} />
        <Kpi label="MISSING ALT" value={summary.missingAlt} note="image accessibility queue" tone={summary.missingAlt ? "warning" : ""} onClick={() => quickFilter({ media_type: "image", alt_status: "missing" })} />
        <Kpi label="UNUSED" value={summary.unused} note="no indexed references" onClick={() => quickFilter({ usage: "unused" })} />
        <Kpi label="DUPLICATES" value={summary.duplicateAssets} note={`${summary.duplicateGroups} checksum groups`} tone={summary.duplicateAssets ? "warning" : ""} onClick={() => quickFilter({ duplicate: "duplicate" })} />
        <Kpi label="UNCATEGORIZED" value={summary.uncategorized} note="assets outside folders" onClick={() => quickFilter({ folder_id: "" })} />
      </section>

      <div className="cs-media-pro-tabs" role="tablist" aria-label="Media Library Pro sections">
        <button type="button" className={tab === "library" ? "is-active" : ""} onClick={() => setTab("library")}>Library</button>
        <button type="button" className={tab === "intelligence" ? "is-active" : ""} onClick={() => setTab("intelligence")}>Intelligence</button>
        <button type="button" className={tab === "upload" ? "is-active" : ""} onClick={() => setTab("upload")} disabled={!canManage}>Upload & video</button>
        <button type="button" className={tab === "folders" ? "is-active" : ""} onClick={() => setTab("folders")}>Folders</button>
      </div>

      {tab === "library" ? (
        <>
          <form className="cs-media-pro-filterbar" onSubmit={applyFilters}>
            <input type="search" value={filterForm.search} onChange={(event) => setFilterForm((current) => ({ ...current, search: event.target.value }))} placeholder="Search name, filename, key, alt, caption or credit" />
            <select value={filterForm.media_type} onChange={(event) => setFilterForm((current) => ({ ...current, media_type: event.target.value }))}><option value="">All media</option><option value="image">Images</option><option value="video">Videos</option><option value="document">Documents</option><option value="audio">Audio</option><option value="other">Other</option></select>
            <select value={filterForm.visibility} onChange={(event) => setFilterForm((current) => ({ ...current, visibility: event.target.value }))}><option value="">All visibility</option><option value="public">Public</option><option value="private">Private</option><option value="restricted">Restricted</option></select>
            <select value={filterForm.folder_id} onChange={(event) => setFilterForm((current) => ({ ...current, folder_id: event.target.value }))}><option value="">All folders</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={filterForm.readiness} onChange={(event) => setFilterForm((current) => ({ ...current, readiness: event.target.value }))}><option value="">Any readiness</option><option value="public_ready">Public ready</option><option value="needs_attention">Needs attention</option></select>
            <select value={filterForm.usage} onChange={(event) => setFilterForm((current) => ({ ...current, usage: event.target.value }))}><option value="">Any usage</option><option value="used">Used</option><option value="unused">Unused</option></select>
            <select value={filterForm.orientation} onChange={(event) => setFilterForm((current) => ({ ...current, orientation: event.target.value }))}><option value="">Any orientation</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option><option value="square">Square</option><option value="unknown">Unknown</option></select>
            <select value={filterForm.sort} onChange={(event) => setFilterForm((current) => ({ ...current, sort: event.target.value }))}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Name</option><option value="largest">Largest file</option><option value="smallest">Smallest file</option><option value="width">Widest</option></select>
            <div className="cs-media-pro-filter-extra">
              <select value={filterForm.alt_status} onChange={(event) => setFilterForm((current) => ({ ...current, alt_status: event.target.value }))}><option value="">Any alt status</option><option value="present">Alt present</option><option value="missing">Alt missing</option></select>
              <select value={filterForm.duplicate} onChange={(event) => setFilterForm((current) => ({ ...current, duplicate: event.target.value }))}><option value="">Any duplicate state</option><option value="duplicate">Duplicates</option><option value="unique">Unique checksum</option></select>
              <input inputMode="numeric" value={filterForm.min_width} onChange={(event) => setFilterForm((current) => ({ ...current, min_width: event.target.value }))} placeholder="Min width" />
              <input inputMode="numeric" value={filterForm.max_width} onChange={(event) => setFilterForm((current) => ({ ...current, max_width: event.target.value }))} placeholder="Max width" />
            </div>
            <div className="cs-media-pro-filter-actions"><button type="submit">Apply filters</button><button type="button" onClick={resetFilters}>Reset</button></div>
          </form>

          <div className="cs-media-pro-toolbar">
            <div><strong>{total.toLocaleString("en-GH")} assets</strong><span>{offset + 1}-{Math.min(offset + pageSize, total)} in current result set</span></div>
            <div className="cs-media-pro-view-toggle"><button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}>Grid</button><button type="button" className={view === "table" ? "is-active" : ""} onClick={() => setView("table")}>Table</button></div>
          </div>

          <div className="cs-media-pro-workspace">
            <section className="cs-media-pro-results" aria-busy={loading ? "true" : "false"}>
              {view === "grid" ? (
                <div className="cs-media-pro-grid">
                  {assets.map((asset) => (
                    <button type="button" key={asset.id} className={selectedAsset?.id === asset.id ? "cs-media-pro-card is-active" : "cs-media-pro-card"} onClick={() => chooseAsset(asset)}>
                      <div className="cs-media-pro-card-media"><AssetThumb asset={asset} /><span className="cs-media-pro-card-type">{asset.media_type}</span>{asset.is_duplicate ? <b>DUP ×{asset.duplicate_count}</b> : null}</div>
                      <div className="cs-media-pro-card-copy"><strong>{compactName(asset)}</strong><span>{asset.folder_name || "Uncategorized"}</span><small>{mediaDimensions(asset)} · {formatMediaBytes(asset.file_size_bytes)}</small></div>
                      <div className="cs-media-pro-card-foot"><Status tone={mediaHealthTone(asset)}>{asset.public_ready ? "public ready" : asset.processing_status}</Status><span>{asset.usage_count} ref{asset.usage_count === 1 ? "" : "s"}</span></div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="cs-media-pro-table-wrap"><table className="cs-media-pro-table"><thead><tr><th>Asset</th><th>Type</th><th>Dimensions</th><th>Folder</th><th>Visibility</th><th>Usage</th><th>Health</th></tr></thead><tbody>{assets.map((asset) => <tr key={asset.id} className={selectedAsset?.id === asset.id ? "is-active" : ""} onClick={() => chooseAsset(asset)}><td><strong>{compactName(asset)}</strong><small>{asset.asset_key}</small></td><td>{asset.media_type}</td><td>{mediaDimensions(asset)}<small>{formatMediaBytes(asset.file_size_bytes)}</small></td><td>{asset.folder_name || "Uncategorized"}</td><td>{asset.visibility}</td><td>{asset.usage_count}</td><td><Status tone={mediaHealthTone(asset)}>{asset.public_ready ? "ready" : "attention"}</Status></td></tr>)}</tbody></table></div>
              )}
              {!assets.length && !loading ? <div className="cs-media-pro-empty"><strong>No assets match this view.</strong><span>Change filters or upload approved media.</span></div> : null}
              <div className="cs-media-pro-pagination"><button type="button" disabled={offset <= 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>← Previous</button><span>Page {Math.floor(offset / pageSize) + 1}</span><button type="button" disabled={offset + pageSize >= total || loading} onClick={() => setOffset((value) => value + pageSize)}>Next →</button></div>
            </section>

            <aside className="cs-media-pro-inspector">
              {!selectedAsset ? <div className="cs-media-pro-empty"><strong>Select an asset</strong><span>Inspect public readiness, exact website usage, variants and metadata.</span></div> : (
                <form onSubmit={saveAsset}>
                  <div className="cs-media-pro-inspector-head"><div><span>ASSET #{selectedAsset.id}</span><h3>{compactName(selectedAsset)}</h3><small>{selectedAsset.asset_key}</small></div><Status tone={mediaHealthTone(selectedAsset)}>{selectedAsset.public_ready ? "public ready" : "needs attention"}</Status></div>
                  <div className="cs-media-pro-preview"><AssetThumb asset={selectedAsset} large /></div>
                  <div className="cs-media-pro-facts"><div><span>Dimensions</span><strong>{mediaDimensions(selectedAsset)}</strong></div><div><span>File size</span><strong>{formatMediaBytes(selectedAsset.file_size_bytes)}</strong></div><div><span>Orientation</span><strong>{selectedAsset.orientation || "unknown"}</strong></div><div><span>References</span><strong>{selectedAsset.usage_count || usage.length}</strong></div></div>

                  <section className="cs-media-pro-readiness"><header><strong>Public readiness</strong><span>{readinessIssues.length ? `${readinessIssues.length} issue${readinessIssues.length === 1 ? "" : "s"}` : "Ready"}</span></header>{readinessIssues.length ? readinessIssues.map((issue) => <div key={issue}><b>!</b><span>{issue}</span></div>) : <div className="is-ok"><b>✓</b><span>Processing, HTTPS delivery and accessibility requirements are satisfied.</span></div>}</section>

                  {selectedAsset.is_duplicate ? <section className="cs-media-pro-warning"><strong>Duplicate checksum detected</strong><span>{selectedAsset.duplicate_count} active assets share this file checksum. Review before keeping multiple copies.</span></section> : null}

                  <div className="cs-media-pro-form-grid">
                    <Field label="Display name"><input value={assetForm.display_name} onChange={(event) => setAssetForm((current) => ({ ...current, display_name: event.target.value }))} disabled={!canManage} /></Field>
                    <Field label="Folder"><select value={assetForm.folder_id} onChange={(event) => setAssetForm((current) => ({ ...current, folder_id: event.target.value }))} disabled={!canManage}><option value="">Uncategorized</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                    <Field label="Visibility" hint="Public images require alt text and safe HTTPS delivery."><select value={assetForm.visibility} onChange={(event) => setAssetForm((current) => ({ ...current, visibility: event.target.value }))} disabled={!canManage}><option value="private">Private</option><option value="public">Public</option><option value="restricted">Restricted</option></select></Field>
                    <Field label="Credit"><input value={assetForm.credit} onChange={(event) => setAssetForm((current) => ({ ...current, credit: event.target.value }))} disabled={!canManage} /></Field>
                  </div>
                  <Field label="Alternative text"><textarea rows="3" value={assetForm.alt_text} onChange={(event) => setAssetForm((current) => ({ ...current, alt_text: event.target.value }))} disabled={!canManage} /></Field>
                  <Field label="Caption"><textarea rows="3" value={assetForm.caption} onChange={(event) => setAssetForm((current) => ({ ...current, caption: event.target.value }))} disabled={!canManage} /></Field>

                  {variants.length ? <section className="cs-media-pro-variants"><header><strong>Generated image variants</strong><span>{variants.length}</span></header>{variants.map((variant) => <div key={variant.key}><span><strong>{variant.name}</strong><small>{variant.width} × {variant.height}</small></span><b>{formatMediaBytes(variant.size)}</b></div>)}</section> : null}

                  <section className="cs-media-pro-usage"><header><strong>Exact website usage</strong><span>{usageLoading ? "Checking…" : `${usage.length} reference${usage.length === 1 ? "" : "s"}`}</span></header>{usage.length ? usage.map((item, index) => <div key={`${item.type}-${item.id}-${index}`}><span>{String(item.type || "reference").replaceAll("_", " ")}</span><strong>{item.label || `#${item.id}`}</strong></div>) : !usageLoading ? <p>No active or draft references were found by the archive safety index.</p> : null}</section>

                  {canManage ? <div className="cs-media-pro-inspector-actions"><button type="submit" disabled={saving}>Save metadata</button><button className="is-danger" type="button" disabled={saving || usageLoading || usage.length > 0} onClick={archiveAsset}>{usage.length > 0 ? "Archive blocked: asset in use" : "Archive unused asset"}</button></div> : null}
                </form>
              )}
            </aside>
          </div>
        </>
      ) : null}

      {tab === "intelligence" ? (
        <section className="cs-media-pro-intelligence">
          <div className="cs-media-pro-intro"><span>LIBRARY HEALTH</span><h3>Asset queues that need attention</h3><p>These are discovery queues. Destructive actions still use the exact archive reference guard.</p></div>
          <div className="cs-media-pro-queue-grid">
            <article><header><div><span>ACCESSIBILITY</span><strong>Missing alternative text</strong></div><b>{summary.missingAlt}</b></header>{intelligence.queues.missingAlt.map((asset) => <button type="button" key={asset.id} onClick={() => quickFilter({ search: asset.asset_key })}><span>{compactName(asset)}</span><small>{mediaDimensions(asset)}</small></button>)}{!intelligence.queues.missingAlt.length ? <p>No image alt-text gaps detected.</p> : null}<button className="cs-media-pro-queue-action" type="button" onClick={() => quickFilter({ media_type: "image", alt_status: "missing" })}>Open full queue →</button></article>
            <article><header><div><span>CLEANUP</span><strong>Unused assets</strong></div><b>{summary.unused}</b></header>{intelligence.queues.unused.map((asset) => <button type="button" key={asset.id} onClick={() => quickFilter({ search: asset.asset_key })}><span>{compactName(asset)}</span><small>{formatMediaBytes(asset.file_size_bytes)}</small></button>)}{!intelligence.queues.unused.length ? <p>No unreferenced active assets detected.</p> : null}<button className="cs-media-pro-queue-action" type="button" onClick={() => quickFilter({ usage: "unused" })}>Review cleanup queue →</button></article>
            <article><header><div><span>STORAGE</span><strong>Largest assets</strong></div><b>{formatMediaBytes(summary.totalBytes)}</b></header>{intelligence.queues.largest.map((asset) => <button type="button" key={asset.id} onClick={() => quickFilter({ search: asset.asset_key })}><span>{compactName(asset)}</span><small>{formatMediaBytes(asset.file_size_bytes)} · {mediaDimensions(asset)}</small></button>)}{!intelligence.queues.largest.length ? <p>No assets available.</p> : null}<button className="cs-media-pro-queue-action" type="button" onClick={() => quickFilter({ sort: "largest" })}>Sort library by size →</button></article>
            <article><header><div><span>INTEGRITY</span><strong>Duplicate checksums</strong></div><b>{summary.duplicateGroups}</b></header>{intelligence.queues.duplicates.map((group) => <div className="cs-media-pro-duplicate-group" key={group.checksum_prefix}><span>{group.checksum_prefix}…</span><strong>{group.count} assets</strong><small>{group.items.map(compactName).join(" · ")}</small></div>)}{!intelligence.queues.duplicates.length ? <p>No duplicate checksum groups detected.</p> : null}<button className="cs-media-pro-queue-action" type="button" onClick={() => quickFilter({ duplicate: "duplicate" })}>Inspect duplicates →</button></article>
          </div>
        </section>
      ) : null}

      {tab === "upload" ? (
        <div className="cs-media-pro-upload-grid">
          <form className="cs-media-pro-panel" onSubmit={uploadImage}><header><span>PROCESSED UPLOAD</span><h3>Safe image</h3><p>JPEG, PNG or WebP. Files are decoded, resized and re-encoded before storage.</p></header><Field label="Image file" hint="Maximum 12 MB."><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] || null)} required /></Field><Field label="Display name"><input value={uploadForm.display_name} onChange={(event) => setUploadForm((current) => ({ ...current, display_name: event.target.value }))} /></Field><Field label="Folder"><select value={uploadForm.folder_id} onChange={(event) => setUploadForm((current) => ({ ...current, folder_id: event.target.value }))}><option value="">Uncategorized</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Alternative text"><textarea rows="3" value={uploadForm.alt_text} onChange={(event) => setUploadForm((current) => ({ ...current, alt_text: event.target.value }))} /></Field><Field label="Caption"><textarea rows="3" value={uploadForm.caption} onChange={(event) => setUploadForm((current) => ({ ...current, caption: event.target.value }))} /></Field><Field label="Credit"><input value={uploadForm.credit} onChange={(event) => setUploadForm((current) => ({ ...current, credit: event.target.value }))} /></Field><button className="cs-media-pro-primary" type="submit" disabled={saving}>Process & store image</button></form>
          <form className="cs-media-pro-panel" onSubmit={registerVideo}><header><span>APPROVED EXTERNAL MEDIA</span><h3>Register video</h3><p>HTTPS video URLs are restricted to configured approved providers.</p></header><Field label="Video URL"><input type="url" value={videoForm.url} onChange={(event) => setVideoForm((current) => ({ ...current, url: event.target.value }))} required /></Field><Field label="Display name"><input value={videoForm.display_name} onChange={(event) => setVideoForm((current) => ({ ...current, display_name: event.target.value }))} required /></Field><Field label="Folder"><select value={videoForm.folder_id} onChange={(event) => setVideoForm((current) => ({ ...current, folder_id: event.target.value }))}><option value="">Uncategorized</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Duration seconds"><input type="number" min="0" step="0.1" value={videoForm.duration_seconds} onChange={(event) => setVideoForm((current) => ({ ...current, duration_seconds: event.target.value }))} /></Field><Field label="Alternative text"><textarea rows="3" value={videoForm.alt_text} onChange={(event) => setVideoForm((current) => ({ ...current, alt_text: event.target.value }))} /></Field><Field label="Caption"><textarea rows="3" value={videoForm.caption} onChange={(event) => setVideoForm((current) => ({ ...current, caption: event.target.value }))} /></Field><Field label="Credit"><input value={videoForm.credit} onChange={(event) => setVideoForm((current) => ({ ...current, credit: event.target.value }))} /></Field><button className="cs-media-pro-primary" type="submit" disabled={saving}>Register approved video</button></form>
        </div>
      ) : null}

      {tab === "folders" ? (
        <div className="cs-media-pro-folder-layout">
          <section className="cs-media-pro-panel"><header><span>FOLDER TREE</span><h3>{folders.length} active folders</h3></header><button type="button" className="cs-media-pro-new-folder" onClick={() => { setSelectedFolder(null); setFolderForm({ ...EMPTY_FOLDER }); }}>+ New folder</button><div className="cs-media-pro-folder-list">{folders.map((folder) => <button type="button" key={folder.id} className={selectedFolder?.id === folder.id ? "is-active" : ""} onClick={() => chooseFolder(folder)}><span><strong>{folder.name}</strong><small>{folder.folder_key}</small></span><b>{folder.parent_id ? "Child" : "Root"}</b></button>)}</div></section>
          <form className="cs-media-pro-panel" onSubmit={saveFolder}><header><span>ORGANIZATION</span><h3>{selectedFolder ? "Edit folder" : "Create folder"}</h3><p>Cycles, excessive nesting, child folders and non-empty archival are blocked by the backend.</p></header><Field label="Folder key"><input value={folderForm.folder_key} onChange={(event) => setFolderForm((current) => ({ ...current, folder_key: event.target.value }))} required disabled={Boolean(selectedFolder)} /></Field><Field label="Name"><input value={folderForm.name} onChange={(event) => setFolderForm((current) => ({ ...current, name: event.target.value }))} required /></Field><Field label="Parent folder"><select value={folderForm.parent_id} onChange={(event) => setFolderForm((current) => ({ ...current, parent_id: event.target.value }))}><option value="">Root folder</option>{folderOptions.filter((option) => Number(option.value) !== Number(selectedFolder?.id)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Sort order"><input type="number" value={folderForm.sort_order} onChange={(event) => setFolderForm((current) => ({ ...current, sort_order: event.target.value }))} /></Field><Field label="Description"><textarea rows="4" value={folderForm.description} onChange={(event) => setFolderForm((current) => ({ ...current, description: event.target.value }))} /></Field>{canManage ? <div className="cs-media-pro-folder-actions"><button className="cs-media-pro-primary" type="submit" disabled={saving}>{selectedFolder ? "Save folder" : "Create folder"}</button>{selectedFolder ? <button className="is-danger" type="button" disabled={saving} onClick={archiveFolder}>Archive empty folder</button> : null}</div> : null}</form>
        </div>
      ) : null}
    </div>
  );
}
