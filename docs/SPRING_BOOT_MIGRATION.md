# Spring Boot Migration Notes for Acttub Slice 1

These notes describe how the temporary Next.js `/api/v1/*` implementation should migrate to the planned `apps/api` Spring Boot backend while preserving the Slice 1 Supabase contract.

## Migration Goal

Move server ownership of session creation, observation confirmation, turn generation, storage signing, and validation logging from Next.js Route Handlers to Spring Boot without changing the public REST paths or DTO semantics used by the web UI.

## Stable REST Surface

Preserve these paths unless a later ADR explicitly replaces them:

| Method | Path | Responsibility |
| --- | --- | --- |
| `POST` | `/api/v1/sessions` | Create a practice session, link/upload one take, start one-time analysis. |
| `GET` | `/api/v1/sessions/{sessionId}` | Return session state, take status, observations, turns, and final actor sentence. |
| `GET` | `/api/v1/sessions/{sessionId}/observations` | Return observations requiring confirmation or accepted observations used for dialogue. |
| `PATCH` | `/api/v1/sessions/{sessionId}/observations/{observationId}` | Accept/reject/mark unsure. Rejection must block future question grounding. |
| `POST` | `/api/v1/sessions/{sessionId}/turns` | Store actor answer and produce one next assistant question/hint/redirect. |
| `PUT` | `/api/v1/sessions/{sessionId}/summary` | Store the actor-authored filled-thought sentence and complete the session. |

## Package Boundary Proposal

Suggested Spring Boot package shape:

```text
apps/api/src/main/java/.../acttub/
  coach/
    CoachSessionController.java
    CoachObservationController.java
    CoachTurnController.java
    CoachSummaryController.java
    application/
      CoachSessionService.java
      ObservationConfirmationService.java
      QuestionTurnService.java
      SessionSummaryService.java
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
      CoachObservationRepository.java
      CoachTurnRepository.java
      ValidationEventRepository.java
```

Keep controllers thin: parse/validate DTOs, call application services, return typed JSON with stable status codes.

## DTO and Validation Assumptions

Spring Boot DTOs should preserve these meanings from the Next.js MVP:

- Required session input: `medium`, `genre`, `situation`, `characterContext`.
- Optional context: `subtext`.
- One session has one Slice 1 take.
- Observations expose timestamps, observable cue text, confidence, and confirmation state.
- User-facing DTOs must not expose score/rating/verdict fields.
- A rejected observation must update both `confirmationState='rejected'` and `blockedForQuestioning=true`.
- A turn-generation request must produce at most one assistant question.
- `finalActorSentence` is written by the actor; the service must not replace it with an AI conclusion.

## Supabase Integration Assumptions

Use `supabase/migrations/001_acttub_slice1_schema.sql` as the database baseline.

Recommended server behavior:

1. Run migrations outside request handling via the deployment pipeline.
2. Use a server-side Supabase service credential only in backend configuration.
3. Generate short-lived signed upload/read URLs for `practice-videos` storage objects.
4. Keep object keys under `{actorId}/{sessionId}/{takeId}.{extension}` for authenticated users.
5. For anonymous alpha sessions, mediate all table and storage access server-side; do not open anonymous RLS table access directly.

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

The backend should reject or regenerate assistant text containing evaluator-style product language such as score, grade, verdict, strength/weakness cards, diagnosis result, or prescriptive coaching framed as an answer. Store guardrail failures in `validation_events`.

## Migration Sequence

1. Freeze current web DTOs under `apps/web/src/lib/api/*` as the compatibility contract.
2. Implement Spring Boot controllers with the same paths and JSON field names.
3. Point web API client base URL from same-origin Next handlers to Spring Boot in an environment-controlled way.
4. Keep Next handlers as a compatibility proxy only during the cutover, then delete them after parity verification.
5. Run parity checks for:
   - session creation
   - observation rejection non-reuse
   - one-question turn generation
   - final actor sentence persistence
   - forbidden evaluator-language guard events

## Verification Checklist

- Database migration applies cleanly to a fresh Supabase/Postgres project.
- RLS prevents authenticated users from reading another actor's sessions and storage objects.
- Rejected observations cannot be referenced by new assistant turns.
- Web UI can complete a full Slice 1 flow through the Spring Boot API without changing user-visible copy.
- No new public API field reintroduces scores, ratings, verdicts, strengths, weaknesses, or diagnosis framing.

## Current Next.js compatibility boundary

The temporary Next.js handlers now enforce API auth/terms checks before every practice/session/upload operation and pass the authenticated owner id into the service/repository layer. Spring Boot must preserve these route-level semantics while replacing local mock persistence with Supabase-backed transactions.
