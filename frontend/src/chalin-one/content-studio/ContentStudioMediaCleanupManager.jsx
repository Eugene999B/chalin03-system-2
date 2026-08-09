import { useCallback, useEffect, useMemo, useState } from "react";
import { contentStudioErrorMessage } from "./contentStudioApi";
import { listMediaFolders } from "./contentStudioOperationsApi";
import {
  bulkArchiveMediaPro,
  bulkUpdateMediaPro,
  listMediaPro,
} from "./contentStudioMediaProApi";
import {
  formatMediaBytes,
  mediaDimensions,
} from "./contentStudioMediaProModel";
import "./contentStudioMediaCleanup.css";

const MAX_SELECTION = 50;
const EMPTY_FILTERS = Object.freeze({
  search: "",
  usage: "",
  readiness: "",
  duplicate: "",
  media_type: "",
});

function assetName(asset = {}) {
  return asset.display_name || asset.original_filename || asset.asset_key || `Asset #${asset.id || ""}`;
}

function AssetPreview({ asset }) {
  if (asset.media_type === "image" && asset.public_url) {
    return <img src={asset.public_url} alt={asset.alt_text || assetName(asset)} loading="lazy" />;
  }
  return <span className="cs-media-cleanup-file">{String(asset.media_type || "media").toUpperCase()}</span>;
}

