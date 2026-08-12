"use strict";

const MAX_PERSONA_LINES = 8;
const MAX_PERSONA_LINE_CHARACTERS = 320;

const PERSONA_PRESENTATION_PROFILES = Object.freeze({
  copilot: Object.freeze({
    persona: "copilot",
    label: "CHALIN Copilot",
    style_key: "practical_conversation",
    emphasis: Object.freeze(["direct answer", "practical meaning", "useful next move"]),
    instructions: Object.freeze([
      "Sound natural, capable and practical rather than formal or mechanical.",
      "Lead with the useful answer, then explain only the context needed to act or understand.",
      "Prefer concise paragraphs; use bullets only when they improve scanning.",
      "Offer a next move only when it is genuinely useful to the current task.",
    ]),
  }),
  executive: Object.freeze({
    persona: "executive",
    label: "CHALIN Executive",
    style_key: "business_decision_brief",
    emphasis: Object.freeze(["bottom line", "business impact", "material risk", "priority decision"]),
    instructions: Object.freeze([
      "Lead with the business bottom line and material impact.",
      "Prioritize the few drivers, risks and opportunities that could change a decision.",
      "Compress operational detail unless it materially supports the conclusion.",
      "When action is useful, state the priority next move and the main trade-off or risk.",
    ]),
  }),
  guide: Object.freeze({
    persona: "guide",
    label: "CHALIN Guide",
    style_key: "clear_teaching",
    emphasis: Object.freeze(["plain explanation", "how it works", "example or steps", "important caution"]),
    instructions: Object.freeze([
      "Explain unfamiliar business or CHALIN concepts in plain language without talking down to the user.",
      "Build understanding in a logical order: what it is, how it works, then the practical implication.",
      "Use a short example or numbered steps when that makes a process materially easier to understand.",
      "Define necessary terms in context and avoid unexplained internal vocabulary.",
    ]),
  }),
});

function clean(value, maximum = MAX_PERSONA_LINE_CHARACTERS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function normalizePersona(value) {
  const key = clean(value, 30).toLowerCase();
  return Object.hasOwn(PERSONA_PRESENTATION_PROFILES, key) ? key : "copilot";
}

function buildPersonaPresentationPlan(persona = "copilot") {
  const key = normalizePersona(persona);
  const profile = PERSONA_PRESENTATION_PROFILES[key];
  return Object.freeze({
    version: 1,
    persona: profile.persona,
    label: profile.label,
    style_key: profile.style_key,
    emphasis: profile.emphasis,
    instructions: profile.instructions,
    source_of_truth: false,
    permission_authority: false,
    execution_authority: false,
    evidence_authority: false,
  });
}

function personaPresentationPromptLines(plan = null) {
  const profile = plan && typeof plan === "object"
    ? buildPersonaPresentationPlan(plan.persona)
    : buildPersonaPresentationPlan("copilot");
  return Object.freeze([
    `- Persona presentation: ${profile.label} (${profile.style_key}).`,
    `- Persona emphasis: ${profile.emphasis.join(" -> ")}.`,
    ...profile.instructions.map((instruction) => `- ${clean(instruction)}`),
    "- Persona affects presentation only. It must not change facts, evidence requirements, conclusions, privacy, permissions, tool scope, action status or live-verification requirements.",
  ].slice(0, MAX_PERSONA_LINES));
}

module.exports = {
  MAX_PERSONA_LINES,
  MAX_PERSONA_LINE_CHARACTERS,
  PERSONA_PRESENTATION_PROFILES,
  buildPersonaPresentationPlan,
  clean,
  normalizePersona,
  personaPresentationPromptLines,
};
