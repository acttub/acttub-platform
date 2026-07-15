# Spring Boot Migration Notes for Acttub Slice 1

These notes describe how the temporary Next.js `/api/v1/*` implementation should migrate to the planned `apps/api` Spring Boot backend while preserving the Slice 1 Supabase contract.

## Migration Goal

Move server ownership of upload-intent finalization, session creation, observation confirmation, turn generation, storage signing, visibility, and validation logging from Next.js Route Handlers to Spring Boot without changing the public REST paths or DTO semantics used by the web UI.

## Stable REST Surface

The canonical paths are `/api/v1/practice-sessions/*`. Legacy `/api/v1/sessions/*` routes may remain only as compatibility aliases during the cutover and should not be treated as the primary Spring Boot contract.

| Method | Path | Responsibility |
| --- | --- | --- |
| `POST` | `/api/v1/practice-upload-intents` | Create an owner-bound upload authority for a future session and exact Storage path. |
| `POST` | `/api/v1/practice-upload-intents/{uploadIntentId}/finalize` | Verify owner, exact path, object existence, MIME type, and size for the uploaded object; configured Supabase mode keeps database status `created` until session creation consumes it. |
| `POST` | `/api/v1/practice-sessions` | Consume the verified upload intent, atomically mark it `finalized` in the database, create a practice session, link one take, and start one-time Gemini question seed generation. |
| `GET` | `/api/v1/practice-sessions` | List visible sessions for the authenticated owner. |
| `GET` | `/api/v1/practice-sessions/{sessionId}` | Return session state, take status, observations, turns, and final actor sentence. |
| `GET` | `/api/v1/practice-sessions/{sessionId}/signed-video-url` | Return a short-lived private playback signed URL after owner checks. |
| `PATCH` | `/api/v1/practice-sessions/{sessionId}/observations/{observationId}` | Accept/reject/mark unsure. Rejection must block future question grounding. |
| `POST` | `/api/v1/practice-sessions/{sessionId}/turns` | Store one actor answer and one coach turn, then return the persisted answer count and the 5-to-10-answer dialogue completion decision. |
| `POST` | `/api/v1/practice-sessions/{sessionId}/result` | Store the actor-authored filled-thought sentence and complete the session. |
| `PATCH` | `/api/v1/practice-sessions/{sessionId}/visibility` | Soft-hide the session for owner-visible lists. |

Do not add a new client `POST /api/v1/practice-sessions/{sessionId}/video-url` call path; that route is legacy-only compatibility if present.

## Package Boundary Proposal

Suggested Spring Boot package shape:

```text
apps/api/src/main/java/.../acttub/
  coach/
    CoachSessionController.java
    CoachObservationController.java
    CoachTurnController.java
    CoachResultController.java
    application/
      CoachSessionService.java
      UploadIntentService.java
      ObservationConfirmationService.java
      QuestionTurnService.java
      SessionResultService.java
    domain/
      CoachSession.java
      CoachTake.java
      CoachObservation.java
      CoachTurn.java
      ValidationEvent.java
    infrastructure/
      SupabaseStorageClient.java
      SupabaseSignedUrlService.java
      VideoAnalysisClient.java
      GuardrailChecker.java
    persistence/
      CoachSessionRepository.java
      UploadIntentRepository.java
      CoachObservationRepository.java
      CoachTurnRepository.java
      ValidationEventRepository.java
```

Keep controllers thin: parse/validate DTOs, call application services, return typed JSON with stable status codes.

## DTO and Validation Assumptions

Spring Boot DTOs should preserve these meanings from the Next.js MVP:

- Required acting-api session input: `requestId`, `uploadIntentId`, `situation`, `characterContext`, and `subtext`.
- The server derives `storageBucket` and `storagePath` from the finalized upload intent; clients do not submit them during session creation.
- `medium` and `genre` remain legacy/response-compatibility fields only and must not be forwarded to acting-api.
- One session has one Slice 1 take.
- Persistence owner field is `user_id`; keep executable schema assumptions on that owner key.
- `practice_sessions.status` values are `observations_pending`, `questioning`, and `completed`; DTO mapping to UI labels/states must be explicit.
- Observations expose timestamps, observable cue text, confidence, and confirmation state.
- User-facing DTOs must not expose score/rating/verdict/evaluation/diagnosis/prescriptive-correction fields.
- A rejected observation must update both `confirmationState='rejected'` and `blockedForQuestioning=true`.
- A turn-generation request must produce at most one assistant question.
- `CreateTurnResponse` keeps `actorTurn`, `coachTurn`, and `session`, and adds required `dialogueComplete`, `answerCount`, and nullable `completionReason` (`ai_sufficient` or `max_questions_reached`).
- Dialogue completion does not create a summary/result or mark the practice session completed; the actor-authored result remains a separate request.
- `finalActorSentence` is written by the actor; the service must not replace it with an AI conclusion.

