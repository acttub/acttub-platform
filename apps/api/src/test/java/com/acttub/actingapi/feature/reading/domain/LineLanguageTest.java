package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class LineLanguageTest {

    @Test
    @DisplayName("한글이 아닌 글자가 셋 이상인 대사만 묻는다 — 괄호 안 지시는 세지 않는다")
    void asksOnlyForeignLines() {
        assertThat(LineLanguage.worthAsking("여기 있을 줄 알았어.")).isFalse();
        assertThat(LineLanguage.worthAsking("OK, 알았어.")).isFalse();
        assertThat(LineLanguage.worthAsking("알았어. (Sir 에게)")).isFalse();
        assertThat(LineLanguage.worthAsking("3anni ana? 안니 아나?")).isTrue();
        assertThat(LineLanguage.worthAsking("السلام عليكم")).isTrue();
        assertThat(LineLanguage.worthAsking("ありがとう")).isTrue();
        assertThat(LineLanguage.worthAsking(null)).isFalse();
    }

    @Test
    @DisplayName("답을 읽는다 — 한국어는 소리 낼 글 없이, 외국어는 소리 낼 글과 함께, 원문과 같으면 소리 낼 글을 두지 않는다")
    void parsesAnswer() {
        List<NumberedLine> sent = List.of(
                new NumberedLine(3, "3anni ana? 안니 아나?"),
                new NumberedLine(5, "Where are you going?"),
                new NumberedLine(7, "오케이, 굿모닝 Sir."));
        Map<Integer, LineLanguage.Result> parsed = LineLanguage.parse(
                "3\tar\tعني أنا؟\n5\ten\tWhere are you going?\n7\tko\t\n", sent);
        assertThat(parsed).containsEntry(3, new LineLanguage.Result("ar", "عني أنا؟"))
                .containsEntry(5, new LineLanguage.Result("en", null))
                .containsEntry(7, new LineLanguage.Result("ko", null));
    }

    @Test
    @DisplayName("보낸 적 없는 번호·목록 밖 말·빈 소리 낼 글·깨진 줄은 버린다")
    void dropsBadRows() {
        List<NumberedLine> sent = List.of(new NumberedLine(1, "salaam alaikum."), new NumberedLine(2, "bonjour à tous"));
        Map<Integer, LineLanguage.Result> parsed = LineLanguage.parse(
                "9\tar\tالسلام\n1\tzz\tالسلام\n2\tfr\t\n설명입니다\n1\tAR\tالسلام عليكم.", sent);
        assertThat(parsed).containsOnlyKeys(1).containsEntry(1, new LineLanguage.Result("ar", "السلام عليكم."));
    }

    @Test
    @DisplayName("대본에 붙이면 답이 있는 줄만 바뀐다")
    void attachesToDraft() {
        ScriptDraft draft = new ScriptDraft("Kiss", "raw", "paste", List.of("여자"), List.of(
                new ScriptDraft.Line(1, "dialogue", 0, "안녕"),
                new ScriptDraft.Line(2, "dialogue", 0, "3anni ana? 안니 아나?")));
        ScriptDraft next = draft.withLanguages(Map.of(2, new LineLanguage.Result("ar", "عني أنا؟")));
        assertThat(next.lines().get(0)).isEqualTo(new ScriptDraft.Line(1, "dialogue", 0, "안녕"));
        assertThat(next.lines().get(1)).isEqualTo(new ScriptDraft.Line(2, "dialogue", 0, "3anni ana? 안니 아나?", "ar", "عني أنا؟"));
        assertThat(draft.withLanguages(Map.of())).isSameAs(draft);
    }
}
