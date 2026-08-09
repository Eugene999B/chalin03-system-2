export const CONTENT_STUDIO_PERMISSIONS = Object.freeze({
  view: "public_content.view",
  create: "public_content.create",
  edit: "public_content.edit",
  submit: "public_content.submit",
  review: "public_content.review",
  approve: "public_content.approve",
  publish: "public_content.publish",
  restore: "public_content.restore_version",
  archive: "public_content.archive",
  mediaView: "public_media.view",
  mediaManage: "public_media.manage",
  formsView: "public_forms.view",
  formsManage: "public_forms.manage",
  submissionsView: "public_submissions.view",
  submissionsRespond: "public_submissions.respond",
  submissionsManage: "public_submissions.manage",
  navigationView: "public_navigation.view",
  navigationManage: "public_navigation.manage",
  settingsView: "public_settings.view",
  settingsManage: "public_settings.manage",
});

export const CONTENT_STUDIO_SECTIONS = Object.freeze([
  Object.freeze({
    key: "visual-builder",
    label: "Visual Builder",
    shortLabel: "Visual Builder",
    badge: "VB",
    description: "Compose governed pages visually with reusable sections and responsive preview.",
    permission: CONTENT_STUDIO_PERMISSIONS.view,
    endpoint: "/content-studio/pages",
    group: "Content",
    tone: "blue",
  }),
  Object.freeze({
    key: "pages",
    label: "Pages",
    shortLabel: "Pages",
    badge: "PG",
    description: "Build website pages and reusable sections with version history.",
    permission: CONTENT_STUDIO_PERMISSIONS.view,
    endpoint: "/content-studio/pages",
    group: "Content",
    tone: "blue",
  }),
  Object.freeze({
    key: "newsroom",
    label: "Newsroom",
    shortLabel: "News",
    badge: "NW",
    description: "Prepare articles, announcements and news categories.",
    permission: CONTENT_STUDIO_PERMISSIONS.view,
    endpoint: "/content-studio/newsroom/article",
    group: "Content",
    tone: "blue",
  }),
  Object.freeze({
    key: "leadership",
    label: "Leadership",
    shortLabel: "Leaders",
    badge: "LD",
    description: "Manage leadership profiles, biographies and approved portraits.",
    permission: CONTENT_STUDIO_PERMISSIONS.view,
    endpoint: "/content-studio/portfolio/leadership",
    group: "Company",
    tone: "navy",
  }),
  Object.freeze({
    key: "projects",
    label: "Projects",
    shortLabel: "Projects",
    badge: "PJ",
    description: "Publish projects, status information and approved galleries.",
    permission: CONTENT_STUDIO_PERMISSIONS.view,
    endpoint: "/content-studio/portfolio/project",
    group: "Company",
    tone: "navy",
  }),
  Object.freeze({
    key: "equipment",
    label: "Public Equipment",
    shortLabel: "Equipment",
    badge: "EQ",
    description: "Maintain the public equipment sales, hire and finance catalogue.",
    permission: CONTENT_STUDIO_PERMISSIONS.view,
    endpoint: "/content-studio/portfolio/equipment",
    group: "Company",
    tone: "navy",
  }),
  Object.freeze({
    key: "company-info",
    label: "Company Information",
    shortLabel: "Company",
    badge: "CI",
    description: "Manage divisions, locations, statistics, testimonials, FAQs, jobs and tenders.",
    permission: CONTENT_STUDIO_PERMISSIONS.view,
    endpoint: "/content-studio/company-info/division",
    group: "Company",
    tone: "navy",
  }),
  Object.freeze({
    key: "media",
    label: "Media Library",
    shortLabel: "Media",
    badge: "ML",
    description: "Upload, organize and safely reuse approved images and videos.",
    permission: CONTENT_STUDIO_PERMISSIONS.mediaView,
    endpoint: "/content-studio/media",
    group: "Assets",
    tone: "green",
  }),
  Object.freeze({
    key: "forms",
    label: "Form Builder",
    shortLabel: "Forms",
    badge: "FB",
    description: "Create safe public enquiry, quotation and application forms.",
    permission: CONTENT_STUDIO_PERMISSIONS.formsView,
    endpoint: "/content-studio/forms",
    group: "Engagement",
    tone: "green",
  }),
  Object.freeze({
    key: "submissions",
    label: "Enquiry Desk",
    shortLabel: "Enquiries",
    badge: "ED",
    description: "Assign, review and resolve private website submissions.",
    permission: CONTENT_STUDIO_PERMISSIONS.submissionsView,
    endpoint: "/content-studio/submissions",
    group: "Engagement",
    tone: "orange",
  }),
  Object.freeze({
    key: "approvals",
    label: "Approval Inbox",
    shortLabel: "Approvals",
    badge: "AI",
    description: "Review exact saved versions before controlled publication.",
    permission: CONTENT_STUDIO_PERMISSIONS.review,
    endpoint: "/content-studio/approvals",
    group: "Governance",
    tone: "orange",
  }),
  Object.freeze({
    key: "publisher-command",
    label: "Publisher Command",
    shortLabel: "Publisher",
    badge: "PC",
    description: "Control approved releases, scheduling visibility, collisions, expiries and review aging from one governed desk.",
    permission: CONTENT_STUDIO_PERMISSIONS.publish,
    endpoint: "/content-studio/pages",
    group: "Governance",
    tone: "orange",
  }),
  Object.freeze({
    key: "navigation",
    label: "Navigation",
    shortLabel: "Menus",
    badge: "NV",
    description: "Manage approved header, mobile, utility and footer menus.",
    permission: CONTENT_STUDIO_PERMISSIONS.navigationView,
    endpoint: "/content-studio/navigation",
    group: "Website",
    tone: "slate",
  }),
  Object.freeze({
    key: "settings",
    label: "Website Settings",
    shortLabel: "Settings",
    badge: "WS",
    description: "Control approved branding, contact, legal, safety and SEO settings.",
    permission: CONTENT_STUDIO_PERMISSIONS.settingsView,
    endpoint: "/content-studio/settings",
    group: "Website",
    tone: "slate",
  }),
]);

