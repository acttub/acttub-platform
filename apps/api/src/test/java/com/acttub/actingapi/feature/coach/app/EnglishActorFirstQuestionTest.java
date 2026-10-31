package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 2026-10-25·10-31 운영: 영어 대사 영상인데 첫 질문이 한국어로 나가고, 영어 판정 답이 글자 그대로 되풀이되고, [상대]가 화면에 보였다. */
class EnglishActorFirstQuestionTest {
    private static CoachSessionSnapshot snapshot(String situation, List<CoachTurnSnapshot> turns) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), situation, "", "",
                8000, "그 외", "그 외", null, "open", "", turns, PriorContext.EMPTY, "legacy", 0, null, null)
                .withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void firstReplyWithNothingWrittenLeavesTheLanguageToTheDialogue() {
        assertThat(DirectVideoPracticeLoop.languageUndecided(snapshot("", List.of()), null)).isTrue();
        assertThat(DirectVideoPracticeLoop.languageUndecided(snapshot("거실, 밤", List.of()), null)).as("한국어 메모").isFalse();
        assertThat(DirectVideoPracticeLoop.languageUndecided(snapshot("In a garden with crush", List.of()), null)).isFalse();
        assertThat(DirectVideoPracticeLoop.languageUndecided(
                snapshot("", List.of(new CoachTurnSnapshot("ai", "이 장면에서 상대는 어디서 듣고 있었어요?"))), "ok")).as("둘째 응답부터는 아니다").isFalse();
        assertThat(DirectVideoPrompts.firstQuestionLanguage()).contains("<코치>").contains("한국어로 쓴다");
    }

    @Test void laterTurnsFollowTheCoachFirstQuestionWhenTheActorWordsDecideNothing() {
        var english = snapshot("", List.of(new CoachTurnSnapshot("ai", "Where was your daughter and what did her face look like while she listened?")));
        assertThat(DirectVideoPracticeLoop.replyLanguage(english, "ok")).isEqualTo(Locale.ENGLISH);
        assertThat(DirectVideoPracticeLoop.replyLanguage(english, "네 그랬어요")).as("배우가 한국어로 쓰면 한국어").isNull();
        var korean = snapshot("", List.of(new CoachTurnSnapshot("ai", "\"30 minutes\"에서 상대는 어디서 듣고 있었어요?")));
        assertThat(DirectVideoPracticeLoop.replyLanguage(korean, "ok")).isNull();
    }

    @Test void writtenLanguageReadsOnlyNonKorean() {
        assertThat(DirectVideoPracticeLoop.writtenLanguage("Where was your daughter while you said \"30 minutes\"?")).isEqualTo(Locale.ENGLISH);
        assertThat(DirectVideoPracticeLoop.writtenLanguage("\"30 minutes\"에서 딸은 어디 있었어요?")).isNull();
        assertThat(DirectVideoPracticeLoop.writtenLanguage("")).isNull();
    }

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
