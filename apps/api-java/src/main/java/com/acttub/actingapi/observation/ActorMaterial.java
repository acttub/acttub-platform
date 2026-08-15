package com.acttub.actingapi.observation;

import java.util.Objects;
import java.util.Set;

public record ActorMaterial(
        String situation,
        String character,
        String goal,
        String blockageKind,
        String blockageDetail,
        long durationMs) {

    private static final Set<String> BLOCKAGE_KINDS = Set.of("분석", "표현", "그 외");

    public ActorMaterial {
        Objects.requireNonNull(situation, "situation");
        Objects.requireNonNull(character, "character");
        Objects.requireNonNull(goal, "goal");
        Objects.requireNonNull(blockageKind, "blockageKind");
        Objects.requireNonNull(blockageDetail, "blockageDetail");
        if (!BLOCKAGE_KINDS.contains(blockageKind)) {
            throw new IllegalArgumentException("invalid blockage kind: " + blockageKind);
        }
        if (durationMs < 0) {
            throw new IllegalArgumentException("durationMs must be non-negative");
        }
    }
}
