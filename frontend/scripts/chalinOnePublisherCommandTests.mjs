import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const studioRoot = path.join(frontendRoot, "src/chalin-one/content-studio");
const model = await import(
  pathToFileURL(path.join(studioRoot, "contentStudioPublisherCommandModel.js")).href
);
const component = fs.readFileSync(path.join(studioRoot, "ContentStudioPublisherCommandCenter.jsx"), "utf8");
const css = fs.readFileSync(path.join(studioRoot, "contentStudioPublisherCommandCenter.css"), "utf8");
const studioModel = fs.readFileSync(path.join(studioRoot, "contentStudioModel.js"), "utf8");
const workspace = fs.readFileSync(path.join(studioRoot, "ContentStudioWorkspace.jsx"), "utf8");
const scheduler = fs.readFileSync(path.resolve(frontendRoot, "../backend/services/publicContentPublishingScheduler.js"), "utf8");
const newsroomPublish = fs.readFileSync(path.resolve(frontendRoot, "../backend/services/contentStudioNewsroomPublishWorkflow.js"), "utf8");

const NOW = new Date("2026-08-09T07:00:00.000Z");

assert.deepEqual(
  model.PUBLISHER_RELEASE_SOURCES.map((item) => item.key),
  ["page", "article", "announcement", "leadership", "project", "equipment"]
);

const scheduledPage = model.normalizePublisherRelease("page", {
  id: 4,
  slug: "company-profile",
  latest_title: "Company Profile",
  publication_status: "scheduled",
  publish_at: "2026-08-10T09:00:00.000Z",
  expires_at: "2026-08-20T09:00:00.000Z",
  latest_version_id: 12,
  latest_version_number: 3,
  latest_version_status: "scheduled",
});
assert.equal(scheduledPage.key, "page:4");
assert.equal(scheduledPage.status, "scheduled");
assert.equal(scheduledPage.title, "Company Profile");
assert.equal(scheduledPage.publishAt.toISOString(), "2026-08-10T09:00:00.000Z");

const validSchedule = model.releaseSchedulePayload(
  "2026-08-10T09:00:00.000Z",
  "2026-08-20T09:00:00.000Z",
  NOW
);
assert.equal(validSchedule.valid, true);
assert.equal(validSchedule.payload.publish_at, "2026-08-10T09:00:00.000Z");
assert.equal(validSchedule.payload.expires_at, "2026-08-20T09:00:00.000Z");
assert.equal(model.releaseSchedulePayload("2026-08-08T09:00:00.000Z", "", NOW).valid, false);
assert.match(model.releaseSchedulePayload("2026-08-08T09:00:00.000Z", "", NOW).error, /future/i);
assert.equal(
  model.releaseSchedulePayload("2026-08-10T09:00:00.000Z", "2026-08-10T08:00:00.000Z", NOW).valid,
  false
);

const collisionItems = [
  scheduledPage,
  model.normalizePublisherRelease("article", {
    id: 8,
    title: "Field update",
    publication_status: "scheduled",
    publish_at: "2026-08-10T09:40:00.000Z",
  }),
  model.normalizePublisherRelease("project", {
    id: 9,
    name: "Far release",
    publication_status: "scheduled",
    publish_at: "2026-08-10T13:00:00.000Z",
  }),
].filter(Boolean);
const collisions = model.publisherCollisionMap(collisionItems, 60);
assert.equal(collisions.has("page:4"), true);
assert.equal(collisions.has("article:8"), true);
assert.equal(collisions.has("project:9"), false);

const timeline = model.buildPublisherTimeline(collisionItems, NOW, 21);
assert.equal(timeline.some((day) => day.events.some((event) => event.type === "publish" && event.item.key === "page:4")), true);
assert.equal(timeline.some((day) => day.events.some((event) => event.type === "expire" && event.item.key === "page:4")), true);

const approvals = model.normalizePublisherApprovals([
  { id: 1, approval_source: "page", requested_at: "2026-08-08T06:00:00.000Z" },
  { id: 2, approval_source: "newsroom", requested_at: "2026-08-06T06:00:00.000Z" },
  { id: 3, approval_source: "portfolio", requested_at: "2026-08-09T06:30:00.000Z" },
], NOW);
assert.equal(approvals[0].overdue, true);
assert.equal(approvals[0].severelyOverdue, false);
assert.equal(approvals[1].severelyOverdue, true);
assert.equal(approvals[2].overdue, false);

const summary = model.publisherCommandSummary(collisionItems, approvals, NOW);
assert.equal(summary.scheduled, 3);
assert.equal(summary.collisions, 2);
assert.equal(summary.overdueReviews, 2);
assert.equal(summary.severelyOverdueReviews, 1);

assert.equal(
  model.selectApprovedReleaseVersion({
    versions: [
      { id: 1, version_status: "published" },
      { id: 2, version_status: "approved" },
    ],
  }).id,
  2
);

for (const contract of [
  /listPages/,
  /listNewsroomEntities/,
  /listPortfolioEntities/,
  /listAllApprovals/,
  /selectApprovedReleaseVersion/,
  /Publish now/,
  /Schedule approved version/,
  /selected\.source === "page"/,
  /selected\.status !== "published"/,
  /replacementScheduleBlocked/,
  /futureScheduleUnavailable/,
  /version-handover upgrade/i,
  /version-aware scheduler/i,
  /Open Approval Inbox/,
  /COLLISION/,
  /24H\+/,
  /72H\+/,
]) assert.match(component, contract);

assert.doesNotMatch(component, /decideApproval/);
assert.doesNotMatch(component, /submitPageVersion|submitNewsroomVersion|submitPortfolioVersion/);
assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
assert.doesNotMatch(component, /<iframe/i);
assert.doesNotMatch(component, /eval\s*\(|new Function/);

assert.match(studioModel, /key: "publisher-command"/);
assert.match(studioModel, /permission: CONTENT_STUDIO_PERMISSIONS\.publish/);
assert.match(workspace, /ContentStudioPublisherCommandCenter/);
assert.match(workspace, /"publisher-command": "pages"/);
assert.match(workspace, /"publisher-command": ContentStudioPublisherCommandCenter/);
assert.match(workspace, /<ActiveManager onOpenSection=\{openSection\} \/>/);

for (const contract of [
  /@media \(max-width: 1180px\)/,
  /@media \(max-width: 900px\)/,
  /@media \(max-width: 620px\)/,
  /@media \(max-width: 390px\)/,
  /scroll-snap-type: x mandatory/,
  /pointer: coarse/,
  /prefers-reduced-motion: reduce/,
]) assert.match(css, contract);

assert.match(scheduler, /SCHEDULER_LOCK_NAME/);
assert.match(scheduler, /UTC_TIMESTAMP\(\)/);
assert.match(scheduler, /scheduled_page_published/);
assert.match(scheduler, /scheduled_content_published/);
assert.match(newsroomPublish, /NEWSROOM_SCHEDULING_NOT_READY/);
assert.match(newsroomPublish, /version-aware scheduler/);

console.log("✅ CHALIN ONE Phase 2F Publisher Command contracts passed: exact approved-version publishing, safe first-publication page scheduling, collision/timeline intelligence, overdue-review aging, unsupported future-scheduling boundaries and responsive command UX remain protected.");
