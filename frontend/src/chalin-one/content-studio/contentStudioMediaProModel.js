export const MEDIA_PRO_VIEWS = Object.freeze(["grid", "table"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function formatMediaBytes(value) {
  const bytes = number(value);
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function mediaDimensions(asset = {}) {
  const width = number(asset.width);
  const height = number(asset.height);
  return width && height ? `${width} × ${height}` : "No dimensions";
}

export function mediaReadinessIssues(asset = {}) {
  const issues = [];
  if (asset.processing_status !== "ready") issues.push("Processing is not ready");
  if (!String(asset.public_url || "").startsWith("https://")) {
    issues.push("No safe HTTPS public URL");
  }
  if (asset.media_type === "image" && !String(asset.alt_text || "").trim()) {
    issues.push("Alternative text is missing");
  }
  return issues;
}

export function normalizeMediaIntelligence(raw = {}) {
  const summary = raw?.summary || {};
  const queues = raw?.queues || {};
  return {
    summary: {
      total: number(summary.total),
      images: number(summary.images),
      videos: number(summary.videos),
      public: number(summary.public),
      private: number(summary.private),
      restricted: number(summary.restricted),
      ready: number(summary.ready),
      publicReady: number(summary.public_ready),
      needsAttention: number(summary.needs_attention),
      missingAlt: number(summary.missing_alt),
      used: number(summary.used),
      unused: number(summary.unused),
      duplicateAssets: number(summary.duplicate_assets),
      duplicateGroups: number(summary.duplicate_groups),
      uncategorized: number(summary.uncategorized),
      totalBytes: number(summary.total_bytes),
    },
    queues: {
      missingAlt: Array.isArray(queues.missing_alt) ? queues.missing_alt : [],
      unused: Array.isArray(queues.unused) ? queues.unused : [],
      largest: Array.isArray(queues.largest) ? queues.largest : [],
      duplicates: Array.isArray(queues.duplicates) ? queues.duplicates : [],
    },
  };
}

export function mediaVariantList(asset = {}) {
  const variants = asset?.metadata?.variants;
  if (!Array.isArray(variants)) return [];
  return variants
    .filter((variant) => variant && typeof variant === "object")
    .map((variant, index) => ({
      key: String(variant.name || `variant-${index + 1}`),
      name: String(variant.name || `Variant ${index + 1}`),
      width: number(variant.width),
      height: number(variant.height),
      size: number(variant.size),
      public_url: String(variant.public_url || ""),
    }));
}

export function mediaHealthTone(asset = {}) {
  if (asset.processing_status === "quarantined" || asset.processing_status === "failed") return "danger";
  if (asset.public_ready) return "success";
  if (asset.processing_status === "ready") return "warning";
  return "neutral";
}
