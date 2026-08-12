package com.acttub.actingapi.summary;

import java.nio.file.Path;

/** 섹션 D 분석 워커가 영상 관찰 층을 호출하는 진입점. */
public interface ObservationAnalyzer {
    ObservationPack analyze(Path videoPath, String mimeType, ActorMaterial actor);
}
