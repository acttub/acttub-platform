package com.acttub.actingapi.feature.coach.app;

import com.fasterxml.jackson.databind.node.ObjectNode;

public record CoachReply(String message, String status, ObjectNode handoff) {
}
