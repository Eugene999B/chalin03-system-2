function cleanText(value, maxLength = 180) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function finiteNumber(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < min || number > max) {
    return null;
  }

  return number;
}

function positiveInteger(value, max = 100000) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0 || number > max) {
    return null;
  }

  return number;
}

function parseBrowser(userAgent) {
  const ua = String(userAgent || "");
  const candidates = [
    ["Microsoft Edge", /Edg\/([\d.]+)/],
    ["Opera", /OPR\/([\d.]+)/],
    ["Chrome", /Chrome\/([\d.]+)/],
    ["Firefox", /Firefox\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];

  for (const [name, expression] of candidates) {
    const match = ua.match(expression);

    if (match) {
      return {
        name,
        version: match[1] || null,
      };
    }
  }

  return {
    name: "Unknown browser",
    version: null,
  };
}

function parseOperatingSystem(userAgent) {
  const ua = String(userAgent || "");

  if (/Windows NT 10\.0/i.test(ua)) {
    return { name: "Windows", version: "10/11" };
  }

  if (/Windows NT 6\.3/i.test(ua)) {
    return { name: "Windows", version: "8.1" };
  }

  if (/Windows NT 6\.1/i.test(ua)) {
    return { name: "Windows", version: "7" };
  }

  const android = ua.match(/Android\s([\d.]+)/i);

  if (android) {
    return { name: "Android", version: android[1] };
  }

  const ios = ua.match(/(?:iPhone OS|CPU (?:iPhone )?OS)\s([\d_]+)/i);

  if (ios) {
    return {
      name: "iOS",
      version: ios[1].replaceAll("_", "."),
    };
  }

  const mac = ua.match(/Mac OS X\s([\d_]+)/i);

  if (mac) {
    return {
      name: "macOS",
      version: mac[1].replaceAll("_", "."),
    };
  }

  if (/Linux/i.test(ua)) {
    return { name: "Linux", version: null };
  }

  return {
    name: "Unknown operating system",
    version: null,
  };
}

function parseDeviceType(userAgent, suppliedType) {
  const supplied = cleanText(suppliedType, 30)?.toLowerCase();

  if (["desktop", "phone", "tablet"].includes(supplied)) {
    return supplied;
  }

  const ua = String(userAgent || "");

  if (/iPad|Tablet/i.test(ua)) {
    return "tablet";
  }

  if (/Mobi|Android|iPhone/i.test(ua)) {
    return "phone";
  }

  return "desktop";
}

function normalizeLocationPermission(value) {
  const clean = cleanText(value, 30)?.toLowerCase();

  return [
    "granted",
    "denied",
    "prompt",
    "unavailable",
    "not_requested",
  ].includes(clean)
    ? clean
    : "unavailable";
}

function parseDeviceEvidence({
  userAgent,
  evidence = {},
  networkCountry = null,
}) {
  const browser = parseBrowser(userAgent);
  const operatingSystem = parseOperatingSystem(userAgent);
  const deviceType = parseDeviceType(userAgent, evidence.device_type);
  const deviceModel = cleanText(evidence.device_model, 100);
  const platform = cleanText(evidence.device_platform, 80);
  const locationPermission = normalizeLocationPermission(
    evidence.location_permission
  );
  const latitude = finiteNumber(evidence.latitude, -90, 90);
  const longitude = finiteNumber(evidence.longitude, -180, 180);
  const accuracy = finiteNumber(
    evidence.location_accuracy_m,
    0,
    1000000
  );
  const preciseLocationAvailable =
    latitude !== null && longitude !== null;
  const suppliedLabel = cleanText(evidence.device_label, 180);
  const deviceNoun =
    deviceType === "phone"
      ? "Phone"
      : deviceType === "tablet"
      ? "Tablet"
      : "Computer";
  const osSummary = [
    cleanText(evidence.os_name, 80) || operatingSystem.name,
    cleanText(evidence.os_version, 40) || operatingSystem.version,
  ]
    .filter(Boolean)
    .join(" ");
  const deviceLabel =
    suppliedLabel ||
    [deviceModel || deviceNoun, osSummary, browser.name]
      .filter(Boolean)
      .join(" · ");

  return {
    device_type: deviceType,
    device_label: deviceLabel,
    device_model: deviceModel,
    device_platform: platform,
    architecture: cleanText(evidence.architecture, 40),
    os_name: cleanText(evidence.os_name, 80) || operatingSystem.name,
    os_version:
      cleanText(evidence.os_version, 40) || operatingSystem.version,
    browser_name:
      cleanText(evidence.browser_name, 80) || browser.name,
    browser_version:
      cleanText(evidence.browser_version, 40) || browser.version,
    client_timezone: cleanText(evidence.client_timezone, 80),
    client_language: cleanText(evidence.client_language, 30),
    screen_width: positiveInteger(evidence.screen_width),
    screen_height: positiveInteger(evidence.screen_height),
    pixel_ratio: finiteNumber(evidence.pixel_ratio, 0.1, 20),
    touch_points: finiteNumber(evidence.touch_points, 0, 100),
    pwa_mode: Boolean(evidence.pwa_mode),
    location_permission: locationPermission,
    location_source: preciseLocationAvailable
      ? "browser_geolocation"
      : locationPermission === "denied"
      ? "permission_denied"
      : locationPermission === "not_requested"
      ? "not_requested"
      : "network_only",
    latitude,
    longitude,
    location_accuracy_m: accuracy,
    location_recorded_at: preciseLocationAvailable ? new Date() : null,
    network_country: cleanText(networkCountry, 8),
  };
}

function friendlySessionEvidence(row = {}) {
  const browser = [row.browser_name, row.browser_version]
    .filter(Boolean)
    .join(" ");
  const os = [row.os_name, row.os_version]
    .filter(Boolean)
    .join(" ");
  const device =
    row.device_label ||
    [row.device_model || row.device_type, os, browser]
      .filter(Boolean)
      .join(" · ") ||
    "Unknown device";
  const hasPreciseLocation =
    row.latitude !== null &&
    row.latitude !== undefined &&
    row.longitude !== null &&
    row.longitude !== undefined;
  const preciseLocation = hasPreciseLocation
    ? {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracy_m:
          row.location_accuracy_m === null ||
          row.location_accuracy_m === undefined
            ? null
            : Number(row.location_accuracy_m),
      }
    : null;

  if (preciseLocation) {
    preciseLocation.map_url =
      `https://www.openstreetmap.org/?mlat=${preciseLocation.latitude}` +
      `&mlon=${preciseLocation.longitude}` +
      `#map=17/${preciseLocation.latitude}/${preciseLocation.longitude}`;
  }

  let locationSummary = "Precise location was not shared";

  if (preciseLocation) {
    locationSummary =
      `${preciseLocation.latitude.toFixed(5)}, ` +
      `${preciseLocation.longitude.toFixed(5)}` +
      (preciseLocation.accuracy_m
        ? ` (±${Math.round(preciseLocation.accuracy_m)} m)`
        : "");
  } else if (row.location_permission === "denied") {
    locationSummary = "Location permission denied";
  } else if (row.location_permission === "not_requested") {
    locationSummary = "Location was not requested";
  }

  if (!preciseLocation && row.network_country) {
    locationSummary += ` · Network country ${row.network_country}`;
  }

  return {
    ...row,
    device_summary: device,
    browser_summary: browser || "Unknown browser",
    os_summary: os || "Unknown operating system",
    precise_location: preciseLocation,
    location_summary: locationSummary,
    screen_summary:
      row.screen_width && row.screen_height
        ? `${row.screen_width} × ${row.screen_height}`
        : null,
  };
}

module.exports = {
  friendlySessionEvidence,
  parseBrowser,
  parseDeviceEvidence,
  parseDeviceType,
  parseOperatingSystem,
};
