package com.acttub.actingapi.feature.analysis.app;

/**
 * 1.0.0 회차({@code practices})의 분석 저장소 — 큐는 {@code ai_jobs} 이고 결과는 {@code analyses}·
 * {@code video_transcripts} 에 쓴다 (practice.analyze).
 *
 * <p>옛 {@link AnalysisStore}(={@code external_operations} + {@code summaries})와 <b>같은 포트</b>를 물려받는
 * 이유는 워커 때문이다 — 영상을 내려받고 etag 를 견주고 실패를 분류하고 lease 를 다루는 규칙은 한 벌이어야
 * 한다(CONTRACT §5-7). 갈리는 것은 "무엇을 집고 어디에 쓰는가"뿐이라 구현만 둘이다.
 *
 * <p>두 원장은 PA4 가 코치·노트를 회차로 옮길 때까지 함께 돈다. 그때 옛 구현과 옛 워커 빈이 함께 사라진다.
 */
public interface PracticeAnalysisStore extends AnalysisStore {
}