## Supabase Integration Assumptions

Apply the ordered SQL files in `supabase/migrations/`; `001_acttub_slice1_schema.sql` is the baseline and `003_atomic_dialogue_turn_append.sql` replaces the original turn-pair RPC with the concurrency-safe signature.

Recommended server behavior:

1. Run migrations outside request handling via the deployment pipeline.
2. Use a server-side Supabase service credential only in backend configuration.
3. Persist and query `public.validation_events` for guardrail/audit events.
4. Keep object keys under `users/{userId}/practice-sessions/{sessionId}/take.mp4|take.mov`.
5. Generate short-lived signed playback URLs from the private `practice-videos` bucket through `GET /api/v1/practice-sessions/{sessionId}/signed-video-url`.
6. Keep lifecycle table writes owner-checked server-side through the service role/RPC boundary; do not add browser-authenticated insert/update/delete RLS policies for practice lifecycle tables or open anonymous RLS table access directly.

## Upload Hardening Boundary

The current acting-api pipeline accepts at most `576716800` bytes (550 MiB) across the client, upload intent/take checks, and private Storage bucket. Browser uploads use Supabase Storage standard `.upload()` directly; `/finalize` remains the owner/path/MIME/size/duration verification boundary. Migration 001's Slice 1 snapshot used `314572800` bytes (300 MiB). That value remains documented as the historical baseline, not the current acting-api limit.

Spring Boot must treat `ACTING_API_BASE_URL` and `ACTING_API_KEY` as server-only configuration and send the key only on server-to-server requests. `GEMINI_API_KEY` and `GEMINI_QUESTION_MODEL` belong only to preserved legacy compatibility behavior and must not drive the canonical acting-api-v1 pipeline.

Supabase documents standard uploads at https://supabase.com/docs/guides/storage/uploads/standard-uploads and recommends TUS/resumable uploads for files larger than 6 MB at https://supabase.com/docs/guides/storage/uploads/resumable-uploads. The Spring Boot production hardening path should add a TUS-capable client before relying on large-video uploads over mobile or unreliable networks; this is explicitly out of dependency scope for Slice 1.

## Service Invariants to Port

### Observation confirmation

```text
if confirmationState == rejected:
  blockedForQuestioning = true
else if confirmationState == accepted:
  blockedForQuestioning = false
else:
  blockedForQuestioning remains false unless a moderation guard blocks it
```

### Question grounding

Before storing an assistant question with `sourceObservationIds`, load every cited observation and require:

- observation belongs to the session
- `confirmationState == accepted`
- `blockedForQuestioning == false`

If no safe observation exists, ask from explicit missing context or use a boundary redirect. Do not cite rejected/unsure observations.

### Dialogue completion

Treat the database count of persisted actor turns as authoritative. The Next service reads that count for generation and passes it to the RPC as `p_expected_actor_answer_count`. In one owner-checked transaction, the RPC locks the session, recounts actor turns, and rejects an append when the latest persisted coach turn has `questionFocus='summary_reflection'`, the existing actor-answer count is already 10, or the expected count is stale. It returns the post-insert count, which the repository validates and exposes as `CreateTurnResponse.answerCount`.

Gemini must return `dialogueSufficient` as a JSON boolean; strings, numbers, missing values, and null are invalid upstream responses. The Gemini adapter requires `false` for answers 1~4, leaves answers 5~9 advisory, and requires `true` for answer 10. A forced-boundary disagreement or a `questionFocus` that disagrees with sufficiency fails as an upstream error before persistence. The service independently evaluates the policy and also rejects any disagreement between completion, sufficiency, and `summary_reflection` focus:

```text
answerCount = persistedActorAnswerCount + 1
if answerCount < 5:
  require dialogueSufficient == false
  dialogueComplete = false
  completionReason = null
else if answerCount < 10 and dialogueSufficient:
  dialogueComplete = true
  completionReason = ai_sufficient
else if answerCount >= 10:
  require dialogueSufficient == true
  dialogueComplete = true
  completionReason = max_questions_reached
else:
  dialogueComplete = false
  completionReason = null
```

