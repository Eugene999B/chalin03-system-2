import { useCallback, useEffect, useMemo, useState } from "react";
import { contentStudioErrorMessage } from "./contentStudioApi";
import { getMediaUsage } from "./contentStudioOperationsApi";
import {
  bulkArchiveMediaPro,
  listMediaPro,
} from "./contentStudioMediaProApi";
import {
  formatMediaBytes,
  mediaDimensions,
} from "./contentStudioMediaProModel";
import {
  assetName,
  checksumLabel,
  duplicateResolutionPlan,
  groupDuplicates,
} from "./contentStudioMediaReferenceModel";
import "./contentStudioMediaReferenceDesk.css";

function AssetThumb({ asset }) {
  if (asset.media_type === "image" && asset.public_url) {
    return <img src={asset.public_url} alt={asset.alt_text || assetName(asset)} loading="lazy" />;
  }
  return <span className="cs-media-ref-file">{String(asset.media_type || "MEDIA").toUpperCase()}</span>;
}

export default function ContentStudioMediaReferenceDesk({ onOpenSection }) {
  const [assets, setAssets] = useState([]);
  const [selectedChecksum, setSelectedChecksum] = useState("");
  const [canonicalId, setCanonicalId] = useState(null);
  const [usageByAsset, setUsageByAsset] = useState({});
  const [usageLoadedFor, setUsageLoadedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const groups = useMemo(() => groupDuplicates(assets), [assets]);
  const selectedGroup = useMemo(
    () => groups.find((group) => group.checksum === selectedChecksum) || null,
    [groups, selectedChecksum]
  );
  const canonical = useMemo(
    () => selectedGroup?.assets.find((asset) => Number(asset.id) === Number(canonicalId)) || null,
    [canonicalId, selectedGroup]
  );
  const resolution = useMemo(
    () => duplicateResolutionPlan(selectedGroup, canonicalId, usageByAsset),
    [canonicalId, selectedGroup, usageByAsset]
  );
  const exactAuditReady = Boolean(selectedGroup) && usageLoadedFor === selectedGroup.checksum && !usageLoading;

  const loadDuplicates = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listMediaPro(
        { duplicate: "duplicate", sort: "newest", limit: 100, offset: 0 },
        { signal }
      );
      if (signal?.aborted) return;
      const nextAssets = Array.isArray(result?.items) ? result.items : [];
      const nextGroups = groupDuplicates(nextAssets);
      setAssets(nextAssets);
      setSelectedChecksum((current) =>
        nextGroups.some((group) => group.checksum === current)
          ? current
          : nextGroups[0]?.checksum || ""
      );
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadDuplicates({ signal: controller.signal });
    return () => controller.abort();
  }, [loadDuplicates]);

  useEffect(() => {
    if (!selectedGroup) {
      setCanonicalId(null);
      setUsageByAsset({});
      setUsageLoadedFor("");
      return;
    }
    setCanonicalId((current) =>
      selectedGroup.assets.some((asset) => Number(asset.id) === Number(current))
        ? current
        : selectedGroup.assets[0]?.id || null
    );
    setUsageByAsset({});
    setUsageLoadedFor("");
  }, [selectedGroup]);

  async function loadExactUsage() {
    if (!selectedGroup || usageLoading) return;
    setUsageLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        selectedGroup.assets.map(async (asset) => {
          const result = await getMediaUsage(asset.id);
          return [asset.id, Array.isArray(result) ? result : Array.isArray(result?.usage) ? result.usage : []];
        })
      );
      setUsageByAsset(Object.fromEntries(results));
      setUsageLoadedFor(selectedGroup.checksum);
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
      setUsageLoadedFor("");
    } finally {
      setUsageLoading(false);
    }
  }

  async function archiveUnusedCopies() {
    if (!canonical || !exactAuditReady || !resolution.removable.length || saving) return;
    if (!window.confirm(`Archive ${resolution.removable.length} exact unused duplicate ${resolution.removable.length === 1 ? "copy" : "copies"}? The canonical asset remains active and the backend will re-check every reference before committing.`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await bulkArchiveMediaPro({
        asset_ids: resolution.removable.map((row) => row.asset.id),
        reason: `Duplicate cleanup; canonical asset ${canonical.asset_key || canonical.id}`,
      });
      setNotice(`${Number(result?.archived || resolution.removable.length)} unused duplicate ${resolution.removable.length === 1 ? "copy was" : "copies were"} archived. Historical content versions were not rewritten.`);
      setUsageByAsset({});
      setUsageLoadedFor("");
      await loadDuplicates();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cs-media-ref-shell">
      <section className="cs-media-ref-hero">
        <div className="cs-media-ref-mark" aria-hidden="true">DR</div>
        <div>
          <span>ASSETS / DUPLICATE RESOLUTION</span>
          <h2>Media Reference Desk</h2>
          <p>Choose the canonical copy, inspect exact governed references, migrate referenced duplicates through normal content drafts, and retire only copies with zero references.</p>
        </div>
        <div className="cs-media-ref-count"><strong>{groups.length}</strong><span>duplicate checksum groups</span></div>
      </section>

      {error ? <div className="cs-alert cs-alert-danger" role="alert"><div><strong>Reference audit not completed</strong><span>{error}</span></div><button type="button" onClick={() => setError("")}>Close</button></div> : null}
      {notice ? <div className="cs-alert cs-alert-success" role="status"><div><strong>Duplicate cleanup updated</strong><span>{notice}</span></div><button type="button" onClick={() => setNotice("")}>Close</button></div> : null}

      <section className="cs-media-ref-rule">
        <strong>Immutable-history rule</strong>
        <span>This desk never changes media IDs inside saved page/content versions. Referenced duplicates must be replaced by editing a new governed draft in the owning manager, then reviewed and published normally.</span>
      </section>

      <div className="cs-media-ref-layout">
        <aside className="cs-media-ref-groups" aria-busy={loading ? "true" : "false"}>
          <header><span>DUPLICATE GROUPS</span><strong>{groups.length} detected</strong><button type="button" onClick={() => loadDuplicates()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></header>
          {groups.map((group) => (
            <button
              type="button"
              key={group.checksum}
              className={selectedChecksum === group.checksum ? "is-active" : ""}
              onClick={() => setSelectedChecksum(group.checksum)}
            >
              <span><strong>{checksumLabel(group.checksum)}</strong><small>{group.assets.map(assetName).slice(0, 2).join(" · ")}</small></span>
              <b>{group.assets.length}</b>
            </button>
          ))}
          {!loading && !groups.length ? <div className="cs-empty-state"><strong>No duplicate checksum groups.</strong><span>The active media library currently has no exact file duplicates in the first 100 duplicate results.</span></div> : null}
        </aside>

        <main className="cs-media-ref-main">
          {!selectedGroup ? <div className="cs-empty-state"><strong>Select a duplicate group.</strong><span>Exact usage is loaded only when you request an audit.</span></div> : (
            <>
              <section className="cs-media-ref-group-head">
                <div><span>CHECKSUM</span><h3>{checksumLabel(selectedGroup.checksum)}</h3><p>{selectedGroup.assets.length} active assets contain the same file bytes. Choosing a canonical copy is a planning decision only until unused copies are explicitly archived.</p></div>
                <button type="button" className="cs-button cs-button-primary" onClick={loadExactUsage} disabled={usageLoading}>{usageLoading ? "Auditing exact references…" : exactAuditReady ? "Re-check exact references" : "Audit exact references"}</button>
              </section>

              <div className="cs-media-ref-assets">
                {selectedGroup.assets.map((asset) => {
                  const usage = usageByAsset[asset.id] || [];
                  const isCanonical = Number(asset.id) === Number(canonicalId);
                  return (
                    <article key={asset.id} className={isCanonical ? "is-canonical" : ""}>
                      <div className="cs-media-ref-thumb"><AssetThumb asset={asset} />{isCanonical ? <b>CANONICAL</b> : null}</div>
                      <div className="cs-media-ref-asset-copy"><strong>{assetName(asset)}</strong><span>#{asset.id} · {asset.asset_key}</span><small>{mediaDimensions(asset)} · {formatMediaBytes(asset.file_size_bytes)} · {asset.visibility}</small></div>
                      <div className="cs-media-ref-signals"><span>{exactAuditReady ? `${usage.length} exact refs` : `${asset.usage_count || 0} indexed refs`}</span><span>{asset.public_ready ? "ready" : "attention"}</span></div>
                      <button type="button" onClick={() => setCanonicalId(asset.id)} className={isCanonical ? "is-selected" : ""}>{isCanonical ? "Canonical copy" : "Make canonical"}</button>
                    </article>
                  );
                })}
              </div>

              <section className="cs-media-ref-audit" data-ready={exactAuditReady ? "true" : "false"}>
                <header><div><span>EXACT REFERENCE AUDIT</span><h3>{exactAuditReady ? `${resolution.totalReferences} references inspected` : "Audit required before cleanup"}</h3></div><div><strong>{resolution.migrationNeeded.length}</strong><span>referenced non-canonical copies</span></div><div><strong>{resolution.removable.length}</strong><span>unused non-canonical copies</span></div></header>

                {!exactAuditReady ? <div className="cs-media-ref-callout"><strong>No destructive action is available yet.</strong><span>Run the exact reference audit. Indexed usage is useful for discovery, but cleanup decisions use the stricter per-asset archive reference service.</span></div> : null}

                {exactAuditReady ? resolution.rows.map((row) => (
                  <article key={row.asset.id} className={row.isCanonical ? "is-canonical" : row.exactCount ? "is-migrate" : "is-unused"}>
                    <header><div><span>{row.isCanonical ? "CANONICAL" : row.exactCount ? "MIGRATION REQUIRED" : "UNUSED COPY"}</span><strong>{assetName(row.asset)}</strong><small>Asset #{row.asset.id} · {row.exactCount} exact reference{row.exactCount === 1 ? "" : "s"}</small></div></header>
                    {row.usageGroups.length ? (
                      <div className="cs-media-ref-usage-groups">
                        {row.usageGroups.map((group) => (
                          <section key={group.manager}>
                            <header><strong>{group.label}</strong><button type="button" onClick={() => onOpenSection?.(group.manager)}>Open manager →</button></header>
                            {group.items.map((usage, index) => <div key={`${usage.type}-${usage.id}-${index}`}><span>{String(usage.type || "reference").replaceAll("_", " ")}</span><strong>{usage.label || `#${usage.id}`}</strong></div>)}
                          </section>
                        ))}
                      </div>
                    ) : <p>No exact active/draft reference was returned for this asset.</p>}
                  </article>
                )) : null}
              </section>

              <section className="cs-media-ref-resolution">
                <div><span>RESOLUTION PLAN</span><h3>{canonical ? `Keep ${assetName(canonical)} as canonical` : "Choose a canonical asset"}</h3><p>{resolution.migrationNeeded.length ? `${resolution.migrationNeeded.length} duplicate ${resolution.migrationNeeded.length === 1 ? "copy still has" : "copies still have"} governed references. Open the listed managers, create/edit drafts, choose the canonical asset, then review and publish those changes. Re-run this audit afterward.` : exactAuditReady ? "No non-canonical referenced copies remain in this group." : "Run the exact audit to calculate the safe resolution plan."}</p></div>
                <button type="button" className="cs-button cs-button-danger" onClick={archiveUnusedCopies} disabled={saving || !canonical || !exactAuditReady || !resolution.removable.length}>{saving ? "Archiving safely…" : resolution.removable.length ? `Archive ${resolution.removable.length} unused duplicate${resolution.removable.length === 1 ? "" : "s"}` : "No unused duplicates to archive"}</button>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
