package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.LineResult;

/**
 * 리딩 회차를 응답에 실을 모양 — 카드·상세·진행 (reading.session).
 *
 * <p>회차 번호·구간의 대사 번호·내 대사 수·녹음된 줄 수는 저장하지 않고 집계로 얻는다.
 */
public final class SessionViews {
    private SessionViews() {
    }

    /**
     * 회차 목록(R00.5)의 항목 하나.
     *
     * @param ordinal 그 대본에서 시작한 순(1부터, 집계)
     * @param startDialogueNo 구간 시작 대사의 대사 번호
     * @param endDialogueNo 구간 끝 대사의 대사 번호
     * @param myDialogueCount 구간 안 내 대사 수
     * @param recordedLineCount 녹음된 줄 수(reading.recording)
     */
    public record SessionCardView(
            UUID id,
            int ordinal,
            String status,
            List<UUID> myCharacterIds,
            List<String> myCharacterNames,
            int startDialogueNo,
            int endDialogueNo,
            int myDialogueCount,
            int recordedLineCount,
            int elapsedSeconds,
            Instant startedAt,
            Instant endedAt) {
    }

    /**
     * @param currentLineId 다음에 할 대사 줄. completed 면 {@code null}, stopped 는 중단 위치
     * @param recordings 줄 순서의 녹음. 재생 주소는 녹음 기능(RA3)이 채운다
     */
    public record SessionDetailView(
            SessionCardView card,
            UUID scriptId,
            String mode,
            String advance,
            boolean record,
            UUID startLineId,
            UUID endLineId,
            UUID currentLineId,
            long progressSeq,
            List<LineResult> lineResults,
            List<RecordingView> recordings) {
    }

    /** 회차 상세의 녹음 하나. 재생 주소는 아직 없다({@code null}) — 녹음 기능이 서명 주소를 채운다. */
    public record RecordingView(
            UUID id,
            UUID lineId,
            int attemptNo,
            int durationMs,
            String contentType,
            long byteSize,
            String transcript,
            String transcriptSource,
            Boolean matched,
            String playbackUrl,
            Instant playbackExpiresAt) {
    }

    /** 진행 저장의 답 — 반영했든 무시했든 <b>현재 값</b>이다. */
    public record ProgressView(UUID currentLineId, int elapsedSeconds, long progressSeq, String status) {
    }
}