When `dialogueComplete=true`, persist the required coach turn with `questionFocus='summary_reflection'`. This closes only the question loop; do not auto-create `session_results`, a final actor sentence, or a summary.

### Product language guard

The backend should reject or regenerate assistant text containing evaluator-style product language such as score, grade, verdict, strength/weakness cards, diagnosis result, or prescriptive coaching framed as an answer. Store guardrail failures in `public.validation_events`.

## Migration Sequence

1. Freeze current web DTOs under `apps/web/src/lib/api/*` as the compatibility contract.
2. Implement Spring Boot controllers with the same canonical paths and JSON field names.
3. Point the web API client base URL from same-origin Next handlers to Spring Boot in an environment-controlled way.
4. Keep Next handlers as a compatibility proxy only during the cutover, then delete them after parity verification.
5. Run parity checks for:
   - upload intent creation/finalization
   - session creation
   - owner-checked signed playback URL generation
   - observation rejection non-reuse
   - one-question turn generation and 4/5/9/10-answer completion boundaries
   - final actor sentence persistence
   - forbidden evaluator-language guard events

## Verification Checklist

- Database migration applies cleanly to a fresh Supabase/Postgres project.
- RLS lets authenticated users read only visible own lifecycle rows, and does not let browser-authenticated users insert/update/delete practice lifecycle rows directly.
- Rejected observations cannot be referenced by new assistant turns.
- Turn creation rejects a persisted last `summary_reflection` and never stores an 11th actor answer.
- Completed dialogue responses always carry a `summary_reflection` coach turn without auto-creating a result.
- Web UI can complete a full Slice 1 flow through the Spring Boot API without changing user-visible copy.
- No new public API field reintroduces scores, ratings, verdicts, strengths, weaknesses, diagnosis framing, evaluation framing, or prescriptive corrections.

## Current Next.js compatibility boundary

The temporary Next.js handlers now enforce API auth/terms checks before every practice/session/upload operation and pass the authenticated `user_id` owner into the service/repository layer. Spring Boot must preserve these route-level semantics while replacing local Supabase persistence with Supabase-backed transactions.

## Durable analysis queue contract

Spring Boot must preserve `POST /api/v1/practice-sessions` and `POST /api/v1/practice-sessions/{sessionId}/analysis`: accepted create/retry returns `202` with the unchanged `ActingCoachSessionDto`, and completed replay returns `200`. Enqueue must atomically mutate session/take/request identity with a lease-free `practice_upstream_operations` row.

The portable database contract is claim (`FOR UPDATE SKIP LOCKED`), heartbeat, retry requeue, definitive failure, and completion through operation ID plus live lease-token CAS. Attempts, `available_at`, bounded backoff, and trusted source reconstruction remain private. A future Java worker may replace the Node worker, but it must preserve these transitions and must not move work back into an HTTP request lifecycle.

Migration 022 also preserves the public finalize path and DTO while treating `durationMs` only as `reported_duration_ms`. Future Spring infrastructure must perform equivalent byte-level MP4/MOV probing (video stream, ISO-BMFF brand/container, extension/MIME agreement, conservative millisecond ceiling), persist authoritative duration plus `ai_eligible_at` in the same live-lease CAS transaction, and keep `video_too_long`, `source_video_metadata_invalid`, and retryable `media_probe_unavailable` stable. It must preserve crash-before/after-probe recovery and must never dispatch `/summarize` after lease loss or definitive validation failure.

Safe rollout order is compatible app/worker code, drain old G010 workers and leases, apply migration 022 (which fences old claims), verify pinned ffprobe and ephemeral capacity (`550 MiB × concurrency` plus headroom), then start v2 claims. If that coordination cannot be guaranteed, use a short traffic drain. Existing rows without authoritative markers must be re-probed rather than backfilled from client reports.
# Portable upload cleanup contract

Spring Boot must preserve the existing `/api/v1/*` request/success DTOs and HTTP 409 `upload_quota_exceeded` error. It may replace the Node cleanup process, but must preserve PostgreSQL's per-user advisory-lock ordering, active usage predicate (`consumed_at is null and cleanup_completed_at is null`), actual-byte accounting, `FOR UPDATE SKIP LOCKED` claims, lease-token CAS, capped retry, and reference guards.

Storage deletion is service-role/server-only, targets one canonical bucket/path, and treats an already-missing object as success. A successful provider delete does not release quota until DB completion succeeds under the live lease; a crash between those steps converges when the next lease observes the object absent. Normal session/take media is marked consumed and never enters orphan cleanup.
