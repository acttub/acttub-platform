package com.acttub.actingapi.feature.analysis.app;

import java.nio.file.Path;

/**
 * 직접 영상 코칭 회차의 원본을 분석 작업이 내려받은 직후 받는 포트(SOMA-780).
 *
 * <p>앱은 '분석 중' 화면에서 이 작업이 끝나길 기다린 뒤에야 첫 질문을 청한다. 그 사이 코치가 같은 파일로
 * 소리 검사·Gemini 올리기·처리 대기를 먼저 시작해 두면, 첫 질문이 그만큼 덜 기다린다.
 *
 * <p>받는 쪽은 파일을 이 호출 안에서 복사해야 한다 — 호출이 끝나면 분석 작업이 임시 파일을 지운다.
 * 나머지 일은 뒤에서 하고 곧바로 돌아와야 한다. 던져도 분석 결과는 바뀌지 않는다.
 */
public interface DirectVideoWarmup {
    DirectVideoWarmup NONE = (context, file) -> { };

    void warm(AnalysisContext context, Path file);
}
