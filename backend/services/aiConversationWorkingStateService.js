"use strict";

const LIMITS = Object.freeze({
  serializedChars: 7000,
  subjectChars: 240,
  objectiveChars: 320,
  correctionChars: 220,
  labelChars: 120,
  domains: 5,
  metrics: 8,
  entities: 4,
  periods: 4,
  questions: 5,
  corrections: 5,
  evidenceRefs: 12,
});

const ENTITY_TYPES = new Set(["location", "customer", "worker", "business", "unknown"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);

function cleanText(value, maxLength = 320) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function uniqueStrings(values, limit, maxLength = LIMITS.labelChars) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value, maxLength);
    if (!text) continue;
    if (output.some((item) => item.toLowerCase() === text.toLowerCase())) continue;
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function sanitizeEntity(value = {}) {
  if (typeof value === "string") {
    const label = cleanText(value, LIMITS.labelChars);
    if (!label) return null;
    return Object.freeze({
      type: "unknown",
      label,
      id: null,
      confidence: "low",
      ambiguous: true,
    });
  }

  if (!value || typeof value !== "object") return null;
  const label = cleanText(value.label ?? value.name ?? value.display_name, LIMITS.labelChars);
  const id = cleanText(value.id ?? value.entity_id ?? value.customer_id ?? value.worker_id ?? value.location_id, 120) || null;
  if (!label && !id) return null;

  const rawType = cleanText(value.type ?? value.entity_type, 40).toLowerCase();
  const type = ENTITY_TYPES.has(rawType) ? rawType : "unknown";
  const rawConfidence = cleanText(value.confidence, 20).toLowerCase();
  const confidence = CONFIDENCE_LEVELS.has(rawConfidence)
    ? rawConfidence
    : id
      ? "high"
      : "medium";
  const ambiguous = typeof value.ambiguous === "boolean" ? value.ambiguous : !id;

  return Object.freeze({
    type,
    label: label || id,
    id,
    confidence,
    ambiguous,
  });
}

function uniqueEntities(values = []) {
  const output = [];
  for (const candidate of Array.isArray(values) ? values : []) {
    const entity = sanitizeEntity(candidate);
    if (!entity) continue;
    const identity = `${entity.type}:${entity.id || entity.label}`.toLowerCase();
    if (output.some((item) => `${item.type}:${item.id || item.label}`.toLowerCase() === identity)) continue;
    output.push(entity);
    if (output.length >= LIMITS.entities) break;
  }
  return output;
}

function structuredEntities(taskState = {}, taskUnderstanding = {}) {
  const candidates = [];
  const append = (value, type) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) append(item, type);
      return;
    }
    if (typeof value === "string") {
      candidates.push({ type, label: value, id: null, confidence: "medium", ambiguous: true });
      return;
    }
    if (typeof value === "object") candidates.push({ type, ...value });
  };

  append(taskState.entities, "unknown");
  append(taskState.entity, "unknown");
  append(taskState.customer, "customer");
  append(taskState.worker, "worker");
  append(taskState.location, "location");
  append(taskState.business, "business");

  for (const location of Array.isArray(taskUnderstanding.location_hints)
    ? taskUnderstanding.location_hints
    : []) {
    append(location, "location");
  }

  return uniqueEntities(candidates);
}

function evidenceReferences(evidence = []) {
  const refs = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!item || typeof item !== "object") continue;
    const ref = cleanText(
      item.evidence_id ?? item.evidence_ref ?? item.source_ref ?? item.id,
      220
    );
    if (ref) refs.push(ref);
  }
  return uniqueStrings(refs, LIMITS.evidenceRefs, 220);
}

function sanitizePendingAction(value = {}) {
  if (!value || typeof value !== "object") {
    return Object.freeze({ id: null, proposal_id: null, risk: null, status: null });
  }
  return Object.freeze({
    id: cleanText(value.id ?? value.action_id, 120) || null,
    proposal_id: cleanText(value.proposal_id, 120) || null,
    risk: cleanText(value.risk ?? value.risk_level, 40) || null,
    status: cleanText(value.status, 60) || null,
  });
}

