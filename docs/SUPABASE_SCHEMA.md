# Supabase Schema and Policy Notes for Acttub Slice 1

> **방향 전환 (2026-07-13)**: migration 001의 Slice 1 기준은 관찰 확인, 자기 정리 문장, `314572800` bytes(300 MiB) 업로드 제한이었다. migration 004~010은 이전 `ai-pipeline.v1` 계보이며, 현재 acting-api 파이프라인은 additive migration 011을 통해 `576716800` bytes(550 MiB)로 확장되었다. 아래 Slice 1 설명은 역사적 기준이며 현재 계약은 `docs/API.md`, ADR-014~015, `docs/ARCHITECTURE.md`를 따른다.

This document records the Supabase persistence contract for the Slice 1 MVP. Apply the executable SQL files in `supabase/migrations/` in order. Migration `001_acttub_slice1_schema.sql` mirrors the baseline snapshot in `docs/supabase/slice1-schema-rls-storage.sql`; later migrations evolve that baseline.

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

One row per Supabase user. Current API access requires an active profile with the server-authoritative required-consent and AI-processing-consent versions plus their acceptance timestamps. `internal_review_consent` is optional, defaults to `false`, and does not gate service access.

### `public.upload_intents`

Pre-session upload authority. Each row binds a `user_id`, future `session_id`, exact private Storage bucket/path, MIME type, size, consent version, expiry, and finalization status.

Key fields:

- `user_id`: Supabase Auth user id and owner for the future session and object path.
- `session_id`: future practice session id; also embedded in the Storage path.
- `status`: upload lifecycle (`created`, `validating`, `validation_failed`, `finalized`, `expired`, `cleanup_failed`). `validating`은 브라우저 업로드 확인 후 worker byte probe 이전의 내부 상태입니다.
- `expected_storage_bucket`: defaults to `practice-videos`.
- `expected_storage_path`: exact browser upload path, constrained to `users/{userId}/practice-sessions/{sessionId}/take.mp4|take.mov`.
- `expected_mime_type`, `expected_size_bytes`: finalization checks. Migration 001's historical bound is 300 MiB; the current acting-api migration 011 bound is 550 MiB.
- `reported_duration_ms`: unchanged finalize DTO의 `durationMs`를 보관하는 UX/compatibility hint이며 권한 근거가 아닙니다.
- `authoritative_duration_ms`, `media_metadata_version`, `ai_eligible_at`: migration 022의 lease-fenced probe RPC가 실제 Storage bytes를 검증한 한 transaction에서만 설정합니다. Acting flow는 180000 ms까지만 허용하고 기존 `ai-pipeline.v1`의 300000 ms 계약은 유지합니다.

### `public.practice_sessions`

One practice flow. Required MVP context is stored directly on the session so a future Spring Boot API can serve `/api/v1/practice-sessions/{sessionId}` without reconstructing state from client memory.

Key fields:

- `user_id`: Supabase Auth user id and owner. Slice 1 executable schema uses this field as the owner key.
- `upload_intent_id`: owner-aligned reference to the upload intent consumed by atomic session creation; in configured Supabase mode the database marks that intent `finalized` inside `public.acttub_create_session_from_upload_intent`.
- `status`: persistence lifecycle (`observations_pending`, `questioning`, `completed`). The web DTO may map these to current UI states such as observation review, conversation, and end/result, but the database status values remain these three strings.
- `situation`, `character_context`, `subtext`: active acting-api scene context from the input step.
- `medium`, `genre`: legacy columns retained for shared-table and response compatibility. New acting-api sessions store internal `기타` compatibility values, which are not sent upstream or shown as user-entered metadata.
- `final_actor_sentence`: actor-authored filled-thought sentence saved at completion.
- `hidden_at`: soft-hide marker for visible session lists.

### `public.practice_takes`

One uploaded acting video for a session.

Key fields:

- `storage_bucket`: defaults to `practice-videos`.
- `storage_path`: private Supabase Storage object path.
- `mime_type`, `size_bytes`: copied from the upload intent after API upload verification and database-side finalization during session creation.
- `reported_duration_ms`: `ANALYZING` DTO 숫자 호환을 위한 브라우저 보고값입니다. `duration_ms`는 probe 성공 전까지 NULL이며 성공 후 authoritative duration만 저장합니다.
- `analysis_status`: one-time Gemini question seed generation state (`generated`, `failed`).
- `analysis_error`: operational failure detail, not user-facing judgment.

Migration 022의 v2 worker order는 `claim -> heartbeat -> Storage stream -> ffprobe -> authoritative probe CAS -> summarize -> completion CAS`입니다. `video_too_long`과 `source_video_metadata_invalid`는 `validation_failed`, null eligibility, non-retryable take failure로 원자적으로 종료됩니다. 구 G010 claim RPC는 이미 authoritative eligibility가 있는 row만 볼 수 있어 rollout 중 새 unvalidated work를 소비하지 못합니다.

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

Migration 001 creates the historical private-bucket baseline:

- bucket id/name: `practice-videos`
- public: `false`
- max size: `314572800` bytes
- allowed MIME types: `video/mp4`, `video/quicktime`

Authenticated actor upload paths must be exactly:

```text
users/{userId}/practice-sessions/{sessionId}/take.mp4|take.mov
```

The server persists that path as `practice_takes.storage_path`. Playback signed URLs are short-lived and generated server-side from the owner-checked canonical endpoint `GET /api/v1/practice-sessions/{sessionId}/signed-video-url`.

