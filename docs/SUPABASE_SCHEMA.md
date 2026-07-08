# Supabase Schema and Policy Notes for Acttub Slice 1

This document records the Supabase persistence contract for the Slice 1 MVP. The executable SQL lives in `supabase/migrations/001_acttub_slice1_schema.sql` and mirrors `docs/supabase/slice1-schema-rls-storage.sql`.

## Scope

The schema supports the current product invariant: Acttub is a question-based acting practice partner, not an evaluator. The database stores session state, one uploaded take, analysis observations, question turns, actor-authored result text, and validation events.

Out of scope for executable schema and user-facing contracts:

- score, rating, grade, verdict, strength/weakness cards, diagnosis fields, or prescriptive correction fields
- before/after comparison state
- retake workflows
- long-term progress reports
- mobile-specific tables

## Tables

### `public.profiles`

One row per Supabase user. Slice 1 API access requires an active profile with current consent timestamps and `consent_version`. Local development may use cookie-backed consent only when Supabase is not configured.

### `public.upload_intents`

Pre-session upload authority. Each row binds a `user_id`, future `session_id`, exact private Storage bucket/path, MIME type, size, consent version, expiry, and finalization status.

Key fields:

- `user_id`: Supabase Auth user id and owner for the future session and object path.
- `session_id`: future practice session id; also embedded in the Storage path.
- `status`: upload lifecycle (`created`, `finalized`, `expired`, `cleanup_failed`).
- `expected_storage_bucket`: defaults to `practice-videos`.
- `expected_storage_path`: exact browser upload path, constrained to `users/{userId}/practice-sessions/{sessionId}/take.mp4|take.mov`.
- `expected_mime_type`, `expected_size_bytes`: finalization checks; size is bounded by the 300 MB bucket policy.

### `public.practice_sessions`

One practice flow. Required MVP context is stored directly on the session so a future Spring Boot API can serve `/api/v1/practice-sessions/{sessionId}` without reconstructing state from client memory.

Key fields:

- `user_id`: Supabase Auth user id and owner. Slice 1 executable schema uses this field as the owner key.
- `upload_intent_id`: owner-aligned reference to the upload intent consumed by atomic session creation; in configured Supabase mode the database marks that intent `finalized` inside `public.acttub_create_session_from_upload_intent`.
- `status`: persistence lifecycle (`observations_pending`, `questioning`, `completed`). The web DTO may map these to current UI states such as observation review, conversation, and end/result, but the database status values remain these three strings.
- `medium`, `genre`, `situation`, `character_context`, `subtext`: scene context from the input step.
- `final_actor_sentence`: actor-authored filled-thought sentence saved at completion.
- `hidden_at`: soft-hide marker for visible session lists.

### `public.practice_takes`

One uploaded acting video for a session.

Key fields:

- `storage_bucket`: defaults to `practice-videos`.
- `storage_path`: private Supabase Storage object path.
- `mime_type`, `size_bytes`: copied from the upload intent after API upload verification and database-side finalization during session creation.
- `analysis_status`: one-time mock analysis state (`mocked`, `failed`).
- `analysis_error`: operational failure detail, not user-facing judgment.

### `public.observations`

Timestamped observations produced by the one-time analysis pass.

Key fields:

- `timestamp_start_ms`, `timestamp_end_ms`: video evidence anchor.
- `observation_text`: observable cue text.
- `confidence`: analysis confidence for routing confirmation.
- `confirmation_state`: `unasked`, `accepted`, `rejected`, or `unsure`.
- `blocked_for_questioning`: must be `true` when `confirmation_state = 'rejected'`.
- `source_payload`: raw/provider metadata for server-side audit.

Important invariant: rejected observations cannot be reused as question grounds. This is enforced by the `rejected_observations_are_blocked` check and by service/repository filtering before question generation.

### `public.question_turns`

Conversation log. Each assistant question is one turn and should contain one question only; generation code must enforce the one-question rule before insert.

Key fields:

- `speaker`: `actor` or `acttub`.
- `content`: turn text.
- `question_focus`: focus axis for assistant questions.
- `source_observation_ids`: accepted, non-blocked observations used as grounds.
- `turn_state`: `open`, `answered`, or `summary`.

### `public.session_results`

Final result row for the completed session.

Key fields:

- `actor_authored_sentence`: required final sentence written by the actor.
- `question_to_revisit`: optional actor-centered prompt for reflection.

### `public.validation_events`