function correctionFromPrompt(prompt) {
  const text = cleanText(prompt, LIMITS.correctionChars);
  if (!text) return null;
  if (/\b(?:actually|correction|i mean|i meant|not\s+.+\s+but\s+)\b/i.test(text)) return text;
  return null;
}

function currentSubject(prompt, previousState, continuityRequired) {
  const text = cleanText(prompt, LIMITS.subjectChars);
  if (!text) return cleanText(previousState?.subject, LIMITS.subjectChars);
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const shortFollowUp = continuityRequired && tokenCount <= 7;
  if (shortFollowUp && previousState?.subject) {
    return cleanText(previousState.subject, LIMITS.subjectChars);
  }
  return text;
}

function sanitizeConversationWorkingState(state = {}) {
  const periods = state?.periods && typeof state.periods === "object" ? state.periods : {};
  const safe = {
    version: 1,
    source_of_truth: false,
    subject: cleanText(state.subject, LIMITS.subjectChars),
    domains: uniqueStrings(state.domains, LIMITS.domains, 80),
    entities: uniqueEntities(state.entities),
    periods: {
      active: uniqueStrings(periods.active, LIMITS.periods, 80),
      comparison: uniqueStrings(periods.comparison, LIMITS.periods, 80),
    },
    metrics: uniqueStrings(state.metrics, LIMITS.metrics, 80),
    objective: cleanText(state.objective, LIMITS.objectiveChars),
    answer_mode: cleanText(state.answer_mode, 60) || "generic",
    open_questions: uniqueStrings(state.open_questions, LIMITS.questions, LIMITS.objectiveChars),
    corrections: uniqueStrings(state.corrections, LIMITS.corrections, LIMITS.correctionChars),
    evidence_refs: uniqueStrings(state.evidence_refs, LIMITS.evidenceRefs, 220),
    last_tool: cleanText(state.last_tool, 120) || null,
    pending_action: sanitizePendingAction(state.pending_action),
    live_verification_required: Boolean(state.live_verification_required),
  };

  const shrinkSteps = [
    () => { safe.evidence_refs = safe.evidence_refs.slice(0, 8); },
    () => { safe.open_questions = safe.open_questions.slice(0, 3); },
    () => { safe.corrections = safe.corrections.slice(0, 3); },
    () => { safe.entities = safe.entities.slice(0, 3); },
    () => { safe.metrics = safe.metrics.slice(0, 6); },
    () => { safe.subject = cleanText(safe.subject, 160); },
    () => { safe.objective = cleanText(safe.objective, 200); },
  ];
  for (const shrink of shrinkSteps) {
    if (JSON.stringify(safe).length <= LIMITS.serializedChars) break;
    shrink();
  }

  return Object.freeze({
    ...safe,
    domains: Object.freeze([...safe.domains]),
    entities: Object.freeze([...safe.entities]),
    periods: Object.freeze({
      active: Object.freeze([...safe.periods.active]),
      comparison: Object.freeze([...safe.periods.comparison]),
    }),
    metrics: Object.freeze([...safe.metrics]),
    open_questions: Object.freeze([...safe.open_questions]),
    corrections: Object.freeze([...safe.corrections]),
    evidence_refs: Object.freeze([...safe.evidence_refs]),
  });
}

