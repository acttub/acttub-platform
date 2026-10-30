package com.acttub.actingapi.feature.reading.app;

import java.nio.file.Path;

/** 다시 받아쓸 녹음의 소리를 재고 받아쓴다. 구현은 ffmpeg·받아쓰기 모델을 쓴다. */
public interface RetranscribeAudio {

    /** 녹음 전체에서 가장 큰 소리(dBFS). 완전한 무음이면 {@link Double#NEGATIVE_INFINITY}. */
    double peakDb(Path audio);

    /** 받아쓴 글. 들린 말이 없으면 빈 문자열. 바깥 서비스 실패는 던진다. */
    String transcribe(Path audio);
}