Slice 1 kept the browser upload path dependency-free under its historical 300 MiB limit. The current acting-api path still uploads directly with Supabase Storage standard `.upload()`, but migration 011 aligns the upload intent, take, and bucket gates at `576716800` bytes (550 MiB), with required duration `1..180000` ms at finalization. Supabase documents standard uploads at https://supabase.com/docs/guides/storage/uploads/standard-uploads and recommends TUS/resumable uploads for files above 6 MB at https://supabase.com/docs/guides/storage/uploads/resumable-uploads. Production hardening should add a TUS-capable client for large/mobile/unreliable-network uploads.

`ACTING_API_BASE_URL` and `ACTING_API_KEY` are server-only configuration for the canonical pipeline. Gemini environment variables are retained only for legacy compatibility and must not be exposed to browser code.

## RLS Policy Model

Authenticated actors can select visible own lifecycle rows only when `public.is_active_acttub_profile(auth.uid())` is true. Browser-authenticated users do not get direct `INSERT`, `UPDATE`, or `DELETE` policies on `upload_intents`, `practice_sessions`, `practice_takes`, `observations`, `question_turns`, `session_results`, or `validation_events`; those lifecycle writes must flow through Next route handlers that use the Supabase service role or the restricted database RPCs. Nested rows denormalize `user_id` and are authorized for reads through composite owner-alignment foreign keys plus visible-session checks.

Profile self select/insert/update remains available only for the authenticated user's own profile so the auth and terms lifecycle can complete without broadening practice-data write access. Slice 1 does not open anonymous table or Storage access through RLS. Browser Storage authority is limited to direct `INSERT` into the private `practice-videos` object path backed by an active upload intent; playback, mutation, cleanup, analysis jobs, finalization checks, signed URLs, and migration backfills should use the Supabase service role or database owner role. Do not expose service-role keys to the browser.

## API Contract Mapping

The canonical REST surface uses `/api/v1/practice-sessions/*`. `/api/v1/sessions/*` remains only as a compatibility alias for legacy callers during migration.

- `POST /api/v1/practice-upload-intents` creates the owner-bound upload intent.
- `POST /api/v1/practice-upload-intents/{id}/finalize` verifies owner/path/expiry/object metadata for the uploaded object and returns the verified upload reference; in configured Supabase mode it does not create the session or mark the database row finalized.
- `POST /api/v1/practice-sessions` consumes the verified upload intent, atomically marks `upload_intents.status = 'finalized'` inside `public.acttub_create_session_from_upload_intent`, creates `practice_sessions`, links one `practice_takes` row, starts Gemini question seed generation, and returns session state.
- `GET /api/v1/practice-sessions` lists visible sessions.
- `GET /api/v1/practice-sessions/{sessionId}` reads session/take/observation/turn/result state.
- `GET /api/v1/practice-sessions/{sessionId}/signed-video-url` returns a short-lived private playback URL. Do not add a client `POST /video-url` call path.
- `PATCH /api/v1/practice-sessions/{sessionId}/observations/{observationId}` updates `confirmation_state`; `rejected` must set `blocked_for_questioning=true`.
- `POST /api/v1/practice-sessions/{sessionId}/turns` records the actor answer and next assistant question atomically through `acttub_append_turn_pair`. The RPC locks the session, rejects a stale expected actor-answer count, a prior `summary_reflection`, or an 11th answer, and returns the persisted post-insert answer count.
- `POST /api/v1/practice-sessions/{sessionId}/result` stores `actor_authored_sentence`/`final_actor_sentence` and moves the session to `completed`.
- `PATCH /api/v1/practice-sessions/{sessionId}/visibility` soft-hides the session.

## Product Safety Checks Backed by Schema

- No evaluator-style result columns exist.
- Rejected observations are blocked at observation state level.
- Assistant turns cannot cite rejected or unsure observations through `source_observation_ids`.
- Final session output centers an actor-authored sentence, not an AI-authored conclusion table.

## Open Implementation Notes

- The current repository uses Supabase persistence as the source of truth. DTO names and meanings must stay aligned with this schema for the future Spring Boot migration.
- If future analysis jobs require async queues, add job tables in a separate migration instead of overloading `practice_takes.analysis_status` with provider-specific workflow details.
# Migration 023: private upload cleanup and quota state

`upload_intents.actual_size_bytes`, `consumed_at`, and `cleanup_completed_at` are private lifecycle fields; they do not change the `/api/v1/*` DTO or its `created | finalized | expired` status union. `validating` maps to public `created`, while `validation_failed`, `cleanup_failed`, and completed cleanup tombstones map to public `expired`.

The dedicated cleanup runner also invokes a bounded, service-role-only tombstone purge on every iteration, including an idle `--once` run. The purge deletes only completed rows older than `completed_tombstone_retention` after rechecking that no session or take still references the upload.

The owner-seeded singleton `upload_quota_policy` defaults to 5 active intents and 1,153,433,600 active bytes. Admission and every quota-affecting transition acquire the per-user advisory lock before the intent row. Declared bytes reserve capacity until trusted Storage observation persists `actual_size_bytes`; physical cleanup alone writes `cleanup_completed_at` and releases abandoned-object quota.

`upload_cleanup_jobs` is RLS-enabled and browser-inaccessible. Only narrow service-role claim/complete/fail RPCs are executable. The authenticated browser retains INSERT-only Storage authority—there is no browser DELETE policy. The independent worker performs exact single-object deletion and treats a missing object as idempotent success.
