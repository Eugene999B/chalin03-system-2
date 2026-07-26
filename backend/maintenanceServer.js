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
    "Chalin 03 is temporarily unavailable while a scheduled system update and verification are completed. Please contact the developers for additional information.",
  contact: "Developers",
  business_operations_available: false,
};

const maintenanceHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <meta name="theme-color" content="#061426" />
    <title>Chalin 03 — Scheduled Maintenance</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --text: #f8fafc;
        --muted: #a9bad0;
        --line: rgba(148, 163, 184, .2);
        --amber: #fbbf24;
        --blue: #60a5fa;
        --cyan: #67e8f9;
      }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { width: 100%; max-width: 100%; min-width: 0; margin: 0; overflow-x: hidden; background: #020812; }
      body {
        min-height: 100vh;
        min-height: 100svh;
        color: var(--text);
        background:
          radial-gradient(circle at 8% 8%, rgba(37, 99, 235, .26), transparent 28rem),
          radial-gradient(circle at 92% 12%, rgba(14, 165, 233, .16), transparent 25rem),
          linear-gradient(145deg, #0a213d, #061426 48%, #020812);
      }
      .page {
        display: grid;
        align-items: center;
        width: 100%;
        min-height: 100vh;
        min-height: 100svh;
        padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      }
      .shell {
        width: min(1080px, 100%);
        min-width: 0;
        margin: auto;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, .32);
        border-radius: 28px;
        background: linear-gradient(145deg, rgba(9, 31, 57, .97), rgba(3, 13, 26, .96));
        box-shadow: 0 34px 90px rgba(0, 0, 0, .42);
      }
      .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; padding: 20px 24px; border-bottom: 1px solid var(--line); }
      .brand { min-width: 0; }
      .brand strong, .brand span { display: block; overflow-wrap: anywhere; }
      .brand strong { font-size: 15px; }
      .brand span { margin-top: 3px; color: var(--muted); font-size: 10px; letter-spacing: .07em; text-transform: uppercase; }
      .status { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 8px; padding: 9px 12px; border: 1px solid rgba(251, 191, 36, .36); border-radius: 999px; color: #fde68a; background: rgba(245, 158, 11, .11); font-size: 10px; font-weight: 850; letter-spacing: .065em; text-transform: uppercase; white-space: nowrap; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 0 6px rgba(251, 191, 36, .1); }
      .content { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(320px, .92fr); min-width: 0; }
      .hero, .panel, .step, .step > div { min-width: 0; }
      .hero { padding: clamp(34px, 5vw, 62px); border-right: 1px solid var(--line); }
      .eyebrow { margin: 0 0 17px; color: var(--cyan); font-size: 11px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(40px, 5.6vw, 68px); line-height: 1.02; letter-spacing: -.052em; overflow-wrap: anywhere; }
      h1 span { display: block; margin-top: 9px; color: #bfdbfe; }
      .lead { margin: 23px 0 0; color: #d8e3f0; font-size: clamp(16px, 1.8vw, 19px); line-height: 1.68; }
      .lead strong { color: #fff; }
      .progress { margin-top: 28px; padding: 17px; border: 1px solid var(--line); border-radius: 17px; background: rgba(2, 8, 18, .34); }
      .progress strong, .progress span { display: block; }
      .progress strong { font-size: 13px; }
      .progress span { margin-top: 5px; color: var(--muted); font-size: 12px; }
      .track { height: 7px; margin-top: 13px; overflow: hidden; border-radius: 999px; background: rgba(148, 163, 184, .13); }
      .track::before { content: ""; display: block; width: 62%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--blue), var(--cyan), var(--amber)); }
      .panel { padding: clamp(28px, 4vw, 44px); background: rgba(2, 8, 18, .22); }
      .panel h2 { margin: 0; font-size: 19px; }
      .panel > p { margin: 8px 0 20px; color: var(--muted); font-size: 13px; line-height: 1.55; }
      .steps { display: grid; gap: 10px; }
      .step { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 15px; background: rgba(7, 24, 44, .5); }
      .step.active { border-color: rgba(96, 165, 250, .36); box-shadow: inset 3px 0 0 var(--blue); }
      .icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; color: #bfdbfe; background: rgba(59, 130, 246, .14); font-weight: 900; }
      .step.done .icon { color: #a7f3d0; background: rgba(16, 185, 129, .14); }
      .step strong, .step span { display: block; overflow-wrap: anywhere; }
      .step strong { font-size: 13px; }
      .step span { margin-top: 4px; color: var(--muted); font-size: 11.5px; line-height: 1.45; }
      .contact { margin-top: 17px; padding: 16px; border: 1px solid rgba(251, 191, 36, .24); border-radius: 16px; background: linear-gradient(135deg, rgba(245, 158, 11, .11), rgba(59, 130, 246, .08)); }
      .contact small, .contact strong { display: block; overflow-wrap: anywhere; }
      .contact small { color: #fcd34d; font-size: 10px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
      .contact strong { margin-top: 6px; font-size: 14px; line-height: 1.48; }
      footer { display: flex; justify-content: space-between; gap: 18px; min-width: 0; padding: 16px 24px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.5; }
      footer span { min-width: 0; overflow-wrap: anywhere; }
      footer strong { color: #dbeafe; }
      @media (max-width: 840px) {
        .content { grid-template-columns: minmax(0, 1fr); }
        .hero { border-right: 0; border-bottom: 1px solid var(--line); }
      }
      @media (max-width: 600px) {
        .page { display: block; width: 100%; min-height: 100svh; padding: max(6px, env(safe-area-inset-top)) max(6px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(6px, env(safe-area-inset-left)); }
        .shell { width: 100%; max-width: 100%; border-radius: 18px; box-shadow: 0 20px 50px rgba(0, 0, 0, .34); }
        .topbar { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 11px; padding: 14px; }
        .brand strong { font-size: 13px; }
        .brand span { font-size: 9px; }
        .status { justify-self: start; padding: 7px 10px; font-size: 8.5px; }
        .hero { padding: 23px 16px 20px; }
        .eyebrow { margin-bottom: 12px; font-size: 9.5px; }
        h1 { font-size: clamp(30px, 9.6vw, 42px); line-height: 1.04; letter-spacing: -.042em; }
        .lead { margin-top: 17px; font-size: 14.5px; line-height: 1.58; }
        .progress { margin-top: 18px; padding: 14px; border-radius: 14px; }
        .panel { padding: 20px 16px; }
        .panel h2 { font-size: 17px; }
        .panel > p { margin-bottom: 15px; font-size: 12px; }
        .steps { gap: 8px; }
        .step { grid-template-columns: 32px minmax(0, 1fr); gap: 10px; padding: 12px; border-radius: 13px; }
        .icon { width: 32px; height: 32px; border-radius: 10px; font-size: 13px; }
        .step strong { font-size: 12px; }
        .step span { font-size: 10.5px; line-height: 1.4; }
        .contact { margin-top: 13px; padding: 13px; border-radius: 13px; }
        .contact strong { font-size: 12.5px; }
        footer { align-items: flex-start; flex-direction: column; gap: 5px; padding: 13px 16px; font-size: 10px; }
      }
      @media (max-width: 360px) {
        .page { padding: 4px; }
        .shell { border-radius: 15px; }
        .topbar, .hero, .panel, footer { padding-left: 13px; padding-right: 13px; }
        h1 { font-size: 29px; }
        .lead { font-size: 13.5px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="shell">
        <header class="topbar">
          <div class="brand"><strong>Chalin 03 Company Limited</strong><span>Group Operations Platform</span></div>
          <div class="status"><span class="dot" aria-hidden="true"></span>Maintenance active</div>
        </header>
        <div class="content">
          <section class="hero">
            <p class="eyebrow">Scheduled system update</p>
            <h1>System temporarily unavailable<span>We’re improving your experience.</span></h1>
            <p class="lead">Chalin 03 is undergoing a controlled update and verification. Normal access is temporarily paused so the work can be completed safely. <strong>Your business records remain protected.</strong></p>
            <div class="progress"><strong>Updates and system checks are in progress</strong><span>No action is required from staff.</span><div class="track" aria-hidden="true"></div></div>
          </section>
          <aside class="panel">
            <h2>What is happening</h2>
            <p>Access will return after the update passes final operational checks.</p>
            <div class="steps">
              <div class="step done"><div class="icon">✓</div><div><strong>Maintenance mode enabled</strong><span>Business access and transactions have been safely paused.</span></div></div>
              <div class="step active"><div class="icon">↻</div><div><strong>Update and verification</strong><span>The developers are completing the scheduled work and checks.</span></div></div>
              <div class="step"><div class="icon">3</div><div><strong>Normal access restored</strong><span>The platform will reopen after successful verification.</span></div></div>
            </div>
            <section class="contact"><small>Need more information?</small><strong>Please contact the developers for additional information.</strong></section>
          </aside>
        </div>
        <footer><span><strong>Chalin 03 Company Limited</strong> · Scheduled maintenance</span><span>Spare Parts · Mining Operations · Equipment Sales &amp; Hire</span></footer>
      </section>
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
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Chalin03-Workspace, X-Chalin03-Context-Id, X-Chalin03-Branch-Id"
    );
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
    time: new Date().toISOString(),
  });
});

app.all(/^\/api(?:\/|$)/, (req, res) => {
  res.setHeader("Retry-After", "3600");
  return res.status(503).json({
    ...maintenancePayload,
    path: req.originalUrl,
    time: new Date().toISOString(),
  });
});

app.get("*", (req, res) => {
  return res.status(200).type("html").send(maintenanceHtml);
});

app.listen(port, "::", () => {
  console.log(`Chalin 03 maintenance server listening on IPv6/dual-stack port ${port}`);
  console.log(
    "Business routes, database connections and background schedulers are disabled on this branch."
  );
});
