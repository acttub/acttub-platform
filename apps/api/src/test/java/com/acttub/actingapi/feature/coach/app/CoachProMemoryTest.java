package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class CoachProMemoryTest {
    private static final Instant OCT_25 = Instant.parse("2026-10-25T05:00:00Z");

    @Test
    void 지난_노트의_짚은_것과_다음_테이크를_칸으로_만든다() {
        String block = CoachProMemory.block(List.of(new CoachProMemory.Past(OCT_25, "헤어진 연인에게 전화하는 장면",
                "대사 끝을 흐리며 내려놓는다", "마지막 대사를 상대 눈을 보고 끝까지 말해 보기", List.of(), null)));
        assertThat(block).startsWith("## 지난 연습 기억 (Pro)");
        assertThat(block).contains("10/25 「헤어진 연인에게 전화하는 장면」 짚은 것: 대사 끝을 흐리며 내려놓는다");
        assertThat(block).contains("다음 테이크로 정한 것: 마지막 대사를 상대 눈을 보고 끝까지 말해 보기");
        assertThat(block).contains("이번 영상에서 안 보이면 꺼내지 않는다");
    }

    @Test
    void 배우가_아니라고_한_회차는_진단을_빼고_정정만_남긴다() {
        String block = CoachProMemory.block(List.of(new CoachProMemory.Past(OCT_25, "", "시선이 바닥으로 떨어진다",
                "상대를 보고 말하기", List.of("주제: \"일부러 피한 거예요\""), "helpful")));
        assertThat(block).doesNotContain("시선이 바닥으로").doesNotContain("상대를 보고 말하기");
        assertThat(block).contains("배우가 아니라고 한 것: 주제: \"일부러 피한 거예요\"");
    }

    @Test
    void 도움_안_됨_노트와_빈_기록은_쓰지_않는다() {
        assertThat(CoachProMemory.block(List.of(new CoachProMemory.Past(OCT_25, "장면", "말이 빠르다", null, List.of(), "not_helpful"))))
                .isEmpty();
        assertThat(CoachProMemory.block(List.of())).isEmpty();
        assertThat(CoachProMemory.block(List.of(new CoachProMemory.Past(OCT_25, "", null, "없음", List.of(), null)))).isEmpty();
        assertThat(CoachProMemory.block(null)).isEmpty();
    }
}
