package com.acttub.actingapi.feature.coach.app;

import tools.jackson.databind.node.ObjectNode;

public record CoachReply(String message, String status, ObjectNode handoff) {
}
