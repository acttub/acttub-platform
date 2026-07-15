# Acttub Slice 1 Supabase → Spring Boot migration notes

This note preserves the backend contract that the temporary Next.js route handlers must keep stable for a future `apps/api` Spring Boot service.

## Auth and consent assumptions

- Supabase Auth is the identity provider for Slice 1. Spring Boot should verify the Supabase JWT and map `sub` to `profiles.id`.
- Active access requires `profiles.status = 'active'` and current consent fields:
  - `required_consent_version = current_acttub_terms_version()`
  - `required_consent_at`
  - `ai_processing_consent_version = current_acttub_ai_processing_consent_version()`
  - `ai_processing_consent_at`
- `internal_review_consent` is optional, defaults to `false`, and never gates service access.
- Unauthenticated requests return `401`.
- Authenticated users without current consent return `403` with a `pending_terms`-style error code.

## Stable endpoint contracts

| Method/path | Purpose | Auth rule | Migration note |
| --- | --- | --- | --- |
| `GET /api/v1/auth/session` | Current user + terms state | optional auth | Must stay non-cacheable. |
| `POST /api/v1/terms/acceptances` | Record current required + AI-processing consent | authenticated | Requires both mandatory booleans, stores server-authoritative versions atomically, and preserves internal review as an explicit optional choice. |
| `POST /api/v1/practice-upload-intents` | Create pre-session upload authority | active user | Returns future `sessionId`, exact Storage path, constraints, expiry. |
| `POST /api/v1/practice-sessions` | Finalize an uploaded video into DB state | active user | Creates session/take/Gemini-generated context observations only after object existence validation. |
| `GET /api/v1/practice-sessions` | List visible sessions | active user | Excludes `hidden_at is not null`. |
| `GET /api/v1/practice-sessions/{sessionId}` | Fetch session state | owner only | Return `403` or `404` for non-owner without leaking existence. |
| `GET /api/v1/practice-sessions/{sessionId}/signed-video-url` | Issue playback signed URL | owner + visible session | 600 second expiry, never public URL. `POST /video-url` is legacy-only compatibility and must not be used by clients. |
| `PATCH /api/v1/practice-sessions/{sessionId}/observations/{observationId}` | Confirm/reject/unsure observation | owner only | `rejected` must set `blocked_for_questioning=true`. |
| `POST /api/v1/practice-sessions/{sessionId}/turns` | Submit answer / get one next question | owner only | Source observations exclude rejected/blocked observations. Response adds `dialogueComplete`, persisted `answerCount`, and nullable `completionReason`; completion is allowed only from answer 5 and forced at answer 10. |
| `POST /api/v1/practice-sessions/{sessionId}/result` | Save actor-authored final sentence + validation metrics | owner only | Final sentence is required and user-authored. |
| `PATCH /api/v1/practice-sessions/{sessionId}/visibility` | Soft-hide session | owner only | Sets `hidden_at`; UI must not frame this as permanent deletion. |

All auth-bound JSON and signed-video responses must send:

```http
Cache-Control: no-store, private
Vary: Cookie, Authorization
```

## Storage contract

- Bucket: `practice-videos`.
- Bucket visibility: private.
- Browser object path shape: `users/{userId}/practice-sessions/{sessionId}/take.mp4|take.mov`.
- Max object size: `314572800` bytes.
- Accepted MIME types: `video/mp4`, `video/quicktime`.
- Browser JWT permissions for Slice 1:
  - `INSERT`: allowed only through matching active `upload_intents` row.
  - `SELECT`: no policy for browser video playback/listing.
  - `UPDATE`/upsert/move: no browser policy.
  - `DELETE`: no browser policy.
- Server/service-role responsibilities:
  - validate upload intent, owner, object path, MIME, and size before finalization;
  - issue short-lived signed playback URLs after ownership checks;
  - remove orphan objects after finalization failure or expired intents.


## Upload implementation boundary

- Slice 1 uses Supabase Storage standard `.upload()` direct storage from the browser without adding a TUS dependency.
- Server finalization remains bounded by the active upload intent plus bucket/object checks: owner, exact path, MIME type, size, expiry, and the 300 MB bucket limit.
- Supabase standard upload docs: https://supabase.com/docs/guides/storage/uploads/standard-uploads
- Supabase recommends TUS/resumable uploads for files larger than 6 MB: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Production Spring Boot hardening should add a TUS-capable client for large/mobile/unreliable-network uploads; Slice 1 intentionally stays dependency-free.

## Data integrity invariants

- `practice_sessions` rows start after upload success only; pre-upload state is `upload_intents` only.
- `upload_intents.session_id` is the future session ID and must match the Storage path.
- Child rows denormalize `user_id` and enforce composite owner-alignment FKs with `(session_id, user_id)`.
- `observations.confirmation_state = 'rejected'` requires `blocked_for_questioning = true`.
- Questions, final text, and validation output must not use rejected/blocked observations as source material.
- The persisted actor-turn count is the completion-policy source of truth: answers 1~4 require Gemini `dialogueSufficient=false` and continue, answers 5~9 honor a strictly boolean Gemini sufficiency decision, and answer 10 requires `true` and completes with `max_questions_reached`. A forced-boundary disagreement is an upstream failure and is not persisted.
- A persisted latest coach `summary_reflection` or 10 existing actor answers blocks another turn pair. A completed dialogue writes the required coach turn as `summary_reflection` but does not create `session_results` or a final actor sentence.

## Spring Boot implementation hints

- Put auth/consent checks in a request filter plus service-level owner checks; do not rely on frontend route guards.
- Keep DTO names and fields aligned with `apps/web/src/lib/api/*` so the frontend can switch base URLs without changing call sites.
- Use the Supabase service role only in backend infrastructure components. Never return it or derive client credentials from it.
- Preserve the lifecycle write boundary: browser-authenticated clients may directly insert only the Storage object authorized by an active upload intent; lifecycle table inserts, updates, and deletes stay behind route handlers, the service role, or restricted RPCs.
- Wrap finalization in a DB transaction. If the transaction fails after object upload, call the Storage API remove operation and log `orphan_cleanup_attempted` with the result.
- Apply `003_atomic_dialogue_turn_append.sql`. Pass the count observed for generation as `p_expected_actor_answer_count`; lock and recount persisted actor turns in the RPC, reject a stale expected count, and return the post-insert count so concurrent requests cannot bypass the 10-answer limit or append after `summary_reflection`.
- Preserve the current product language rules in backend generated content: the final result centers the actor-authored sentence and avoids score/verdict/evaluation/diagnosis/prescriptive-correction framing.
# Follow-up: migration 023 orphan cleanup

The Slice 1 browser upload policy remains INSERT-only. Durable orphan reclamation is implemented by the separate service-role `worker:upload-cleanup` lease/CAS saga from migration 023; Spring Boot must reuse that state machine rather than adding browser-owned deletion.
