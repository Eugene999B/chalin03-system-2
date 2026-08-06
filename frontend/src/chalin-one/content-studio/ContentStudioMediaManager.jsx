import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  archiveMediaAsset,
  archiveMediaFolder,
  createMediaFolder,
  getMediaUsage,
  listMedia,
  listMediaFolders,
  registerMediaVideo,
  updateMediaAsset,
  updateMediaFolder,
  uploadMediaImage,
} from "./contentStudioOperationsApi";
import { CONTENT_STUDIO_PERMISSIONS } from "./contentStudioModel";
import "./contentStudioOperationalManagers.css";

const EMPTY_ASSET = Object.freeze({
  display_name: "",
  alt_text: "",
  caption: "",
  credit: "",
  folder_id: "",
  visibility: "private",
});
const EMPTY_FOLDER = Object.freeze({
  folder_key: "",
  name: "",
  description: "",
  parent_id: "",
  sort_order: 0,
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

function Notice({ error, message, clear }) {
  const value = error || message;
  if (!value) return null;
  return (
    <div className={`cs-alert ${error ? "cs-alert-danger" : "cs-alert-success"}`} role={error ? "alert" : "status"}>
      <div><strong>{error ? "Action not completed" : "Media Library updated"}</strong><span>{value}</span></div>
      <button type="button" onClick={clear}>Close</button>
    </div>
  );
}

function Field({ label, hint, children }) {
  return <label className="cs-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function bytes(value) {
  const number = Number(value || 0);
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

export default function ContentStudioMediaManager() {
  const auth = useAuth();
  const canManage = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.mediaManage);
  const [tab, setTab] = useState("assets");
  const [assets, setAssets] = useState([]);
  const [folders, setFolders] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [visibility, setVisibility] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetForm, setAssetForm] = useState({ ...EMPTY_ASSET });
  const [usage, setUsage] = useState([]);
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

  const loadFolders = useCallback(async ({ signal } = {}) => {
    const result = await listMediaFolders({ signal });
    if (!signal?.aborted) setFolders(Array.isArray(result) ? result : []);
  }, []);

  const loadAssets = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listMedia(
        {
          search,
          media_type: mediaType,
          visibility,
          folder_id: folderFilter,
          limit: 100,
          offset: 0,
        },
        { signal }
      );
      if (!signal?.aborted) {
        setAssets(Array.isArray(result?.items) ? result.items : []);
        setTotal(Number(result?.total || 0));
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [folderFilter, mediaType, search, visibility]);

  const refresh = useCallback(async ({ signal } = {}) => {
    try {
      await Promise.all([loadFolders({ signal }), loadAssets({ signal })]);
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    }
  }, [loadAssets, loadFolders]);

  useEffect(() => {
    const controller = new AbortController();
    refresh({ signal: controller.signal });
    return () => controller.abort();
  }, [refresh]);

  async function run(action, message) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(message);
      await refresh();
      return result;
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
      return null;
    } finally {
      setSaving(false);
    }
  }

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
    try {
      const result = await getMediaUsage(asset.id);
      setUsage(Array.isArray(result) ? result : Array.isArray(result?.usage) ? result.usage : []);
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    }
  }

  async function saveAsset(event) {
    event.preventDefault();
    if (!selectedAsset) return;
    const result = await run(
      () => updateMediaAsset(selectedAsset.id, assetForm),
      "Media metadata and visibility were updated safely."
    );
    if (result) await chooseAsset(result);
  }

  async function uploadImage(event) {
    event.preventDefault();
    if (!imageFile) {
      setError("Choose a JPEG, PNG or WebP image first.");
      return;
    }
    const result = await run(
      () => uploadMediaImage(imageFile, uploadForm),
      "The image was decoded, re-encoded and stored safely."
    );
    if (result) {
      setImageFile(null);
      setUploadForm({ ...EMPTY_ASSET });
    }
  }

  async function registerVideo(event) {
    event.preventDefault();
    const result = await run(
      () => registerMediaVideo({
        ...videoForm,
        duration_seconds: videoForm.duration_seconds === "" ? null : Number(videoForm.duration_seconds),
        folder_id: videoForm.folder_id || null,
      }),
      "The approved external video was registered safely."
    );
    if (result) setVideoForm({ ...EMPTY_VIDEO });
  }

  async function archiveAsset() {
    if (!selectedAsset || !window.confirm("Archive this media asset? Existing content references will block unsafe archival.")) return;
    const result = await run(
      () => archiveMediaAsset(selectedAsset.id, "Archived from Content Studio"),
      "The unused media asset was archived without deleting its stored objects."
    );
    if (result) {
      setSelectedAsset(null);
      setUsage([]);
    }
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

  function newFolder() {
    setSelectedFolder(null);
    setFolderForm({ ...EMPTY_FOLDER });
  }

  async function saveFolder(event) {
    event.preventDefault();
    const payload = {
      ...folderForm,
      parent_id: folderForm.parent_id || null,
      sort_order: Number(folderForm.sort_order) || 0,
    };
    const result = await run(
      () => selectedFolder ? updateMediaFolder(selectedFolder.id, payload) : createMediaFolder(payload),
      selectedFolder ? "Media folder updated safely." : "Media folder created safely."
    );
    if (result) newFolder();
  }

  async function archiveFolder() {
    if (!selectedFolder || !window.confirm("Archive this folder? Active child folders or media will block the action.")) return;
    const result = await run(
      () => archiveMediaFolder(selectedFolder.id, "Archived from Content Studio"),
      "The empty media folder was archived safely."
    );
    if (result) newFolder();
  }

  return (
    <div className="cs-operational-manager">
      <section className="cs-module-hero">
        <div className="cs-badge cs-badge-green" aria-hidden="true">ML</div>
        <div><span className="cs-eyebrow">Assets</span><h2>Media Library</h2><p>Process safe images, register approved videos, organize folders and protect every active website reference.</p></div>
      </section>
      <Notice error={error} message={notice} clear={() => { setError(""); setNotice(""); }} />
      <div className="cs-ops-tabs" role="tablist">
        <button type="button" className={tab === "assets" ? "is-active" : ""} onClick={() => setTab("assets")}>Assets</button>
        <button type="button" className={tab === "upload" ? "is-active" : ""} onClick={() => setTab("upload")} disabled={!canManage}>Upload & video</button>
        <button type="button" className={tab === "folders" ? "is-active" : ""} onClick={() => setTab("folders")}>Folders</button>
      </div>

      {tab === "assets" ? (
        <div className="cs-page-layout">
          <aside className="cs-panel cs-page-list-panel">
            <div className="cs-panel-heading"><div><span className="cs-eyebrow">Library</span><h3>{total.toLocaleString("en-GH")} assets</h3></div></div>
            <div className="cs-filter-stack">
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search filename, name or alt text" />
              <select value={mediaType} onChange={(event) => setMediaType(event.target.value)}><option value="">All media</option><option value="image">Images</option><option value="video">Videos</option></select>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="">All visibility</option><option value="private">Private</option><option value="public">Public</option><option value="restricted">Restricted</option></select>
              <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}><option value="">All folders</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </div>
            <div className="cs-page-list" aria-busy={loading ? "true" : "false"}>
              {assets.map((asset) => <button type="button" key={asset.id} className={selectedAsset?.id === asset.id ? "cs-page-list-item is-active" : "cs-page-list-item"} onClick={() => chooseAsset(asset)}><span><strong>{asset.display_name || asset.original_filename}</strong><small>{asset.media_type} · {bytes(asset.file_size_bytes)}</small></span><span className={`cs-status-chip cs-status-${asset.visibility === "public" ? "success" : "neutral"}`}>{asset.visibility}</span></button>)}
            </div>
          </aside>
          <section className="cs-panel cs-page-editor-panel">
            {!selectedAsset ? <div className="cs-empty-state cs-page-empty"><strong>Select an asset</strong><span>Review metadata, usage and public visibility.</span></div> : (
              <form onSubmit={saveAsset}>
                <div className="cs-editor-heading"><div><span className="cs-eyebrow">Asset #{selectedAsset.id}</span><h3>{selectedAsset.display_name}</h3></div><span className={`cs-status-chip cs-status-${selectedAsset.processing_status === "ready" ? "success" : "warning"}`}>{selectedAsset.processing_status}</span></div>
                {selectedAsset.public_url ? <div className="cs-media-preview">{selectedAsset.media_type === "image" ? <img src={selectedAsset.public_url} alt={selectedAsset.alt_text || "Selected media preview"} /> : <a href={selectedAsset.public_url} target="_blank" rel="noreferrer">Open approved external video</a>}</div> : null}
                <div className="cs-form-grid">
                  <Field label="Display name"><input value={assetForm.display_name} onChange={(event) => setAssetForm((current) => ({ ...current, display_name: event.target.value }))} disabled={!canManage} /></Field>
                  <Field label="Folder"><select value={assetForm.folder_id} onChange={(event) => setAssetForm((current) => ({ ...current, folder_id: event.target.value }))} disabled={!canManage}><option value="">No folder</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                  <Field label="Visibility" hint="Public images require alt text and a ready HTTPS URL."><select value={assetForm.visibility} onChange={(event) => setAssetForm((current) => ({ ...current, visibility: event.target.value }))} disabled={!canManage}><option value="private">Private</option><option value="public">Public</option><option value="restricted">Restricted</option></select></Field>
                  <Field label="Credit"><input value={assetForm.credit} onChange={(event) => setAssetForm((current) => ({ ...current, credit: event.target.value }))} disabled={!canManage} /></Field>
                </div>
                <Field label="Alternative text"><textarea rows="3" value={assetForm.alt_text} onChange={(event) => setAssetForm((current) => ({ ...current, alt_text: event.target.value }))} disabled={!canManage} /></Field>
                <Field label="Caption"><textarea rows="3" value={assetForm.caption} onChange={(event) => setAssetForm((current) => ({ ...current, caption: event.target.value }))} disabled={!canManage} /></Field>
                <div className="cs-usage-box"><strong>Website usage</strong>{usage.length ? usage.map((item, index) => <span key={`${item.type}-${item.id}-${index}`}>{item.type}: {item.label || item.id}</span>) : <span>No active or draft references found.</span>}</div>
                {canManage ? <div className="cs-editor-actions"><button className="cs-button cs-button-primary" type="submit" disabled={saving}>Save metadata</button><button className="cs-button cs-button-danger cs-action-right" type="button" onClick={archiveAsset} disabled={saving}>Archive asset</button></div> : null}
              </form>
            )}
          </section>
        </div>
      ) : null}

      {tab === "upload" ? (
        <div className="cs-ops-columns">
          <form className="cs-panel" onSubmit={uploadImage}><div className="cs-panel-heading"><div><span className="cs-eyebrow">Processed upload</span><h3>Safe image</h3></div></div><Field label="Image file" hint="JPEG, PNG or WebP; maximum 12 MB."><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] || null)} required /></Field><Field label="Display name"><input value={uploadForm.display_name} onChange={(event) => setUploadForm((current) => ({ ...current, display_name: event.target.value }))} /></Field><Field label="Alternative text"><textarea rows="3" value={uploadForm.alt_text} onChange={(event) => setUploadForm((current) => ({ ...current, alt_text: event.target.value }))} /></Field><Field label="Folder"><select value={uploadForm.folder_id} onChange={(event) => setUploadForm((current) => ({ ...current, folder_id: event.target.value }))}><option value="">No folder</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><button className="cs-button cs-button-primary" disabled={saving}>Upload and process</button></form>
          <form className="cs-panel" onSubmit={registerVideo}><div className="cs-panel-heading"><div><span className="cs-eyebrow">External provider</span><h3>Register video</h3></div></div><Field label="Approved HTTPS video URL"><input type="url" value={videoForm.url} onChange={(event) => setVideoForm((current) => ({ ...current, url: event.target.value }))} required /></Field><Field label="Display name"><input value={videoForm.display_name} onChange={(event) => setVideoForm((current) => ({ ...current, display_name: event.target.value }))} required /></Field><div className="cs-form-grid"><Field label="Duration seconds"><input type="number" min="0" value={videoForm.duration_seconds} onChange={(event) => setVideoForm((current) => ({ ...current, duration_seconds: event.target.value }))} /></Field><Field label="Folder"><select value={videoForm.folder_id} onChange={(event) => setVideoForm((current) => ({ ...current, folder_id: event.target.value }))}><option value="">No folder</option>{folderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field></div><Field label="Caption"><textarea rows="3" value={videoForm.caption} onChange={(event) => setVideoForm((current) => ({ ...current, caption: event.target.value }))} /></Field><button className="cs-button cs-button-primary" disabled={saving}>Register video</button></form>
        </div>
      ) : null}

      {tab === "folders" ? (
        <div className="cs-page-layout"><aside className="cs-panel cs-page-list-panel"><div className="cs-panel-heading"><div><span className="cs-eyebrow">Organization</span><h3>{folders.length} folders</h3></div>{canManage ? <button className="cs-button cs-button-secondary" type="button" onClick={newFolder}>New</button> : null}</div><div className="cs-page-list">{folders.map((folder) => <button type="button" key={folder.id} className={selectedFolder?.id === folder.id ? "cs-page-list-item is-active" : "cs-page-list-item"} onClick={() => chooseFolder(folder)}><span><strong>{folder.name}</strong><small>{folder.active_asset_count} assets · {folder.active_child_count} child folders</small></span></button>)}</div></aside><section className="cs-panel cs-page-editor-panel"><form onSubmit={saveFolder}><div className="cs-editor-heading"><div><span className="cs-eyebrow">{selectedFolder ? `Folder #${selectedFolder.id}` : "New folder"}</span><h3>{folderForm.name || "Untitled folder"}</h3></div></div><div className="cs-form-grid"><Field label="Folder key"><input value={folderForm.folder_key} onChange={(event) => setFolderForm((current) => ({ ...current, folder_key: event.target.value }))} disabled={!canManage} required /></Field><Field label="Name"><input value={folderForm.name} onChange={(event) => setFolderForm((current) => ({ ...current, name: event.target.value }))} disabled={!canManage} required /></Field><Field label="Parent folder"><select value={folderForm.parent_id} onChange={(event) => setFolderForm((current) => ({ ...current, parent_id: event.target.value }))} disabled={!canManage}><option value="">Top level</option>{folderOptions.filter((option) => option.value !== String(selectedFolder?.id || "")).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Display order"><input type="number" value={folderForm.sort_order} onChange={(event) => setFolderForm((current) => ({ ...current, sort_order: event.target.value }))} disabled={!canManage} /></Field></div><Field label="Description"><textarea rows="4" value={folderForm.description} onChange={(event) => setFolderForm((current) => ({ ...current, description: event.target.value }))} disabled={!canManage} /></Field>{canManage ? <div className="cs-editor-actions"><button className="cs-button cs-button-primary" disabled={saving}>Save folder</button>{selectedFolder ? <button className="cs-button cs-button-danger cs-action-right" type="button" onClick={archiveFolder} disabled={saving}>Archive folder</button> : null}</div> : null}</form></section></div>
      ) : null}
    </div>
  );
}
