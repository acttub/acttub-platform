package com.acttub.actingapi.feature.coach.app;

/** No validated coaching turn was produced; the caller must preserve the saved dialogue. */
final class CoachReplyUnavailable extends RuntimeException {
    CoachReplyUnavailable() {
        super("coach_response_unavailable");
    }
}