export default function ContentStudioMediaCleanupManager() {
  const [assets, setAssets] = useState([]);
  const [folders, setFolders] = useState([]);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [selection, setSelection] = useState(() => new Set());
  const [folderChoice, setFolderChoice] = useState("");
  const [visibilityChoice, setVisibilityChoice] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selection.has(Number(asset.id))),
    [assets, selection]
  );
  const selectedUsed = selectedAssets.filter((asset) => asset.in_use);
  const selectedNotPublicReady = selectedAssets.filter((asset) => !asset.public_ready);
  const selectedBytes = selectedAssets.reduce(
    (total, asset) => total + Number(asset.file_size_bytes || 0),
    0
  );

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const [mediaResult, folderResult] = await Promise.all([
        listMediaPro({ ...filters, sort: "newest", limit: 100, offset: 0 }, { signal }),
        listMediaFolders({ signal }),
      ]);
      if (signal?.aborted) return;
      setAssets(Array.isArray(mediaResult?.items) ? mediaResult.items : []);
      setFolders(Array.isArray(folderResult) ? folderResult : []);
      setSelection((current) => {
        const available = new Set((mediaResult?.items || []).map((asset) => Number(asset.id)));
        return new Set([...current].filter((id) => available.has(id)));
      });
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  function toggleAsset(assetId) {
    const id = Number(assetId);
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= MAX_SELECTION) {
        setError(`Select at most ${MAX_SELECTION} assets per governed bulk action.`);
        return current;
      }
      next.add(id);
      return next;
    });
  }

  function selectVisible() {
    const ids = assets.slice(0, MAX_SELECTION).map((asset) => Number(asset.id));
    setSelection(new Set(ids));
    if (assets.length > MAX_SELECTION) {
      setNotice(`Selected the first ${MAX_SELECTION} assets. Bulk actions are intentionally capped.`);
    }
  }

  function clearSelection() {
    setSelection(new Set());
    setFolderChoice("");
    setVisibilityChoice("");
    setArchiveReason("");
  }

  async function runBulkUpdate() {
    if (!selection.size || (!folderChoice && !visibilityChoice)) return;
    if (visibilityChoice === "public" && selectedNotPublicReady.length) {
      setError("Every selected asset must pass processing, HTTPS and image-alt checks before a bulk public change.");
      return;
    }
    if (!window.confirm(`Apply this metadata change to ${selection.size} selected assets? The backend will validate all assets before committing anything.`)) return;

    const payload = { asset_ids: [...selection] };
    if (folderChoice) payload.folder_id = folderChoice === "uncategorized" ? null : Number(folderChoice);
    if (visibilityChoice) payload.visibility = visibilityChoice;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await bulkUpdateMediaPro(payload);
      setNotice(`${Number(result?.updated || selection.size)} assets were updated in one governed transaction.`);
      clearSelection();
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function runBulkArchive() {
    if (!selection.size || selectedUsed.length) return;
    if (!window.confirm(`Archive ${selection.size} selected unused assets? The backend will re-check every website reference first. If one asset is in use, nothing will be archived.`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await bulkArchiveMediaPro({
        asset_ids: [...selection],
        reason: archiveReason || "Governed Media Cleanup bulk archive",
      });
      setNotice(`${Number(result?.archived || selection.size)} unused assets were archived. Stored objects were not deleted.`);
      clearSelection();
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cs-media-cleanup-shell">
      <section className="cs-media-cleanup-hero">
        <div className="cs-media-cleanup-mark" aria-hidden="true">MC</div>
        <div>
          <span>ASSETS / GOVERNED BULK CONTROL</span>
          <h2>Media Cleanup</h2>
          <p>Move, reclassify and retire groups of website assets without partial writes or bypassing reference safety.</p>
        </div>
        <div className="cs-media-cleanup-limit"><strong>{MAX_SELECTION}</strong><span>maximum assets per transaction</span></div>
      </section>

      {error ? <div className="cs-alert cs-alert-danger" role="alert"><div><strong>Bulk action not completed</strong><span>{error}</span></div><button type="button" onClick={() => setError("")}>Close</button></div> : null}
      {notice ? <div className="cs-alert cs-alert-success" role="status"><div><strong>Media Cleanup updated</strong><span>{notice}</span></div><button type="button" onClick={() => setNotice("")}>Close</button></div> : null}

      <section className="cs-media-cleanup-command">
        <div className="cs-media-cleanup-filters">
          <input type="search" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search assets" />
          <select value={filters.media_type} onChange={(event) => setFilters((current) => ({ ...current, media_type: event.target.value }))}>
            <option value="">All media</option><option value="image">Images</option><option value="video">Videos</option><option value="document">Documents</option>
          </select>
          <select value={filters.usage} onChange={(event) => setFilters((current) => ({ ...current, usage: event.target.value }))}>
            <option value="">Used + unused</option><option value="unused">Unused only</option><option value="used">Used only</option>
          </select>
          <select value={filters.readiness} onChange={(event) => setFilters((current) => ({ ...current, readiness: event.target.value }))}>
            <option value="">Any readiness</option><option value="public_ready">Public ready</option><option value="needs_attention">Needs attention</option>
          </select>
          <select value={filters.duplicate} onChange={(event) => setFilters((current) => ({ ...current, duplicate: event.target.value }))}>
            <option value="">Any checksum state</option><option value="duplicate">Duplicates</option><option value="unique">Unique</option>
          </select>
        </div>
        <div className="cs-media-cleanup-selection-actions">
          <button type="button" onClick={selectVisible} disabled={loading || !assets.length}>Select visible</button>
          <button type="button" onClick={clearSelection} disabled={!selection.size}>Clear selection</button>
          <button type="button" onClick={() => load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </section>

      <section className="cs-media-cleanup-summary">
        <article><span>SELECTED</span><strong>{selection.size}</strong><small>{formatMediaBytes(selectedBytes)}</small></article>
        <article className={selectedUsed.length ? "is-danger" : "is-safe"}><span>REFERENCED</span><strong>{selectedUsed.length}</strong><small>{selectedUsed.length ? "archive blocked" : "none indexed"}</small></article>
        <article className={selectedNotPublicReady.length ? "is-warning" : "is-safe"}><span>NOT PUBLIC READY</span><strong>{selectedNotPublicReady.length}</strong><small>processing / HTTPS / alt</small></article>
        <article><span>VISIBLE RESULTS</span><strong>{assets.length}</strong><small>up to 100 loaded</small></article>
      </section>

      <div className="cs-media-cleanup-layout">
        <section className="cs-media-cleanup-list" aria-busy={loading ? "true" : "false"}>
          {assets.map((asset) => {
            const checked = selection.has(Number(asset.id));
            return (
              <label key={asset.id} className={`cs-media-cleanup-row${checked ? " is-selected" : ""}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleAsset(asset.id)} />
                <div className="cs-media-cleanup-thumb"><AssetPreview asset={asset} /></div>
                <div className="cs-media-cleanup-copy"><strong>{assetName(asset)}</strong><span>{asset.folder_name || "Uncategorized"} · {asset.visibility}</span><small>{mediaDimensions(asset)} · {formatMediaBytes(asset.file_size_bytes)}</small></div>
                <div className="cs-media-cleanup-signals">
                  <span className={asset.in_use ? "is-used" : "is-unused"}>{asset.usage_count || 0} refs</span>
                  <span className={asset.public_ready ? "is-ready" : "is-warning"}>{asset.public_ready ? "ready" : "attention"}</span>
                  {asset.is_duplicate ? <span className="is-duplicate">duplicate ×{asset.duplicate_count}</span> : null}
                </div>
              </label>
            );
          })}
          {!loading && !assets.length ? <div className="cs-empty-state"><strong>No assets match this cleanup view.</strong><span>Change the filters or return to Media Library Pro.</span></div> : null}
        </section>

        <aside className="cs-media-cleanup-desk">
          <header><span>TRANSACTION DESK</span><h3>{selection.size ? `${selection.size} assets selected` : "Choose assets"}</h3><p>Metadata changes and archive cleanup are validated server-side before the transaction commits.</p></header>

          <div className="cs-media-cleanup-operation">
            <span>01 / BULK METADATA</span>
            <label><b>Move to folder</b><select value={folderChoice} onChange={(event) => setFolderChoice(event.target.value)} disabled={!selection.size || saving}><option value="">No folder change</option><option value="uncategorized">Uncategorized</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            <label><b>Change visibility</b><select value={visibilityChoice} onChange={(event) => setVisibilityChoice(event.target.value)} disabled={!selection.size || saving}><option value="">No visibility change</option><option value="private">Private</option><option value="restricted">Restricted</option><option value="public">Public</option></select></label>
            {visibilityChoice === "public" && selectedNotPublicReady.length ? <div className="cs-media-cleanup-block"><strong>Public change blocked</strong><span>{selectedNotPublicReady.length} selected assets need processing, HTTPS delivery or image alternative text first.</span></div> : null}
            <button className="cs-button cs-button-primary" type="button" disabled={saving || !selection.size || (!folderChoice && !visibilityChoice) || (visibilityChoice === "public" && selectedNotPublicReady.length > 0)} onClick={runBulkUpdate}>Apply atomic metadata change</button>
          </div>

          <div className="cs-media-cleanup-operation is-archive">
            <span>02 / SAFE CLEANUP</span>
            <label><b>Archive reason</b><textarea rows="3" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} disabled={!selection.size || saving} placeholder="Why are these unused assets being retired?" /></label>
            {selectedUsed.length ? <div className="cs-media-cleanup-block"><strong>Archive blocked</strong><span>{selectedUsed.length} selected assets have indexed website references. Remove or replace those references in a new governed content version first.</span></div> : <div className="cs-media-cleanup-safe"><strong>Exact re-check on commit</strong><span>The backend checks every selected asset again inside the same transaction. One reference blocks the entire archive.</span></div>}
            <button className="cs-button cs-button-danger" type="button" disabled={saving || !selection.size || selectedUsed.length > 0} onClick={runBulkArchive}>Archive selected unused assets</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
