"use strict";

const CONTENT_STUDIO_PERMISSIONS = Object.freeze([
  "public_content.view",
  "public_content.create",
  "public_content.edit",
  "public_content.submit",
  "public_content.review",
  "public_content.approve",
  "public_content.publish",
  "public_content.archive",
  "public_content.restore_version",
  "public_media.view",
  "public_media.manage",
  "public_navigation.view",
  "public_navigation.manage",
  "public_settings.view",
  "public_settings.manage",
  "public_forms.view",
  "public_forms.manage",
  "public_submissions.view",
  "public_submissions.respond",
  "public_submissions.manage",
]);

const CONTENT_STUDIO_PERMISSION_GROUPS = Object.freeze({
  content: Object.freeze([
    "public_content.view",
    "public_content.create",
    "public_content.edit",
    "public_content.submit",
    "public_content.review",
    "public_content.approve",
    "public_content.publish",
    "public_content.archive",
    "public_content.restore_version",
  ]),
  media: Object.freeze(["public_media.view", "public_media.manage"]),
  navigation: Object.freeze([
    "public_navigation.view",
    "public_navigation.manage",
  ]),
  settings: Object.freeze([
    "public_settings.view",
    "public_settings.manage",
  ]),
  forms: Object.freeze(["public_forms.view", "public_forms.manage"]),
  submissions: Object.freeze([
    "public_submissions.view",
    "public_submissions.respond",
    "public_submissions.manage",
  ]),
});

const CONTENT_STUDIO_PROTECTED_GRANTS = Object.freeze([
  "public_settings.manage",
]);

function isContentStudioPermission(permissionCode) {
  return CONTENT_STUDIO_PERMISSIONS.includes(
    String(permissionCode || "").trim()
  );
}

module.exports = {
  CONTENT_STUDIO_PERMISSIONS,
  CONTENT_STUDIO_PERMISSION_GROUPS,
  CONTENT_STUDIO_PROTECTED_GRANTS,
  isContentStudioPermission,
};
