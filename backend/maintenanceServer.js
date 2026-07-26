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
    <meta name="viewport" content="width=device-width, initial-scale=1" />
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
      * { box-sizing: border-box; }
      html { min-width: 320px; background: #020812; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        color: var(--text);
        background:
          radial-gradient(circle at 8% 8%, rgba(37, 99, 235, .28), transparent 31rem),
          radial-gradient(circle at 92% 16%, rgba(14, 165, 233, .18), transparent 28rem),
          linear-gradient(145deg, #0a213d 0%, #061426 45%, #020812 100%);
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: .24;
        background-image:
          linear-gradient(rgba(148, 163, 184, .06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, .06) 1px, transparent 1px);
        background-size: 42px 42px;
      }
      .shell {
        position: relative;
        width: min(1080px, 100%);
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, .3);
        border-radius: 30px;
        background: linear-gradient(145deg, rgba(9, 31, 57, .96), rgba(3, 13, 26, .94));
        box-shadow: 0 40px 110px rgba(0, 0, 0, .46);
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 22px 26px;
        border-bottom: 1px solid var(--line);
      }
      .brand { display: flex; align-items: center; gap: 13px; }
      .mark {
        display: grid;
        place-items: center;
        width: 50px;
        height: 50px;
        border-radius: 15px;
        color: #061426;
        background: linear-gradient(145deg, #fff, #bfdbfe);
        font-size: 18px;
        font-weight: 950;
        letter-spacing: -.04em;
        box-shadow: 0 12px 28px rgba(0, 0, 0, .28);
      }
      .brand strong, .brand span { display: block; }
      .brand strong { font-size: 16px; }
      .brand span { margin-top: 3px; color: var(--muted); font-size: 11px; letter-spacing: .07em; text-transform: uppercase; }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        padding: 10px 14px;
        border: 1px solid rgba(251, 191, 36, .35);
        border-radius: 999px;
        color: #fde68a;
        background: rgba(245, 158, 11, .1);
        font-size: 11px;
        font-weight: 850;
        letter-spacing: .07em;
        text-transform: uppercase;
      }
      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--amber);
        box-shadow: 0 0 0 7px rgba(251, 191, 36, .1);
      }
      .content { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr); }
      .hero { padding: clamp(36px, 6vw, 68px); border-right: 1px solid var(--line); }
      .eyebrow { margin: 0 0 20px; color: var(--cyan); font-size: 12px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(42px, 6vw, 72px); line-height: 1; letter-spacing: -.055em; }
      h1 span { display: block; margin-top: 9px; color: #bfdbfe; }
      .lead { margin: 25px 0 0; color: #d8e3f0; font-size: clamp(17px, 2vw, 20px); line-height: 1.72; }
      .lead strong { color: #fff; }
      .progress {
        margin-top: 32px;
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(2, 8, 18, .34);
      }
      .progress strong, .progress span { display: block; }
      .progress strong { font-size: 14px; }
      .progress span { margin-top: 5px; color: var(--muted); font-size: 13px; }
      .track { position: relative; height: 8px; margin-top: 14px; overflow: hidden; border-radius: 999px; background: rgba(148, 163, 184, .12); }
      .track::before { content: ""; position: absolute; inset: 0; width: 66%; border-radius: inherit; background: linear-gradient(90deg, var(--blue), var(--cyan), var(--amber)); }
      .panel { padding: clamp(30px, 4vw, 46px); background: rgba(2, 8, 18, .22); }
      .panel h2 { margin: 0; font-size: 20px; }
      .panel > p { margin: 8px 0 24px; color: var(--muted); font-size: 14px; line-height: 1.6; }
      .steps { display: grid; gap: 12px; }
      .step { display: grid; grid-template-columns: 38px 1fr; gap: 13px; padding: 16px; border: 1px solid var(--line); border-radius: 16px; background: rgba(7, 24, 44, .5); }
      .step.active { border-color: rgba(96, 165, 250, .36); box-shadow: inset 3px 0 0 var(--blue); }
      .icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: #bfdbfe; background: rgba(59, 130, 246, .14); font-weight: 900; }
      .step.done .icon { color: #a7f3d0; background: rgba(16, 185, 129, .14); }
      .step strong, .step span { display: block; }
      .step strong { font-size: 14px; }
      .step span { margin-top: 5px; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
      .contact { margin-top: 20px; padding: 18px; border: 1px solid rgba(251, 191, 36, .24); border-radius: 17px; background: linear-gradient(135deg, rgba(245, 158, 11, .11), rgba(59, 130, 246, .08)); }
      .contact small, .contact strong { display: block; }
      .contact small { color: #fcd34d; font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
      .contact strong { margin-top: 7px; font-size: 15px; line-height: 1.5; }
      footer { display: flex; justify-content: space-between; gap: 18px; padding: 18px 26px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
      footer strong { color: #dbeafe; }
      @media (max-width: 820px) {
        .content { grid-template-columns: 1fr; }
        .hero { border-right: 0; border-bottom: 1px solid var(--line); }
      }
      @media (max-width: 560px) {
        body { padding: 10px; }
        .shell { border-radius: 22px; }
        .topbar { align-items: flex-start; padding: 17px; }
        .mark { width: 44px; height: 44px; font-size: 16px; }
        .brand strong { font-size: 14px; }
        .status { padding: 8px 10px; font-size: 9px; }
        .hero, .panel { padding: 30px 20px; }
        h1 { font-size: clamp(39px, 13vw, 56px); }
        .lead { font-size: 16px; }
        footer { flex-direction: column; padding: 16px 20px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark" aria-hidden="true">C03</div>
          <div><strong>Chalin 03 Company Limited</strong><span>Group Operations Platform</span></div>
        </div>
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
