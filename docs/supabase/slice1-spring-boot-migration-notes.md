# Acttub Slice 1 Supabase → Spring Boot migration notes

This note preserves the backend contract that the temporary Next.js route handlers must keep stable for a future `apps/api` Spring Boot service.

## Auth and consent assumptions

- Supabase Auth is the identity provider for Slice 1. Spring Boot should verify the Supabase JWT and map `sub` to `profiles.id`.
- Active access requires `profiles.status = 'active'` and current consent fields:
  - `terms_accepted_at`
  - `privacy_accepted_at`
  - `internal_review_consent_at`
  - `consent_version = '2026-07-mvp'`
- Unauthenticated requests return `401`.
- Authenticated users without current consent return `403` with a `pending_terms`-style error code.

## Stable endpoint contracts

| Method/path | Purpose | Auth rule | Migration note |
| --- | --- | --- | --- |
| `GET /api/v1/auth/session` | Current user + terms state | optional auth | Must stay non-cacheable. |
| `POST /api/v1/terms/acceptances` | Record current consent version | authenticated | Writes all three consent timestamps atomically. |
| `POST /api/v1/practice-upload-intents` | Create pre-session upload authority | active user | Returns future `sessionId`, exact Storage path, constraints, expiry. |
| `POST /api/v1/practice-sessions` | Finalize an uploaded video into DB state | active user | Creates session/take/Gemini-generated context observations only after object existence validation. |
| `GET /api/v1/practice-sessions` | List visible sessions | active user | Excludes `hidden_at is not null`. |
| `GET /api/v1/practice-sessions/{sessionId}` | Fetch session state | owner only | Return `403` or `404` for non-owner without leaking existence. |
| `GET /api/v1/practice-sessions/{sessionId}/signed-video-url` | Issue playback signed URL | owner + visible session | 600 second expiry, never public URL. `POST /video-url` is legacy-only compatibility and must not be used by clients. |
| `PATCH /api/v1/practice-sessions/{sessionId}/observations/{observationId}` | Confirm/reject/unsure observation | owner only | `rejected` must set `blocked_for_questioning=true`. |
| `POST /api/v1/practice-sessions/{sessionId}/turns` | Submit answer / get one next question | owner only | Source observations must exclude rejected/blocked observations. |
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

## Spring Boot implementation hints

- Put auth/consent checks in a request filter plus service-level owner checks; do not rely on frontend route guards.
- Keep DTO names and fields aligned with `apps/web/src/lib/api/*` so the frontend can switch base URLs without changing call sites.
- Use the Supabase service role only in backend infrastructure components. Never return it or derive client credentials from it.
- Preserve the lifecycle write boundary: browser-authenticated clients may directly insert only the Storage object authorized by an active upload intent; lifecycle table inserts, updates, and deletes stay behind route handlers, the service role, or restricted RPCs.
- Wrap finalization in a DB transaction. If the transaction fails after object upload, call the Storage API remove operation and log `orphan_cleanup_attempted` with the result.
- Preserve the current product language rules in backend generated content: the final result centers the actor-authored sentence and avoids score/verdict/evaluation/diagnosis/prescriptive-correction framing.
