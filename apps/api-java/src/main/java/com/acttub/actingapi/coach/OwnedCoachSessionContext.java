package com.acttub.actingapi.coach;

import java.util.UUID;

public record OwnedCoachSessionContext(
        UUID practiceSessionId,
        CoachSessionSnapshot session) {
}
