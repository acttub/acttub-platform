package com.acttub.actingapi.feature.coach.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;

/**
 * 목적 없이 시작한 질문 대화(연습 루프)의 예시 답. 코치가 질문으로 끝나는 말을 하면 그 아래에 배우가 누를 수 있는 답 1~2개를
 * 보인다(pen 「질문 대화」 예시 답 칩). 고정 버튼 「맞아요·아니요」는 질문과 상관없이 같아서, 코치가 "A예요, B예요?"로 물어도
 * 맞지 않았다(2026-10-20 폰 점검).
 *
 * <p>모델은 목적별 코칭과 같은 숨은 칸 {@code <보기>}에 예시 답을 쓴다. 숨은 칸은 배우에게 보일 말과 스트리밍에서 이미 걸러진다
 * ({@link DirectVideoPracticeLoop#PURPOSE_BLOCK}, {@link VisibleCoachText}). 서버는 이번 턴의 예시 답을 대화 상태
 * {@code answer_examples}에 두고, 대화 응답이 그대로 내보낸다. 목적별 코칭은 {@code purpose.choices}를 쓰므로 여기서는 비운다.
 */
public final class AnswerExamples {
    static final String STATE_KEY = "answer_examples";
    static final int MAX = 2;

    /** 연습 루프 지시 맨 끝에 붙인다. 첫 응답의 "두 부분만 쓴다"는 형식 규칙의 예외임을 밝힌다. */
    static final String INSTRUCTION = """


            [예시 답 칸]
            배우에게 질문으로 끝나는 말을 했으면, 응답 맨 끝(다른 칸을 다 쓴 뒤)에 숨은 칸 <보기>를 하나 더 쓴다. 이 칸은 위의 "그 밖에는 쓰지 않는다"는 형식 규칙의 예외다.
            - 안에는 배우가 방금 그 질문에 바로 골라 보낼 수 있는 예시 답을 1~2개, 한 줄에 하나씩 쓴다.
            - 배우가 할 말투로, 배우에게 하는 말과 같은 언어로, 20자 안쪽 한 문장으로 쓴다. 한국어면 "~요"로 끝나는 존댓말로 쓴다.
            - 두 개를 쓰면 서로 다른 방향의 답으로 쓴다. 질문이 두 쪽 중 고르게 했으면 그 두 쪽을 배우 말로 쓴다.
            - 정답을 정해 주는 말이 아니라 배우가 할 법한 답이다. 코치 말에 없던 새 지적이나 방법을 넣지 않는다.
            - 따옴표, 영상 시간, "잘 모르겠어요", "직접 쓰기"는 쓰지 않는다(앱이 따로 둔다).
            - 질문하지 않은 말(정리, 마무리, 연기 영상이 아니라는 말)에는 <보기>를 쓰지 않는다.
            - 반드시 </보기>로 닫는다.
            예:
            <보기>
            멀리서 등 돌리고 있었어요
            바로 앞에서 저를 보고 있었어요
            </보기>
            """;

    private AnswerExamples() { }

    /** 모델 응답의 {@code <보기>}에서 예시 답을 최대 {@link #MAX}개 꺼낸다. 없으면 빈 목록이다. */
    static List<String> extract(String raw) {
        var labels = new ArrayList<String>();
        for (PurposeView.Choice choice : PurposeLoop.extract(raw).choices()) {
            String label = choice.label().strip();
            if (label.isEmpty() || labels.contains(label)) continue;
            labels.add(label);
            if (labels.size() == MAX) break;
        }
        return List.copyOf(labels);
    }

    /** 이번 코치 말에 붙일 예시 답. 질문이 아니면(물음표가 없으면) 빈 목록이다 — 다듬기 호출로 질문이 빠졌을 때도 같다. */
    static List<String> forReply(String raw, String shown) {
        if (shown == null || shown.indexOf('?') < 0 && shown.indexOf('？') < 0) return List.of();
        return extract(raw);
    }

    /** 이번 턴의 예시 답을 상태에 둔다. 빈 목록이면 지난 턴의 것을 지운다. */
    static void remember(ObjectNode state, List<String> examples) {
        if (examples == null || examples.isEmpty()) {
            state.remove(STATE_KEY);
            return;
        }
        ArrayNode array = state.putArray(STATE_KEY);
        examples.forEach(array::add);
    }

    /** 저장된 상태에서 지금 보일 예시 답. 목적별 코칭이거나 없으면 빈 목록이다. */
    public static List<String> from(String sessionPurpose, JsonNode state) {
        if (PurposeLoop.Purpose.of(sessionPurpose) != null || state == null) return List.of();
        var labels = new ArrayList<String>();
        for (JsonNode item : state.path(STATE_KEY)) {
            String label = item.asText("").strip();
            if (!label.isEmpty()) labels.add(label);
            if (labels.size() == MAX) break;
        }
        return List.copyOf(labels);
    }
}
