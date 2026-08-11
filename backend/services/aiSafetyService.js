"use strict";

const crypto = require("crypto");

const MAX_PROMPT_CHARACTERS = 32000;
const MAX_PROVIDER_MESSAGES = 100;
const MAX_PROVIDER_CONTEXT_CHARACTERS = 240000;
const MAX_PROVIDER_ESSENTIAL_MESSAGE_CHARACTERS = 24000;
const MIN_PROVIDER_PARTIAL_HISTORY_CHARACTERS = 2000;
const MAX_PROVIDER_OUTPUT_CHARACTERS = 120000;
const MAX_SAFE_SUMMARY_CHARACTERS = 800;

const PROMPT_INJECTION_PATTERNS = Object.freeze([
  Object.freeze({ key: "ignore_instructions", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?)/i }),
  Object.freeze({ key: "reveal_system_prompt", pattern: /(reveal|show|print|repeat|quote)\s+(the\s+)?(system|developer)\s+(prompt|message|instructions?)/i }),
  Object.freeze({ key: "bypass_guardrails", pattern: /(bypass|disable|remove|override)\s+(safety|security|guardrails?|permissions?|policy)/i }),
  Object.freeze({ key: "role_override", pattern: /(act|pretend|behave)\s+as\s+(an?\s+)?(unrestricted|uncensored|root|database|system)\b/i }),
  Object.freeze({ key: "hidden_instruction_extraction", pattern: /(hidden|internal|private)\s+(instructions?|chain\s+of\s+thought|reasoning|prompt)/i }),
]);

const SECRET_REQUEST_PATTERNS = Object.freeze([
  Object.freeze({ key: "credential_request", pattern: /(show|reveal|print|give|return|list|extract)\s+.{0,40}(password|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|jwt|database[_ -]?url|db[_ -]?password)/i }),
  Object.freeze({ key: "environment_dump", pattern: /(show|print|dump|return|list)\s+.{0,30}(environment variables|process\.env|\.env file|runtime secrets)/i }),
  Object.freeze({ key: "raw_auth_header", pattern: /(show|reveal|return)\s+.{0,30}(authorization header|bearer token|session token)/i }),
]);

const HIGH_RISK_ACTION_PATTERNS = Object.freeze([
  Object.freeze({ key: "delete_transactions", pattern: /\b(delete|erase|remove)\b.{0,50}\b(sale|payment|debt|transaction|audit)\b/i }),
  Object.freeze({ key: "merge_customer", pattern: /\bmerge\b.{0,30}\bcustomers?\b/i }),
  Object.freeze({ key: "change_price_stock", pattern: /\b(change|alter|update|set)\b.{0,40}\b(price|stock|quantity|balance)\b/i }),
  Object.freeze({ key: "finance_decision", pattern: /\b(approve|reject|waive)\b.{0,50}\b(finance|application|arrears|debt|installment)\b/i }),
  Object.freeze({ key: "release_equipment", pattern: /\b(release|dispatch|deliver)\b.{0,40}\b(equipment|asset|machine)\b/i }),
  Object.freeze({ key: "restore_backup", pattern: /\b(restore|overwrite)\b.{0,40}\b(database|backup)\b/i }),
  Object.freeze({ key: "permission_change", pattern: /\b(create|delete|disable|change|grant|revoke)\b.{0,40}\b(admin|administrator|permission|role|user access)\b/i }),
  Object.freeze({ key: "mass_communication", pattern: /\b(send|broadcast)\b.{0,40}\b(all|mass|every customer|bulk)\b.{0,30}\b(sms|email|message|whatsapp)\b/i }),
]);

