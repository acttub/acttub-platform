package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;
import java.util.UUID;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 최초 분석 안에서만 원본 영상을 읽는다. 코치는 저장된 반환값만 사용한다. */
@FunctionalInterface
public interface VideoRecordAnalyzer {
    ObjectNode analyze(Path video, ActorMaterial actor, UUID practiceSessionId, SpeechAnalysis speech);
}
