# CHALIN ONE AI Provider Adapter Contract

**Status:** Mandatory before any live provider registration  
**Default provider:** `disabled`  
**Production provider activation:** Not authorized

## 1. Adapter boundary

A provider adapter implements one method:

```js
async generate({ messages, tools, max_output_tokens })
```

It returns:

```js
{
  text,
  model_key,
  input_tokens,
  output_tokens,
  finish_reason,
  tool_calls
}
```

The adapter does not receive:

- Express request or response objects.
- User passwords, session tokens or authorization headers.
- Database connection information.
- MySQL pool or connection objects.
- Arbitrary environment variables.
- Raw files or private media paths.
- Unfiltered business records.
- Approval or execution authority.

## 2. Credential handling

Provider credentials:

- Exist only in the runtime secret manager or environment.
- Are read only inside the provider adapter factory.
- Are never persisted in `ai_provider_profiles` or another database table.
- Are never returned by an API.
- Are never placed in prompt content, tool output, logs, audit metadata or error responses.
- Are never accepted from a browser request.
- Must be unique to the CHALIN ONE environment.
- Must be revocable independently from ordinary CHALIN 03 credentials.

The adapter factory must expose only a provider object. It must not export the credential.

## 3. Network controls

A live adapter must:

- Use HTTPS only.
- Use a fixed official provider hostname allowlist.
- Reject redirects to another origin.
- Enforce a bounded connection and response timeout.
- Enforce a bounded response size.
- Avoid user-controlled URLs.
- Avoid arbitrary proxy configuration supplied by a user request.
- Use the provider's supported authentication header.
- Avoid recording full provider request bodies in infrastructure logs.

## 4. Data minimization

Before a provider call, the orchestrator already applies:

- Persona instructions.
- Workspace and location scope.
- Prompt safety inspection.
- Secret redaction.
- Approved knowledge retrieval.
- Permission-filtered tool definitions.
- Request token budget.

The provider adapter must not add unrelated database, conversation or user data.

Identity data should be replaced with references or aggregates when the task permits it.

## 5. Tool-call handling

Provider-returned tool calls are proposals to invoke a registered backend tool. They are not executable code.

The adapter must normalize each call into:

```js
{
  id,
  tool_key,
  input
}
```

The orchestrator then independently verifies:

- Tool registration.
- Persona.
- Permission.
- Workspace.
- Branch/site/location.
- Risk.
- `FEATURE_AI_ACTIONS` for risk 4+.
- Input size.
- Timeout.
- Output size.
- Evidence requirement.

The adapter may not execute tools itself.

## 6. Output handling

Provider output is not trusted until it passes:

- Non-empty response validation.
- Maximum output size.
- Secret-request inspection.
- Secret redaction.
- Tool-call count limit.
- Evidence and citation processing.

The adapter must return raw provider text to the orchestrator rather than rendering HTML.

## 7. Error behavior

The adapter must convert provider-specific failures into safe error categories without exposing credentials or full upstream payloads.

Required categories include:

- Authentication unavailable.
- Rate limited.
- Timeout.
- Service unavailable.
- Invalid response.
- Context/token limit.
- Policy refusal.

All failures must remain inside the AI request. They must not terminate the backend process or affect ordinary business routes.

## 8. Usage and price evidence

The adapter must return provider-reported token counts when available.

Before cost enforcement is enabled, management must approve:

- Provider.
- Model allowlist.
- Input price.
- Output price.
- Currency.
- Effective date.
- Monthly limit.
- Alert thresholds.

Costs are recorded as integer micros. Floating-point currency values are not used for governance limits.

## 9. Testing requirements

A provider adapter must have isolated tests for:

1. Valid request normalization.
2. Credential absence from returned objects.
3. Official-host allowlist.
4. Cross-origin redirect rejection.
5. Connection timeout.
6. Response timeout.
7. Oversized response rejection.
8. Malformed JSON.
9. Missing text.
10. Tool-call normalization.
11. Too many tool calls.
12. Provider rate limit.
13. Provider authentication failure.
14. Secret-looking provider output.
15. Network failure.
16. No effect on ordinary system operations.

Tests use a stub HTTP server or dependency-injected transport. They never call a live paid provider in normal CI.

## 10. Staging acceptance

A provider may be enabled only in isolated staging after:

- AI schema migration passes twice.
- Backend tests pass.
- MySQL acceptance passes.
- Frontend build passes.
- Provider adapter tests pass.
- Feature flags are enabled only in staging.
- Provider credentials are staging-only.
- Monthly cost limit is configured.
- Prompt and output safety events are verified.
- Usage ledger totals match provider evidence.
- Tool calls are permission-scoped.
- Human browser acceptance passes at desktop and 360–430px widths.

## 11. Production gate

Production provider activation requires separate written authorization after the entire CHALIN ONE release is accepted.

The production change must be reversible by:

```text
FEATURE_AI_ENABLED=false
AI_PROVIDER=disabled
```

No code deployment should be necessary to trigger the emergency shutdown.