const REDACTION_PATTERNS = Object.freeze([
  Object.freeze({ key: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}\b/gi, replacement: "Bearer [REDACTED]" }),
  Object.freeze({ key: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED_JWT]" }),
  Object.freeze({ key: "credential_assignment", pattern: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|db[_-]?password)\s*[:=]\s*([^\s,;]+)/gi, replacement: "$1=[REDACTED]" }),
  Object.freeze({ key: "database_url", pattern: /\b(mysql|postgres(?:ql)?):\/\/[^\s]+/gi, replacement: "[REDACTED_DATABASE_URL]" }),
  Object.freeze({ key: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" }),
]);

class AiSafetyError extends Error {
  constructor(message, { code = "AI_SAFETY_BLOCKED", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiSafetyError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function cleanText(value, maxLength = MAX_PROMPT_CHARACTERS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function hashText(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function findPatternKeys(text, definitions) {
  return definitions
    .filter((definition) => definition.pattern.test(text))
    .map((definition) => definition.key);
}

function redactSensitiveText(value) {
  let text = cleanText(value, MAX_PROMPT_CHARACTERS);
  const patternKeys = [];
  let redactionCount = 0;

  for (const definition of REDACTION_PATTERNS) {
    definition.pattern.lastIndex = 0;
    const matches = text.match(definition.pattern) || [];
    if (matches.length === 0) continue;
    patternKeys.push(definition.key);
    redactionCount += matches.length;
    definition.pattern.lastIndex = 0;
    text = text.replace(definition.pattern, definition.replacement);
  }

  return Object.freeze({
    text,
    pattern_keys: [...new Set(patternKeys)],
    redaction_count: redactionCount,
  });
}

function inspectPrompt(value, { allowHighRiskDiscussion = true } = {}) {
  const original = cleanText(value, MAX_PROMPT_CHARACTERS + 1);
  if (!original) {
    throw new AiSafetyError(
      "Enter a message before using CHALIN ONE intelligence.",
      { code: "AI_PROMPT_REQUIRED" }
    );
  }
  if (original.length > MAX_PROMPT_CHARACTERS) {
    throw new AiSafetyError(
      `AI messages may not exceed ${MAX_PROMPT_CHARACTERS} characters.`,
      { code: "AI_PROMPT_TOO_LARGE", statusCode: 413 }
    );
  }

  const injectionKeys = findPatternKeys(
    original,
    PROMPT_INJECTION_PATTERNS
  );
  const secretKeys = findPatternKeys(original, SECRET_REQUEST_PATTERNS);
  const highRiskKeys = findPatternKeys(
    original,
    HIGH_RISK_ACTION_PATTERNS
  );
  const redacted = redactSensitiveText(original);

  if (injectionKeys.length > 0 || secretKeys.length > 0) {
    throw new AiSafetyError(
      "This request attempts to override security controls or expose restricted information.",
      {
        code:
          injectionKeys.length > 0
            ? "AI_PROMPT_INJECTION_BLOCKED"
            : "AI_SECRET_REQUEST_BLOCKED",
        details: [...injectionKeys, ...secretKeys],
      }
    );
  }

  if (!allowHighRiskDiscussion && highRiskKeys.length > 0) {
    throw new AiSafetyError(
      "This AI release cannot execute or prepare that sensitive action.",
      { code: "AI_HIGH_RISK_ACTION_BLOCKED", details: highRiskKeys }
    );
  }

  return Object.freeze({
    action: redacted.redaction_count > 0 ? "redacted" : "allowed",
    text: redacted.text,
    input_sha256: hashText(original),
    pattern_keys: [
      ...new Set([...redacted.pattern_keys, ...highRiskKeys]),
    ],
    prompt_injection_keys: injectionKeys,
    secret_request_keys: secretKeys,
    high_risk_action_keys: highRiskKeys,
    redaction_count: redacted.redaction_count,
    safe_summary: redacted.text.slice(0, MAX_SAFE_SUMMARY_CHARACTERS),
  });
}

function truncateProviderContent(content, maximum) {
  const text = String(content || "");
  const safeMaximum = Math.max(256, Number(maximum) || MAX_PROVIDER_ESSENTIAL_MESSAGE_CHARACTERS);
  if (text.length <= safeMaximum) return text;
  const marker = "\n[Transport compacted: lower-priority content omitted.]";
  return `${text.slice(0, Math.max(1, safeMaximum - marker.length))}${marker}`;
}

function providerMessageCharacters(messages = []) {
  return (Array.isArray(messages) ? messages : []).reduce(
    (sum, message) => sum + String(message?.content || "").length,
    0
  );
}

function compactSanitizedProviderMessages(
  messages = [],
  { maximumCharacters = MAX_PROVIDER_CONTEXT_CHARACTERS } = {}
) {
  const source = Array.isArray(messages) ? messages : [];
  const maximum = Math.max(32000, Number(maximumCharacters) || MAX_PROVIDER_CONTEXT_CHARACTERS);
  if (providerMessageCharacters(source) <= maximum) return source;

  let latestUserIndex = -1;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (source[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  const essentialIndexes = new Set();
  source.forEach((message, index) => {
    if (["system", "tool"].includes(message?.role)) essentialIndexes.add(index);
  });
  if (latestUserIndex >= 0) essentialIndexes.add(latestUserIndex);

  const essentialCount = Math.max(1, essentialIndexes.size);
  const latestUserLength = latestUserIndex >= 0
    ? String(source[latestUserIndex]?.content || "").length
    : 0;
  const otherEssentialCount = Math.max(1, essentialCount - (latestUserIndex >= 0 ? 1 : 0));
  const essentialAllowance = Math.max(
    4000,
    Math.min(
      MAX_PROVIDER_ESSENTIAL_MESSAGE_CHARACTERS,
      Math.floor((maximum - Math.min(latestUserLength, MAX_PROMPT_CHARACTERS)) / otherEssentialCount)
    )
  );

  const selected = new Map();
  let usedCharacters = 0;

  for (const index of [...essentialIndexes].sort((a, b) => a - b)) {
    const message = source[index];
    const content = index === latestUserIndex
      ? message.content
      : truncateProviderContent(message.content, essentialAllowance);
    const compact = Object.freeze({ role: message.role, content });
    selected.set(index, compact);
    usedCharacters += content.length;
  }

  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (selected.has(index)) continue;
    const message = source[index];
    if (!["user", "assistant"].includes(message?.role)) continue;
    const remaining = maximum - usedCharacters;
    if (remaining <= 0) break;
    if (message.content.length <= remaining) {
      selected.set(index, message);
      usedCharacters += message.content.length;
      continue;
    }
    if (remaining >= MIN_PROVIDER_PARTIAL_HISTORY_CHARACTERS) {
      const content = truncateProviderContent(message.content, remaining);
      selected.set(index, Object.freeze({ role: message.role, content }));
      usedCharacters += content.length;
    }
    break;
  }

  return Object.freeze(
    [...selected.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, message]) => message)
  );
}

function sanitizeProviderMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AiSafetyError("At least one AI message is required.", {
      code: "AI_MESSAGES_REQUIRED",
    });
  }
  if (messages.length > MAX_PROVIDER_MESSAGES) {
    throw new AiSafetyError(
      `AI requests may contain at most ${MAX_PROVIDER_MESSAGES} messages.`,
      { code: "AI_MESSAGE_LIMIT_EXCEEDED", statusCode: 413 }
    );
  }

  const sanitized = messages.map((message, index) => {
    const role = String(message?.role || "").trim().toLowerCase();
    if (!["system", "user", "assistant", "tool"].includes(role)) {
      throw new AiSafetyError(
        `Invalid AI message role at position ${index}.`,
        { code: "AI_MESSAGE_ROLE_INVALID" }
      );
    }
    const content = cleanText(
      message?.content,
      MAX_PROMPT_CHARACTERS + 1
    );
    if (!content || content.length > MAX_PROMPT_CHARACTERS) {
      throw new AiSafetyError(
        `Invalid AI message content at position ${index}.`,
        {
          code: "AI_MESSAGE_CONTENT_INVALID",
          statusCode:
            content.length > MAX_PROMPT_CHARACTERS ? 413 : 400,
        }
      );
    }
    const redacted = redactSensitiveText(content);
    return Object.freeze({ role, content: redacted.text });
  });

  return compactSanitizedProviderMessages(sanitized);
}

function validateProviderOutput(value) {
  const text = cleanText(value, MAX_PROVIDER_OUTPUT_CHARACTERS + 1);
  if (!text) {
    throw new AiSafetyError("The AI provider returned an empty response.", {
      code: "AI_PROVIDER_EMPTY_RESPONSE",
      statusCode: 502,
    });
  }
  if (text.length > MAX_PROVIDER_OUTPUT_CHARACTERS) {
    throw new AiSafetyError(
      "The AI provider response exceeded the safe output limit.",
      { code: "AI_PROVIDER_OUTPUT_TOO_LARGE", statusCode: 502 }
    );
  }

  const secretKeys = findPatternKeys(text, SECRET_REQUEST_PATTERNS);
  const redacted = redactSensitiveText(text);
  if (secretKeys.length > 0) {
    throw new AiSafetyError(
      "The AI provider response failed the security review.",
      {
        code: "AI_PROVIDER_OUTPUT_BLOCKED",
        statusCode: 502,
        details: secretKeys,
      }
    );
  }

  return Object.freeze({
    text: redacted.text,
    output_sha256: hashText(text),
    redaction_count: redacted.redaction_count,
    pattern_keys: redacted.pattern_keys,
  });
}

module.exports = {
  AiSafetyError,
  HIGH_RISK_ACTION_PATTERNS,
  MAX_PROMPT_CHARACTERS,
  MAX_PROVIDER_CONTEXT_CHARACTERS,
  MAX_PROVIDER_ESSENTIAL_MESSAGE_CHARACTERS,
  MAX_PROVIDER_MESSAGES,
  MAX_PROVIDER_OUTPUT_CHARACTERS,
  PROMPT_INJECTION_PATTERNS,
  REDACTION_PATTERNS,
  SECRET_REQUEST_PATTERNS,
  cleanText,
  compactSanitizedProviderMessages,
  findPatternKeys,
  hashText,
  inspectPrompt,
  providerMessageCharacters,
  redactSensitiveText,
  sanitizeProviderMessages,
  truncateProviderContent,
  validateProviderOutput,
};