function buildConversationWorkingState({
  prompt = "",
  conversation = [],
  previousState = null,
  taskUnderstanding = null,
  taskState = null,
  evidence = [],
  lastTool = null,
  pendingAction = null,
} = {}) {
  const previous = sanitizeConversationWorkingState(previousState || {});
  const understanding = taskUnderstanding && typeof taskUnderstanding === "object"
    ? taskUnderstanding
    : {};
  const phaseState = taskState && typeof taskState === "object" ? taskState : {};
  const continuityRequired = Boolean(
    understanding.continuity_required ?? phaseState.follow_up ?? false
  );

  const currentDomains = uniqueStrings(understanding.domains, LIMITS.domains, 80);
  const domains = currentDomains.length
    ? currentDomains
    : continuityRequired
      ? previous.domains
      : [];

  const currentMetrics = uniqueStrings(understanding.metric_hints, LIMITS.metrics, 80);
  const metrics = currentMetrics.length
    ? uniqueStrings([...currentMetrics, ...(continuityRequired ? previous.metrics : [])], LIMITS.metrics, 80)
    : continuityRequired
      ? previous.metrics
      : [];

  const currentPeriods = uniqueStrings(understanding.time_hints, LIMITS.periods, 80);
  let activePeriods = currentPeriods;
  let comparisonPeriods = continuityRequired ? previous.periods.comparison : [];
  if (!currentPeriods.length && continuityRequired) {
    activePeriods = previous.periods.active;
    comparisonPeriods = previous.periods.comparison;
  }
  if (currentPeriods.length && continuityRequired && previous.periods.active.length) {
    const changed = currentPeriods.some(
      (item) => !previous.periods.active.some((prior) => prior.toLowerCase() === item.toLowerCase())
    );
    if (changed) {
      comparisonPeriods = uniqueStrings(
        [...previous.periods.active, ...previous.periods.comparison],
        LIMITS.periods,
        80
      );
    }
  }
  if (/\b(?:compare|comparison|versus|vs\.?|against)\b/i.test(cleanText(prompt, 2000))) {
    comparisonPeriods = uniqueStrings(
      [...comparisonPeriods, ...previous.periods.active, ...previous.periods.comparison],
      LIMITS.periods,
      80
    );
  }

  const currentEntities = structuredEntities(phaseState, understanding);
  const corrected = correctionFromPrompt(prompt);
  let entities = currentEntities.length
    ? currentEntities
    : continuityRequired
      ? previous.entities
      : [];
  if (corrected && currentEntities.length) {
    const currentLocation = currentEntities.find((item) => item.type === "location");
    if (currentLocation) {
      entities = [
        currentLocation,
        ...entities.filter((item) => item.type !== "location"),
      ].slice(0, LIMITS.entities);
    }
  }

  const objectives = uniqueStrings(understanding.objectives, LIMITS.questions, LIMITS.objectiveChars);
  const objective = cleanText(
    objectives[0] ?? phaseState.current_prompt ?? prompt ?? previous.objective,
    LIMITS.objectiveChars
  );
  const openQuestions = objectives.length > 1
    ? objectives.slice(1)
    : continuityRequired
      ? previous.open_questions
      : [];

  const corrections = uniqueStrings(
    [
      ...(corrected ? [corrected] : []),
      ...(continuityRequired ? previous.corrections : []),
    ],
    LIMITS.corrections,
    LIMITS.correctionChars
  );

  const currentEvidenceRefs = evidenceReferences(evidence);
  const evidenceRefs = currentEvidenceRefs.length
    ? currentEvidenceRefs
    : [];

  return sanitizeConversationWorkingState({
    subject: currentSubject(prompt, previous, continuityRequired),
    domains,
    entities,
    periods: {
      active: activePeriods,
      comparison: comparisonPeriods,
    },
    metrics,
    objective,
    answer_mode: understanding.answer_mode ?? previous.answer_mode ?? "generic",
    open_questions: openQuestions,
    corrections,
    evidence_refs: evidenceRefs,
    last_tool: lastTool ?? null,
    pending_action: pendingAction ?? null,
    live_verification_required: Boolean(understanding.live_data_required),
  });
}

module.exports = {
  LIMITS,
  buildConversationWorkingState,
  sanitizeConversationWorkingState,
};
