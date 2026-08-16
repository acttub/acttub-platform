package com.acttub.actingapi.coach.app;

import java.util.UUID;

public record OwnedCoachSessionContext(
        UUID practiceSessionId,
        CoachSessionSnapshot session) {
}
