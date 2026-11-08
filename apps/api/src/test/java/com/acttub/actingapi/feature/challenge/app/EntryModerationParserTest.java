package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict.Decision;
import org.junit.jupiter.api.Test;

/** 검사 출력 읽기와 신고 목록에 남길 사유·메모 (SOMA-907). */
class EntryModerationParserTest {
    @Test void readsAVerdictEvenInsideACodeFence() {
        var verdict = EntryModerationParser.parse("""
                ```json
                {"verdict":"HIDE","category":"violence","reason":"실제 상처를 보여 준다"}
                ```""");
        assertThat(verdict).isEqualTo(new EntryModerationVerdict(Decision.HIDE, "violence", "실제 상처를 보여 준다"));
        assertThat(verdict.reportReason()).isEqualTo("inappropriate");
        assertThat(verdict.reportNote()).isEqualTo("AI 검사: 숨김 (violence) 실제 상처를 보여 준다");
    }

    @Test void unknownCategoriesFallBackAndAPassHasNone() {
        assertThat(EntryModerationParser.parse("{\"verdict\":\"pass\",\"category\":\"weird\"}"))
                .isEqualTo(new EntryModerationVerdict(Decision.PASS, "none", null));
        var review = EntryModerationParser.parse("{\"verdict\":\"review\",\"category\":\"none\",\"reason\":\"\"}");
        assertThat(review).isEqualTo(new EntryModerationVerdict(Decision.REVIEW, "other", null));
        assertThat(review.reportReason()).isEqualTo("other");
        assertThat(EntryModerationParser.parse("{\"verdict\":\"hide\",\"category\":\"spam\"}").reportReason()).isEqualTo("spam");
    }

    @Test void rejectsOutputsThatAreNotAVerdict() {
        assertThatThrownBy(() -> EntryModerationParser.parse(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> EntryModerationParser.parse("판정할 수 없어요")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> EntryModerationParser.parse("{\"verdict\":\"maybe\"}")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> EntryModerationParser.parse("{\"verdict\":")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void readsTheFaceAndAMissingOrMalformedFaceIsUnknownWithoutFailingTheVerdict() {
        assertThat(EntryModerationParser.parse("{\"verdict\":\"pass\",\"category\":\"none\",\"face\":true}"))
                .isEqualTo(new EntryModerationVerdict(Decision.PASS, "none", null, true));
        assertThat(EntryModerationParser.parse("{\"verdict\":\"hide\",\"category\":\"spam\",\"reason\":\"광고\",\"face\":false}"))
                .isEqualTo(new EntryModerationVerdict(Decision.HIDE, "spam", "광고", false));
        assertThat(EntryModerationParser.parse("{\"verdict\":\"pass\",\"category\":\"none\"}").face()).isNull();
        assertThat(EntryModerationParser.parse("{\"verdict\":\"pass\",\"category\":\"none\",\"face\":\"yes\"}"))
                .isEqualTo(new EntryModerationVerdict(Decision.PASS, "none", null, null));
        assertThat(EntryModerationParser.parse("{\"verdict\":\"review\",\"category\":\"unrelated\",\"face\":null}").face()).isNull();
    }

    @Test void theFaceOnlyAnswerMustCarryAFace() {
        assertThat(EntryModerationParser.parseFace("```json\n{\"face\":true}\n```")).isTrue();
        assertThat(EntryModerationParser.parseFace("{\"face\":false}")).isFalse();
        assertThatThrownBy(() -> EntryModerationParser.parseFace("{\"verdict\":\"pass\"}")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> EntryModerationParser.parseFace("{\"face\":\"true\"}")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> EntryModerationParser.parseFace("모르겠어요")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void bothInstructionsAskForTheFaceWithoutDescribingPeople() {
        assertThat(EntryModerationPrompt.instruction("가지 마", "첫 참여")).contains("\"face\":true|false").contains("모자이크·흐림")
                .contains("외모·신원을 묘사하지 않는다");
        assertThat(EntryModerationPrompt.faceOnly()).contains("{\"face\":true|false}").contains("벽·천장·물건만")
                .contains("외모·신원을 묘사하지 않는다").doesNotContain("verdict");
    }

    @Test void notesNeverExceedTheReportNoteLimit() {
        var verdict = new EntryModerationVerdict(Decision.REVIEW, "unrelated", "가".repeat(300));
        String note = verdict.reportNote();
        assertThat(note.codePointCount(0, note.length())).isEqualTo(200);
        assertThat(note).startsWith("AI 검사: 확인 필요 (unrelated) ").endsWith("…");
        assertThat(EntryModerationVerdict.failureNote().length()).isLessThanOrEqualTo(200);
    }
}
