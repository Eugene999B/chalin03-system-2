function cleanText(value, maxLength = 180) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseBrowserFromUserAgent(userAgent) {
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
        version: match[1] || "",
      };
    }
  }

  return {
    name: "Unknown browser",
    version: "",
  };
}

function parseOperatingSystemFromUserAgent(userAgent) {
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
    return { name: "Linux", version: "" };
  }

  return { name: "Unknown operating system", version: "" };
}

function getDeviceType() {
  const ua = String(navigator.userAgent || "");
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const shortestSide = Math.min(
    Number(window.screen?.width || window.innerWidth || 0),
    Number(window.screen?.height || window.innerHeight || 0)
  );

  if (/iPad|Tablet/i.test(ua) || (touchPoints > 1 && shortestSide >= 600)) {
    return "tablet";
  }

  if (/Mobi|Android|iPhone/i.test(ua) || shortestSide < 600) {
    return "phone";
  }

  return "desktop";
}

async function getClientHintEvidence() {
  const userAgentData = navigator.userAgentData;

  if (!userAgentData) {
    return {};
  }

  const basic = {
    device_platform: cleanText(userAgentData.platform, 80),
    device_type: userAgentData.mobile ? "phone" : getDeviceType(),
  };

  if (typeof userAgentData.getHighEntropyValues !== "function") {
    return basic;
  }

  try {
    const details = await userAgentData.getHighEntropyValues([
      "architecture",
      "bitness",
      "fullVersionList",
      "model",
      "platformVersion",
    ]);
    const preferredBrowser = Array.isArray(details.fullVersionList)
      ? details.fullVersionList.find(
          (item) => !/Not.A.Brand/i.test(String(item.brand || ""))
        )
      : null;

    return {
      ...basic,
      architecture: cleanText(
        [details.architecture, details.bitness]
          .filter(Boolean)
          .join(" "),
        40
      ),
      device_model: cleanText(details.model, 100),
      os_version: cleanText(details.platformVersion, 40),
      browser_name: cleanText(preferredBrowser?.brand, 80),
      browser_version: cleanText(preferredBrowser?.version, 40),
    };
  } catch {
    return basic;
  }
}

function getLocationPermissionState() {
  if (!navigator.permissions?.query) {
    return Promise.resolve("unavailable");
  }

  return navigator.permissions
    .query({ name: "geolocation" })
    .then((result) => result.state || "unavailable")
    .catch(() => "unavailable");
}

function requestPreciseLocation(timeoutMs) {
  if (!navigator.geolocation) {
    return Promise.resolve({
      location_permission: "unavailable",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => {
      finish({
        location_permission: "unavailable",
      });
    }, timeoutMs + 500);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        finish({
          location_permission: "granted",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          location_accuracy_m: position.coords.accuracy,
        });
      },
      (error) => {
        window.clearTimeout(timer);
        finish({
          location_permission:
            error.code === error.PERMISSION_DENIED
              ? "denied"
              : "unavailable",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}

export async function collectDeviceEvidence({
  requestLocation = true,
  locationTimeoutMs = 4500,
} = {}) {
  const userAgent = String(navigator.userAgent || "");
  const browser = parseBrowserFromUserAgent(userAgent);
  const operatingSystem = parseOperatingSystemFromUserAgent(userAgent);
  const clientHints = await getClientHintEvidence();
  const pwaMode = Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone
  );
  const baseEvidence = {
    device_type: clientHints.device_type || getDeviceType(),
    device_model: clientHints.device_model || "",
    device_platform:
      clientHints.device_platform || cleanText(navigator.platform, 80),
    architecture: clientHints.architecture || "",
    os_name: operatingSystem.name,
    os_version: clientHints.os_version || operatingSystem.version,
    browser_name: clientHints.browser_name || browser.name,
    browser_version: clientHints.browser_version || browser.version,
    client_timezone: cleanText(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      80
    ),
    client_language: cleanText(navigator.language, 30),
    screen_width: Number(window.screen?.width || window.innerWidth || 0),
    screen_height: Number(window.screen?.height || window.innerHeight || 0),
    pixel_ratio: Number(window.devicePixelRatio || 1),
    touch_points: Number(navigator.maxTouchPoints || 0),
    pwa_mode: pwaMode,
  };
  const deviceNoun =
    baseEvidence.device_type === "phone"
      ? "Phone"
      : baseEvidence.device_type === "tablet"
      ? "Tablet"
      : "Computer";
  baseEvidence.device_label = [
    baseEvidence.device_model || deviceNoun,
    [baseEvidence.os_name, baseEvidence.os_version]
      .filter(Boolean)
      .join(" "),
    baseEvidence.browser_name,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!requestLocation) {
    return {
      ...baseEvidence,
      location_permission: "not_requested",
    };
  }

  const permissionState = await getLocationPermissionState();
  const locationEvidence = await requestPreciseLocation(locationTimeoutMs);

  return {
    ...baseEvidence,
    ...locationEvidence,
    location_permission:
      locationEvidence.location_permission || permissionState || "unavailable",
  };
}
