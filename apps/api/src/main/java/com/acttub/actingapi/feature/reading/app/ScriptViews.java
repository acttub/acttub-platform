package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 대본을 응답에 실을 모양 — 상세·카드·목록 (reading.script).
 *
 * <p>줄 수·대사 수·녹음 수와 카드의 상태 칩은 저장하지 않고 집계로 얻는다. "마지막 회차"는 그 대본에서 가장
 * 늦게 시작한 회차이고, 내 배역은 그 회차의 것이다.
 */
public final class ScriptViews {
    private ScriptViews() {
    }

    /**
     * @param recordingCount 모든 회차의 녹음 수
     * @param openSessionId 열린 회차(진행 중)의 id. 없으면 {@code null}
     * @param lastSession 마지막 회차. 회차가 없으면 {@code null}
     */
    public record ScriptView(
            UUID id,
            String title,
            String source,
            List<CharacterView> characters,
            List<LineView> lines,
            int recordingCount,
            UUID openSessionId,
            LastSessionView lastSession,
            Instant createdAt,
            Instant updatedAt) {
    }

    /** @param voicePreset 상대역 목소리 프리셋 id. {@code null} 이면 자동 */
    public record CharacterView(UUID id, String name, int order, String voicePreset, int dialogueCount) {
    }

    /**
     * @param characterId 대사면 배역, 지문·장면이면 {@code null}
     * @param dialogueNo 대사 번호 — 대사 줄만 센 순번(1부터). 지문·장면은 {@code null}
     */
    public record LineView(UUID id, int ordinal, String kind, UUID characterId, String text, Integer dialogueNo) {
    }

    /** 대본 상세와 카드가 함께 보는 마지막 회차. */
    public record LastSessionView(
            UUID id,
            String status,
            List<UUID> myCharacterIds,
            List<String> myCharacterNames,
            Instant startedAt,
            Instant endedAt) {
    }

    /**
     * 목록의 카드 하나.
     *
     * @param myCharacterNames 마지막 회차의 내 배역. 회차가 없으면 비어 있다("배역 미선택")
     * @param lastPracticedAt 마지막 회차의 마지막 갱신 시각. 회차가 없으면 {@code null}
     * @param lastActivityAt 마지막 활동 — 회차가 있으면 {@code lastPracticedAt}, 없으면 등록 시각
     * @param status {@code reading}(열린 회차 있음)·{@code completed}(마지막 회차가 완료)·{@code no_cast}(그 밖)
     */
    public record ScriptCardView(
            UUID id,
            String title,
            List<String> myCharacterNames,
            int dialogueCount,
            int recordingCount,
            Instant lastPracticedAt,
            Instant lastActivityAt,
            String status,
            Instant createdAt,
            Instant updatedAt) {
    }

    /**
     * @param totalCount 검색과 무관한 회원의 전체 대본 수 — 머리의 "전체 N개"
     * @param inProgressCount 열린 회차가 있는 대본 수 — 머리의 "연습 중 M개"
     */
    public record ScriptListView(List<ScriptCardView> scripts, int totalCount, int inProgressCount) {
    }
}
