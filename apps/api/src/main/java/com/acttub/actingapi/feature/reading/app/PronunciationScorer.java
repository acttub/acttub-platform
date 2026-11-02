package com.acttub.actingapi.feature.reading.app;

import java.nio.file.Path;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.ScoredLine;

/** 줄 녹음 하나를 채점 서비스(apps/pron)에 보낸다. 실패하면 던진다. */
public interface PronunciationScorer {

    Scored score(Path audio, String contentType, String scriptText);

    record Scored(ScoredLine line, String modelVersion) {
    }

    /** 채점 서비스가 녹음이 너무 길다고 거절했다(422 audio_too_long). 다시 보내도 같으니 실패가 아니라 빠진 줄이다. */
    final class TooLong extends RuntimeException {
        public TooLong() {
            super("pronunciation scorer rejected audio_too_long");
        }
    }
}
