package com.acttub.actingapi.feature.reading.app;

import java.nio.file.Path;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.ScoredLine;

/** 줄 녹음 하나를 채점 서비스(apps/pron)에 보낸다. 실패하면 던진다. */
public interface PronunciationScorer {

    Scored score(Path audio, String contentType, String scriptText);

    record Scored(ScoredLine line, String modelVersion) {
    }
}
