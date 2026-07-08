# Supabase Schema and Policy Notes for Acttub Slice 1

This document records the Supabase persistence contract for the Slice 1 MVP. The executable SQL lives in `supabase/migrations/001_acttub_slice1_schema.sql`.

## Scope

The schema supports the current product invariant: Acttub is a question-based acting practice partner, not an evaluator. The database stores session state, a single uploaded take, analysis observations, question turns, actor-authored summary text, and validation events.

Out of scope for this migration:

- score, rating, grade, verdict, strength, weakness, or diagnosis fields
- before/after comparison state
- retake workflows
- long-term progress reports
- mobile-specific tables

## Tables

### `acttub.coach_sessions`

One practice flow. Required MVP context is stored directly on the session so a future Spring Boot API can serve `/api/v1/sessions/{sessionId}` without reconstructing state from client memory.

Key fields:

- `actor_id`: Supabase auth user id when authenticated.
- `anonymous_token`: fallback owner token for non-authenticated alpha flows. RLS policies currently protect authenticated rows; anonymous-token access must stay server-mediated.
- `status`: session lifecycle (`draft`, `analyzing`, `awaiting_observation_confirmation`, `questioning`, `summarizing`, `completed`, `abandoned`).
- `medium`, `genre`, `situation`, `character_context`, `subtext`: scene context from the input step.
- `final_actor_sentence`: actor-authored filled-thought sentence saved at completion.

### `acttub.coach_takes`

One uploaded acting video for a session.

Key fields:

- `storage_bucket`: defaults to `coach-takes`.
- `storage_key`: private Supabase Storage object path.
- `analysis_status`: one-time video analysis state.
- `analysis_error`: operational failure detail, not user-facing judgment.

### `acttub.coach_observations`

Timestamped observations produced by the one-time analysis pass.

Key fields:

- `timestamp_start_ms`, `timestamp_end_ms`: video evidence anchor.
- `observation_text`: observable cue text.
- `confidence`: analysis confidence for routing confirmation.
- `confirmation_state`: `unasked`, `accepted`, `rejected`, or `unsure`.
- `blocked_for_questioning`: must be `true` when `confirmation_state = 'rejected'`.
- `source_payload`: raw/provider metadata for server-side audit.

Important invariant: rejected observations cannot be reused as question grounds. This is enforced by the `coach_observations_rejected_blocked` check and by the `coach_turns_source_observations_groundable` check.

### `acttub.coach_turns`

Conversation log. Each assistant question is one turn and should contain one question only; generation code must enforce the one-question rule before insert.

Key fields:

- `speaker`: `actor` or `assistant`.
- `content`: turn text.
- `question_focus`: focus axis for assistant questions.
- `source_observation_ids`: accepted, non-blocked observations used as grounds.
- `turn_state`: `question`, `answer`, `hint`, `redirect`, or `summary_prompt`.

### `acttub.validation_events`

Low-level validation/audit events for alpha learning, including rejected-observation reuse checks and forbidden-language checks.

## Storage

The migration creates a private bucket:

- bucket id/name: `coach-takes`
- public: `false`
- max size: `524288000` bytes
- allowed MIME types: `video/mp4`, `video/quicktime`, `video/webm`

Authenticated actor upload paths must begin with the user id:

```text
{auth.uid()}/{sessionId}/{takeId}.{extension}
```

The server should persist that path as `coach_takes.storage_key`. Signed URLs should be short-lived and generated server-side.

## RLS Policy Model

Authenticated actors can select/insert/update their own sessions and nested rows. Nested rows are authorized through `coach_sessions.actor_id = auth.uid()`.

Anonymous alpha access is intentionally not opened directly through RLS. If the UI supports anonymous tokens before full auth, the Next.js route handler or future Spring Boot API must mediate those requests with a server credential and validate `anonymous_token` itself.

Server-side analysis jobs and migration backfills should use the Supabase service role or database owner role. Do not expose service-role keys to the browser.

## API Contract Mapping

The schema maps to the planned REST surface:

- `POST /api/v1/sessions` creates `coach_sessions`, uploads/links one `coach_takes` row, starts analysis, and returns session state.
- `GET /api/v1/sessions/{sessionId}` reads session/take/observation/turn/summary state.
- `GET /api/v1/sessions/{sessionId}/observations` returns observations that need confirmation.
- `PATCH /api/v1/sessions/{sessionId}/observations/{observationId}` updates `confirmation_state`; `rejected` must set `blocked_for_questioning=true`.
- `POST /api/v1/sessions/{sessionId}/turns` records the actor answer and the next assistant question/hint/redirect.
- `PUT /api/v1/sessions/{sessionId}/summary` stores `final_actor_sentence` and moves the session to `completed`.

## Product Safety Checks Backed by Schema

- No evaluator-style result columns exist.
- Rejected observations are blocked at observation state level.
- Assistant turns cannot cite rejected or unsure observations through `source_observation_ids`.
- Final session output is an actor-authored sentence on `coach_sessions`, not an AI-authored conclusion table.

## Open Implementation Notes

- The current repository may still use mock persistence for early UI/API slices. Keep DTO names and meanings aligned with this schema even while the storage implementation is temporary.
- If auth is not part of Slice 1 UI, use server-mediated anonymous-token access rather than browser-direct table access.
- If future analysis jobs require async queues, add job tables in a separate migration instead of overloading `coach_takes.analysis_status` with provider-specific workflow details.
