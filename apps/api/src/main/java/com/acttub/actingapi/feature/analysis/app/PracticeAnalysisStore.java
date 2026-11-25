package com.acttub.actingapi.feature.analysis.app;

/**
 * 0.1.0 회차({@code practices})의 분석 저장소 — 큐는 {@code ai_jobs} 이고 결과는 {@code analyses}·
 * {@code video_transcripts} 에 쓴다 (practice.analyze).
 *
 * <p>워커({@link AnalysisWorker})가 보는 포트는 {@link AnalysisStore} 다. 옛 원장({@code external_operations})을 쓰던
 * 구현은 SOMA-1140 에서 지웠고 지금 구현은 이것 하나다.
 */
public interface PracticeAnalysisStore extends AnalysisStore {
}
