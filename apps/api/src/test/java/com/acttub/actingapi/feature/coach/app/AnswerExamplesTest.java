package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 질문 대화의 예시 답: 숨은 <보기> 꺼내기, 질문이 아닐 때 비우기, 상태 저장·읽기, 배우에게 보일 말에서 빠지기. */
class AnswerExamplesTest {

    private static final String REPLY = """
            상대는 어디서 어떤 얼굴로 듣고 있었어요?
            <보기>
            - 멀리서 등 돌리고 있었어요
            - 바로 앞에서 저를 보고 있었어요
            - 옆에서 웃고 있었어요
            </보기>
            """;

    @Test
    void 숨은_보기에서_예시_답을_두_개까지_꺼낸다() {
        assertThat(AnswerExamples.extract(REPLY))
                .containsExactly("멀리서 등 돌리고 있었어요", "바로 앞에서 저를 보고 있었어요");
    }

    @Test
    void 잘_모르겠어요와_직접_쓰기는_앱이_따로_두므로_뺀다() {
        String reply = "어느 쪽이었어요?\n<보기>\n잘 모르겠어요\n직접 쓰기\n붙잡고 싶었어요\n</보기>";
        assertThat(AnswerExamples.extract(reply)).containsExactly("붙잡고 싶었어요");
    }

    @Test
    void 보기가_없으면_빈_목록이다() {
        assertThat(AnswerExamples.extract("상대는 어디 있었어요?")).isEmpty();
        assertThat(AnswerExamples.extract(null)).isEmpty();
    }

    @Test
    void 질문이_아닌_말에는_예시_답을_붙이지_않는다() {
        assertThat(AnswerExamples.forReply(REPLY, "친구를 달래듯 해 봐도 좋아요.")).isEmpty();
        assertThat(AnswerExamples.forReply(REPLY, "상대는 어디서 어떤 얼굴로 듣고 있었어요?")).hasSize(2);
    }

    @Test
    void 배우에게_보일_말에서는_보기_칸이_빠진다() {
        assertThat(DirectVideoPracticeLoop.parse(REPLY).message()).isEqualTo("상대는 어디서 어떤 얼굴로 듣고 있었어요?");
    }

    @Test
    void 첫_응답_형식에서도_보기_칸이_빠진다() {
        String opening = "<코치>\n이 장면에서 상대는 어디 있었어요?\n</코치>\n<설계>\n영상: 혼자 말함\n</설계>\n<보기>\n멀리 있었어요\n</보기>";
        var parsed = DirectVideoPracticeLoop.parse(opening);
        assertThat(parsed.message()).isEqualTo("이 장면에서 상대는 어디 있었어요?");
        assertThat(AnswerExamples.forReply(opening, parsed.message())).containsExactly("멀리 있었어요");
    }

    @Test
    void 스트리밍에도_보기_칸은_나가지_않는다() {
        var sent = new ArrayList<String>();
        var visible = new VisibleCoachText(false, sent::add);
        for (String piece : List.of("상대는 어디 있었어요?\n<보", "기>\n멀리 있었", "어요\n</보기>")) visible.accept(piece);
        assertThat(String.join("", sent)).doesNotContain("멀리").doesNotContain("<");
    }

    @Test
    void 상태에_두고_목적_없는_대화에서만_읽는다() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        AnswerExamples.remember(state, List.of("멀리 있었어요", "가까이 있었어요"));
        assertThat(AnswerExamples.from(null, state)).containsExactly("멀리 있었어요", "가까이 있었어요");
        assertThat(AnswerExamples.from("stuck", state)).isEmpty();

        AnswerExamples.remember(state, List.of());
        assertThat(state.has(AnswerExamples.STATE_KEY)).isFalse();
        assertThat(AnswerExamples.from(null, state)).isEmpty();
        assertThat(AnswerExamples.from(null, null)).isEmpty();
    }
}
