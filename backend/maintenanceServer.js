const express = require("express");
const helmet = require("helmet");

const app = express();
const port = Number(process.env.PORT || 5000);

const allowedOrigins = new Set([
  "https://chalin03.com",
  "https://www.chalin03.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

const maintenancePayload = {
  status: "maintenance",
  code: "SYSTEM_MAINTENANCE",
  message:
    "Chalin 03 is temporarily unavailable while a scheduled system update is being completed. Please contact the system developer for additional information.",
  developer: "Eugene Amankwah Appiah",
};

const maintenanceHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Chalin 03 — Scheduled Maintenance</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #17365f 0, #07182c 45%, #030b15 100%); color: #f8fafc; }
      main { width: min(680px, 100%); padding: clamp(28px, 6vw, 52px); border: 1px solid rgba(148, 163, 184, .28); border-radius: 24px; background: rgba(7, 24, 44, .92); box-shadow: 0 30px 80px rgba(0, 0, 0, .38); text-align: center; }
      .badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: rgba(245, 158, 11, .14); border: 1px solid rgba(245, 158, 11, .45); color: #fcd34d; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; font-size: 12px; }
      h1 { margin: 24px 0 16px; font-size: clamp(32px, 7vw, 52px); line-height: 1.05; }
      p { margin: 0 auto; max-width: 560px; color: #cbd5e1; font-size: clamp(16px, 2.4vw, 19px); line-height: 1.7; }
      .contact { margin-top: 28px; padding: 18px; border-radius: 16px; background: rgba(15, 23, 42, .72); border: 1px solid rgba(148, 163, 184, .18); }
      .contact strong { display: block; margin-top: 6px; color: #fff; font-size: 18px; }
      footer { margin-top: 28px; color: #94a3b8; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <span class="badge">● Scheduled maintenance</span>
      <h1>System temporarily unavailable</h1>
      <p>Chalin 03 is currently undergoing a scheduled system update. Access has been temporarily suspended while the update is completed. No business records have been deleted.</p>
      <div class="contact">
        <span>For additional information, please contact the system developer.</span>
        <strong>Eugene Amankwah Appiah</strong>
      </div>
      <footer>Chalin 03 Company Limited · Please check back later</footer>
    </main>
  </body>
</html>`;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  })
);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Retry-After", "3600");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Chalin03-Workspace, X-Chalin03-Context-Id, X-Chalin03-Branch-Id");
    return res.status(204).end();
  }

  return next();
});

app.get("/api/health", (req, res) => {
  return res.status(200).json({
    ...maintenancePayload,
    service: "chalin03-maintenance",
    healthy: true,
    time: new Date().toISOString(),
  });
});

app.get("/api/readiness", (req, res) => {
  return res.status(200).json({
    ...maintenancePayload,
    ready: true,
    business_operations_available: false,
    time: new Date().toISOString(),
  });
});

app.all(/^\/api(?:\/|$)/, (req, res) => {
  return res.status(503).json({
    ...maintenancePayload,
    path: req.originalUrl,
    time: new Date().toISOString(),
  });
});

app.get("*", (req, res) => {
  return res.status(503).type("html").send(maintenanceHtml);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Chalin 03 maintenance server listening on port ${port}`);
  console.log("Business routes, database connections and background schedulers are disabled on this branch.");
});