export function canAccessContentStudioSection(section, hasPermission) {
  if (!section || typeof hasPermission !== "function") return false;
  return hasPermission(section.permission) === true;
}

export function getAccessibleContentStudioSections(hasPermission) {
  return CONTENT_STUDIO_SECTIONS.filter((section) =>
    canAccessContentStudioSection(section, hasPermission)
  );
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function normalizeContentStudioDashboard(raw = {}) {
  const pages = raw.pages || {};
  const approvals = raw.approvals || {};
  const submissions = raw.submissions || {};
  const media = raw.media || {};

  return {
    pages: {
      total: numericValue(pages.total_pages),
      draft: numericValue(pages.draft_pages),
      inReview: numericValue(pages.pages_in_review),
      approved: numericValue(pages.approved_pages),
      scheduled: numericValue(pages.scheduled_pages),
      published: numericValue(pages.published_pages),
      archived: numericValue(pages.archived_pages),
    },
    approvals: {
      total: numericValue(approvals.total_approvals),
      pending: numericValue(approvals.pending_approvals),
      approved: numericValue(approvals.approved_requests),
      rejected: numericValue(approvals.rejected_requests),
    },
    submissions: {
      total: numericValue(submissions.total_submissions),
      new: numericValue(submissions.new_submissions),
      inReview: numericValue(submissions.submissions_in_review),
      resolved: numericValue(submissions.resolved_submissions),
    },
    media: {
      total: numericValue(media.total_media),
      pending: numericValue(media.pending_media),
      ready: numericValue(media.ready_media),
      quarantined: numericValue(media.quarantined_media),
    },
  };
}

export function formatContentStudioCount(value) {
  const number = numericValue(value);
  return new Intl.NumberFormat("en-GH").format(number);
}

export function contentStudioStatusTone(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["published", "approved", "ready", "resolved", "success"].includes(normalized)) {
    return "success";
  }
  if (["rejected", "archived", "quarantined", "failed", "danger"].includes(normalized)) {
    return "danger";
  }
  if (["pending", "draft", "in_review", "scheduled", "warning"].includes(normalized)) {
    return "warning";
  }
  return "neutral";
}