Low-level validation/audit events for alpha learning, including rejected-observation reuse checks and forbidden-language checks.

## Storage and upload contract

The migration creates a private bucket:

- bucket id/name: `practice-videos`
- public: `false`
- max size: `314572800` bytes
- allowed MIME types: `video/mp4`, `video/quicktime`

Authenticated actor upload paths must be exactly:

```text
users/{userId}/practice-sessions/{sessionId}/take.mp4|take.mov
```

The server persists that path as `practice_takes.storage_path`. Playback signed URLs are short-lived and generated server-side from the owner-checked canonical endpoint `GET /api/v1/practice-sessions/{sessionId}/signed-video-url`.

Slice 1 keeps the browser upload path dependency-free: the current MVP uses Supabase Storage standard `.upload()` direct storage, then the `/finalize` API verification step checks owner, path, MIME type, size, and object existence under the existing 300 MB bucket limit. Supabase documents standard uploads at https://supabase.com/docs/guides/storage/uploads/standard-uploads and recommends TUS/resumable uploads for files above 6 MB at https://supabase.com/docs/guides/storage/uploads/resumable-uploads. Production hardening should add a TUS-capable client for large/mobile/unreliable-network uploads, but Slice 1 intentionally does not add a new TUS dependency.

## RLS Policy Model

Authenticated actors can select visible own lifecycle rows only when `public.is_active_acttub_profile(auth.uid())` is true. Browser-authenticated users do not get direct `INSERT`, `UPDATE`, or `DELETE` policies on `upload_intents`, `practice_sessions`, `practice_takes`, `observations`, `question_turns`, `session_results`, or `validation_events`; those lifecycle writes must flow through Next route handlers that use the Supabase service role or the restricted database RPCs. Nested rows denormalize `user_id` and are authorized for reads through composite owner-alignment foreign keys plus visible-session checks.

Profile self select/insert/update remains available only for the authenticated user's own profile so the auth and terms lifecycle can complete without broadening practice-data write access. Slice 1 does not open anonymous table or Storage access through RLS. Browser Storage authority is limited to direct `INSERT` into the private `practice-videos` object path backed by an active upload intent; playback, mutation, cleanup, analysis jobs, finalization checks, signed URLs, and migration backfills should use the Supabase service role or database owner role. Do not expose service-role keys to the browser.

## API Contract Mapping

The canonical REST surface uses `/api/v1/practice-sessions/*`. `/api/v1/sessions/*` remains only as a compatibility alias for legacy callers during migration.

- `POST /api/v1/practice-upload-intents` creates the owner-bound upload intent.
- `POST /api/v1/practice-upload-intents/{id}/finalize` verifies owner/path/expiry/object metadata for the uploaded object and returns the verified upload reference; in configured Supabase mode it does not create the session or mark the database row finalized.
- `POST /api/v1/practice-sessions` consumes the verified upload intent, atomically marks `upload_intents.status = 'finalized'` inside `public.acttub_create_session_from_upload_intent`, creates `practice_sessions`, links one `practice_takes` row, starts mock analysis, and returns session state.
- `GET /api/v1/practice-sessions` lists visible sessions.
- `GET /api/v1/practice-sessions/{sessionId}` reads session/take/observation/turn/result state.
- `GET /api/v1/practice-sessions/{sessionId}/signed-video-url` returns a short-lived private playback URL. Do not add a client `POST /video-url` call path.
- `PATCH /api/v1/practice-sessions/{sessionId}/observations/{observationId}` updates `confirmation_state`; `rejected` must set `blocked_for_questioning=true`.
- `POST /api/v1/practice-sessions/{sessionId}/turns` records the actor answer and the next assistant question/hint/redirect.
- `POST /api/v1/practice-sessions/{sessionId}/result` stores `actor_authored_sentence`/`final_actor_sentence` and moves the session to `completed`.
- `PATCH /api/v1/practice-sessions/{sessionId}/visibility` soft-hides the session.

## Product Safety Checks Backed by Schema

- No evaluator-style result columns exist.
- Rejected observations are blocked at observation state level.
- Assistant turns cannot cite rejected or unsure observations through `source_observation_ids`.
- Final session output centers an actor-authored sentence, not an AI-authored conclusion table.

## Open Implementation Notes

- The current repository may still use mock persistence for local development. Keep DTO names and meanings aligned with this schema even while persistence can be mocked.
- If future analysis jobs require async queues, add job tables in a separate migration instead of overloading `practice_takes.analysis_status` with provider-specific workflow details.
