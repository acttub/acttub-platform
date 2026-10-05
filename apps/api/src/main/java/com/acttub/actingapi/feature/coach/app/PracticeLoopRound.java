package com.acttub.actingapi.feature.coach.app;

import java.util.List;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * 같은 묶음의 지난 회차를 다음 회차 코치에게 넘기는 한 줄(세션.md, SOMA-602).
 *
 * <p>"n차: 목표 — 버릇(이유) — 아니라고 한 것 — 제안". 연습 루프가 남긴 숨은 상태 칸과 대화 원문에서 코드로 고른다 —
 * 모델을 부르지 않는다. 기억 저장소({@code memory})가 지난 회차를 읽어 부르는 자리라 공개 타입만 쓴다(ADR-019).
 */
public final class PracticeLoopRound {

    private PracticeLoopRound() {}

    /** 저장된 턴 하나. 다른 도메인이 채우므로 coach 의 domain 타입을 쓰지 않는다. */
    public record Turn(String role, String text) {}

    private static final int PART_MAX = 60;

    /**
     * 연습 루프 회차의 한 줄. 연습 루프 상태가 없으면 {@code null} — 부르는 쪽이 예전 줄("n차: 제목 — 제안")을 쓴다.
     *
     * @param state 그 회차 대화의 {@code coach_conversations.state}
     */
    public static String line(int ordinal, String title, String nextTake, JsonNode state, List<Turn> turns) {
        JsonNode loop = state == null ? null : state.path(DirectVideoPracticeLoop.STATE_KEY);
        if (loop == null || !loop.isObject()) return null;
        var round = DirectVideoPracticeLoop.round(loop,
                turns.stream().map(t -> new CoachTurnSnapshot(t.role(), t.text())).toList());
        String habit = title != null && !title.isBlank() ? title : DirectVideoPracticeLoop.habit(loop.path("design").asText(""));
        StringBuilder line = new StringBuilder().append(ordinal).append("차: ");
        if (round.goal() != null) line.append("목표 ").append(clip(round.goal())).append(" — ");
        line.append("버릇 ").append(habit.isBlank() ? "없음" : clip(habit));
        if (round.reason() != null) line.append(" (이유: \"").append(clip(round.reason())).append("\")");
        if (!round.corrections().isEmpty()) line.append(" — 아니라고 한 것: ").append(String.join(" / ", round.corrections()));
        if (nextTake != null && !nextTake.isBlank()) line.append(" — 제안: ").append(clip(nextTake));
        return line.toString();
    }

    private static String clip(String text) {
        String value = text.strip().replaceAll("\\s*\\n\\s*", " ");
        if (value.codePointCount(0, value.length()) <= PART_MAX) return value;
        return value.substring(0, value.offsetByCodePoints(0, PART_MAX)).stripTrailing() + "…";
    }
}
