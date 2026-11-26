package com.acttub.actingapi.feature.reading.app;

import java.nio.file.Path;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.ScoredLine;

/** 줄 녹음 하나를 채점 서비스(apps/pron)에 보낸다. 실패하면 던진다. */
public interface PronunciationScorer {

    Scored score(Path audio, String contentType, String scriptText);

    /** @param serverTime 채점 서비스가 이 줄에 쓴 시간. 옛 채점 서비스는 주지 않는다({@code null}) */
    record Scored(ScoredLine line, String modelVersion, ServerTime serverTime) {
        public Scored(ScoredLine line, String modelVersion) {
            this(line, modelVersion, null);
        }
    }

    /**
     * 채점 서비스가 줄 하나에 쓴 시간(ms). {@code totalMs} 는 요청을 받고 답을 만들기까지 전부이고 나머지 셋이 그 안에 든다.
     *
     * @param decodeMs 녹음을 파형으로 풀고 소리 없는 앞뒤를 잘라 내기
     * @param modelMs 음소 인식 모델 계산
     * @param gopMs 음소 비교·시각 정렬·대본 닮음
     */
    record ServerTime(long decodeMs, long modelMs, long gopMs, long totalMs) {
    }
}
