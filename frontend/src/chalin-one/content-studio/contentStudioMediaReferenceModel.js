const USAGE_DESTINATIONS = Object.freeze([
  Object.freeze({ pattern: /^page_/, manager: "pages", label: "Pages" }),
  Object.freeze({ pattern: /^news_/, manager: "newsroom", label: "Newsroom" }),
  Object.freeze({ pattern: /^project_/, manager: "projects", label: "Projects" }),
  Object.freeze({ pattern: /^equipment_/, manager: "equipment", label: "Public Equipment" }),
  Object.freeze({ pattern: /^leadership_/, manager: "leadership", label: "Leadership" }),
  Object.freeze({ pattern: /^(business_division|location|testimonial|job_vacancy|tender)/, manager: "company-info", label: "Company Information" }),
]);

export function assetName(asset = {}) {
  return asset.display_name || asset.original_filename || asset.asset_key || `Asset #${asset.id || ""}`;
}

export function checksumLabel(value) {
  const checksum = String(value || "");
  return checksum ? `${checksum.slice(0, 12)}…${checksum.slice(-6)}` : "No checksum";
}

export function canonicalScore(asset = {}) {
  return (
    (asset.visibility === "public" ? 1000 : 0) +
    (asset.public_ready ? 500 : 0) +
    Number(asset.usage_count || 0) * 10 -
    Number(asset.id || 0) / 1000000
  );
}

export function groupDuplicates(items = []) {
  const groups = new Map();
  for (const asset of Array.isArray(items) ? items : []) {
    const checksum = String(asset?.checksum_sha256 || "");
    if (!checksum) continue;
    if (!groups.has(checksum)) groups.set(checksum, []);
    groups.get(checksum).push(asset);
  }
  return [...groups.entries()]
    .filter(([, assets]) => assets.length > 1)
    .map(([checksum, assets]) => ({
      checksum,
      assets: [...assets].sort((left, right) => canonicalScore(right) - canonicalScore(left)),
    }))
    .sort((left, right) => right.assets.length - left.assets.length);
}

export function usageDestination(type) {
  const value = String(type || "");
  const match = USAGE_DESTINATIONS.find((entry) => entry.pattern.test(value));
  return match
    ? { manager: match.manager, label: match.label }
    : { manager: "media", label: "Media Library" };
}

export function groupUsage(items = []) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const destination = usageDestination(item?.type);
    const key = destination.manager;
    if (!groups.has(key)) {
      groups.set(key, { ...destination, items: [] });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

export function duplicateResolutionPlan(group, canonicalId, usageByAsset = {}) {
  const assets = Array.isArray(group?.assets) ? group.assets : [];
  const rows = assets.map((asset) => {
    const usage = Array.isArray(usageByAsset?.[asset.id]) ? usageByAsset[asset.id] : [];
    return {
      asset,
      usage,
      usageGroups: groupUsage(usage),
      exactCount: usage.length,
      isCanonical: Number(asset.id) === Number(canonicalId),
    };
  });
  return {
    rows,
    removable: rows.filter((row) => !row.isCanonical && row.exactCount === 0),
    migrationNeeded: rows.filter((row) => !row.isCanonical && row.exactCount > 0),
    totalReferences: rows.reduce((sum, row) => sum + row.exactCount, 0),
  };
}

export { USAGE_DESTINATIONS };
