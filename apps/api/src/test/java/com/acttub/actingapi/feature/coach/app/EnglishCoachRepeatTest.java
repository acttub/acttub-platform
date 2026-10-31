package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Locale;
import org.junit.jupiter.api.Test;

/** 2026-10-31 운영: 영어 판정 답이 글자 그대로 되풀이되고, [상대]가 화면에 보였다. */
class EnglishCoachRepeatTest {
    @Test void placeholdersBecomeWords() {
        assertThat(DirectVideoPracticeLoop.withoutPlaceholders("이 장면에서 [상대]는 어디서 어떤 얼굴로 듣고 있었어요?"))
                .isEqualTo("이 장면에서 상대는 어디서 어떤 얼굴로 듣고 있었어요?");
        assertThat(DirectVideoPracticeLoop.withoutPlaceholders("[인물]은 [상대]한테서 뭘 얻고 싶었어요?"))
                .isEqualTo("이 인물은 상대한테서 뭘 얻고 싶었어요?");
        assertThat(DirectVideoPracticeLoop.withoutPlaceholders("\"[웃음]\" 뒤에요")).isEqualTo("\"[웃음]\" 뒤에요");
    }

    @Test void streamingNeverShowsAHalfWrittenPlaceholder() {
        String raw = "<코치>이 장면에서 [상대]는 어디서 어떤 얼굴로 듣고 있었어요?</코치>";
        for (int size : new int[] {1, 2, 3, 5}) {
            var out = new ArrayList<String>();
            var visible = new VisibleCoachText(false, out::add);
            for (int i = 0; i < raw.length(); i += size) visible.accept(raw.substring(i, Math.min(raw.length(), i + size)));
            assertThat(String.join("", out)).as("조각 크기 %d", size).isEqualTo("이 장면에서 상대는 어디서 어떤 얼굴로 듣고 있었어요?");
            assertThat(out).noneMatch(piece -> piece.contains("["));
        }
    }

    @Test void englishPointOutGivesTheVerdictAndDoesNotRepeat() {
        String task = DirectVideoPrompts.practiceLoopTask("짚어주기", Locale.ENGLISH);
        assertThat(task).contains("Can I submit?").contains("give the verdict first")
                .contains("Do not use a problem the coach already named").contains("More shape")
                .contains("is not a request for evaluation");
        assertThat(task).doesNotContain("three lines, no question");
    }
}
