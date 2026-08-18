package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

public record OwnedCoachSessionContext(
        UUID practiceSessionId,
        CoachSessionSnapshot session) {
}
