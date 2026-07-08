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
| `POST` | `/api/v1/practice-sessions` | Consume the verified upload intent, atomically mark it `finalized` in the database, create a practice session, link one take, and start one-time mock analysis. |
| `GET` | `/api/v1/practice-sessions` | List visible sessions for the authenticated owner. |
| `GET` | `/api/v1/practice-sessions/{sessionId}` | Return session state, take status, observations, turns, and final actor sentence. |
| `GET` | `/api/v1/practice-sessions/{sessionId}/signed-video-url` | Return a short-lived private playback signed URL after owner checks. |
| `PATCH` | `/api/v1/practice-sessions/{sessionId}/observations/{observationId}` | Accept/reject/mark unsure. Rejection must block future question grounding. |
| `POST` | `/api/v1/practice-sessions/{sessionId}/turns` | Store actor answer and produce one next assistant question/hint/redirect. |
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

- Required session input: `medium`, `genre`, `situation`, `characterContext`, `uploadIntentId`, `storageBucket`, and `storagePath` for upload sessions.
- Optional context: `subtext`.
- One session has one Slice 1 take.
- Persistence owner field is `user_id`; keep executable schema assumptions on that owner key.
- `practice_sessions.status` values are `observations_pending`, `questioning`, and `completed`; DTO mapping to UI labels/states must be explicit.
- Observations expose timestamps, observable cue text, confidence, and confirmation state.
- User-facing DTOs must not expose score/rating/verdict/evaluation/diagnosis/prescriptive-correction fields.
- A rejected observation must update both `confirmationState='rejected'` and `blockedForQuestioning=true`.
- A turn-generation request must produce at most one assistant question.
- `finalActorSentence` is written by the actor; the service must not replace it with an AI conclusion.

## Supabase Integration Assumptions

Use `supabase/migrations/001_acttub_slice1_schema.sql` as the database baseline.

Recommended server behavior:

1. Run migrations outside request handling via the deployment pipeline.
2. Use a server-side Supabase service credential only in backend configuration.
3. Persist and query `public.validation_events` for guardrail/audit events.
4. Keep object keys under `users/{userId}/practice-sessions/{sessionId}/take.mp4|take.mov`.
5. Generate short-lived signed playback URLs from the private `practice-videos` bucket through `GET /api/v1/practice-sessions/{sessionId}/signed-video-url`.
6. Keep lifecycle table writes owner-checked server-side through the service role/RPC boundary; do not add browser-authenticated insert/update/delete RLS policies for practice lifecycle tables or open anonymous RLS table access directly.

## Upload Hardening Boundary

Slice 1 browser uploads currently use Supabase Storage standard `.upload()` direct storage without adding a TUS dependency. The `/finalize` API verification step remains the upload safety boundary: the object must match the active upload intent, owner, bucket, path, MIME type, size, and expiry, and the bucket/server checks retain the 300 MB maximum.

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
   - one-question turn generation
   - final actor sentence persistence
   - forbidden evaluator-language guard events

## Verification Checklist

- Database migration applies cleanly to a fresh Supabase/Postgres project.
- RLS lets authenticated users read only visible own lifecycle rows, and does not let browser-authenticated users insert/update/delete practice lifecycle rows directly.
- Rejected observations cannot be referenced by new assistant turns.
- Web UI can complete a full Slice 1 flow through the Spring Boot API without changing user-visible copy.
- No new public API field reintroduces scores, ratings, verdicts, strengths, weaknesses, diagnosis framing, evaluation framing, or prescriptive corrections.

## Current Next.js compatibility boundary

The temporary Next.js handlers now enforce API auth/terms checks before every practice/session/upload operation and pass the authenticated `user_id` owner into the service/repository layer. Spring Boot must preserve these route-level semantics while replacing local mock persistence with Supabase-backed transactions.
