export const PUBLIC_METADATA_CAPABILITIES = Object.freeze([
  Object.freeze({ key: "title", label: "Document title", status: "active", note: "Route titles are currently rendered." }),
  Object.freeze({ key: "description", label: "Meta description", status: "active", note: "Route descriptions are currently rendered." }),
  Object.freeze({ key: "canonical", label: "Canonical URL", status: "pending", note: "Stored in Content Studio, but the public renderer does not emit canonical tags yet." }),
  Object.freeze({ key: "robots", label: "Robots directive", status: "pending", note: "Stored in Content Studio, but route-level robots tags are not rendered yet." }),
  Object.freeze({ key: "open_graph", label: "Open Graph", status: "pending", note: "Per-route social metadata is not rendered yet." }),
  Object.freeze({ key: "twitter", label: "Twitter / X cards", status: "pending", note: "Per-route social card metadata is not rendered yet." }),
]);

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeWebsiteControl(raw = {}) {
  const summary = raw.summary || {};
  return {
    generatedAt: raw.generated_at || null,
    summary: {
      healthScore: Math.min(100, numberValue(summary.health_score)),
      totalPages: numberValue(summary.total_pages),
      publishedPages: numberValue(summary.published_pages),
      healthyPages: numberValue(summary.healthy_pages),
      attentionPages: numberValue(summary.attention_pages),
      indexablePublishedPages: numberValue(summary.indexable_published_pages),
      navigationItems: numberValue(summary.navigation_items),
      orphanPages: numberValue(summary.orphan_pages),
      redirectCandidates: numberValue(summary.redirect_candidates),
      canonicalConflicts: numberValue(summary.canonical_conflicts),
      pageIssues: {
        critical: numberValue(summary.page_issues?.critical),
        warning: numberValue(summary.page_issues?.warning),
        info: numberValue(summary.page_issues?.info),
        total: numberValue(summary.page_issues?.total),
      },
      navigationIssues: {
        critical: numberValue(summary.navigation_issues?.critical),
        warning: numberValue(summary.navigation_issues?.warning),
        info: numberValue(summary.navigation_issues?.info),
        total: numberValue(summary.navigation_issues?.total),
      },
    },
    pages: list(raw.pages),
    navigation: list(raw.navigation),
    orphanPages: list(raw.orphan_pages),
    redirectCandidates: list(raw.redirect_candidates),
    canonicalConflicts: list(raw.canonical_conflicts),
  };
}

export function websiteControlTone(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "critical") return "danger";
  if (normalized === "warning") return "warning";
  if (normalized === "info") return "neutral";
  return "success";
}

export function healthScoreTone(score) {
  const value = Number(score || 0);
  if (value >= 90) return "success";
  if (value >= 70) return "warning";
  return "danger";
}

export function matchesWebsiteControlQuery(row = {}, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const issueText = list(row.issues)
    .map((item) => `${item.code || ""} ${item.message || ""}`)
    .join(" ");
  const haystack = [
    row.page_key,
    row.slug,
    row.title,
    row.public_path,
    row.navigation_key,
    row.label,
    row.url,
    row.internal_path,
    row.publication_status,
    issueText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function rowHasSeverity(row = {}, severity = "") {
  if (!severity) return true;
  return list(row.issues).some(
    (item) => String(item?.severity || "").toLowerCase() === String(severity).toLowerCase()
  );
}

export function issueCount(row = {}) {
  return list(row.issues).length;
}
