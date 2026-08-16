package com.acttub.actingapi.coach.app;

import com.fasterxml.jackson.databind.node.ObjectNode;

public record CoachReply(String message, String status, ObjectNode handoff) {
}
