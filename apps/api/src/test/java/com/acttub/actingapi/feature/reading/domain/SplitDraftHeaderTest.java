package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;
import org.junit.jupiter.api.Test;

/** reading.split: 모델이 머리를 비웠을 때 이름 머리를 떼는 규칙, 빈 줄과 긴 제목, 첫 줄 제목 고르기. */
class SplitDraftHeaderTest {
    static ScriptDraft assemble(String title, String raw, Map<Integer, Row> rows) {
        return SplitDraft.assemble(title, raw, "paste", NumberedLine.of(raw), rows, List.of());
    }

    static Map<Integer, Row> dialogue(String speaker, int... numbers) {
        Map<Integer, Row> rows = new LinkedHashMap<>();
        for (int no : numbers) rows.put(no, new Row(no, Kind.DIALOGUE, speaker, ""));
        return rows;
    }

    @Test void aNameFollowedByAPunctuationMarkIsTakenAsTheHeader() {
        String raw = "MARA. 가지 마.\n[MARA] 돌아와.\n(MARA) 제발.\nMARA   — 끝이야.\nMARA, 왜 그래.\nMARA";
        ScriptDraft draft = assemble("t", raw, dialogue("MARA", 1, 2, 3, 4, 5, 6));
        assertThat(draft.lines()).extracting(ScriptDraft.Line::text)
                // 머리를 뗀 줄은 저마다 한 대사다. 「MARA, 」는 부르는 말이라 앞 대사에 잇고, 이름만 있는 끝 줄은 대사가 아니다
                .containsExactly("가지 마.", "돌아와.", "제발.", "끝이야. MARA, 왜 그래.");
        assertThat(draft.characterNames()).containsExactly("MARA");
    }

    @Test void aDialogueRowWithNoTextAndBlankDirectionsAreDropped() {
        String raw = "민호:\n​\n민호: 왔어.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "민호", "민호:"));
        rows.put(2, new Row(2, Kind.DIRECTION, "", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "민호", "민호: "));
        ScriptDraft draft = assemble("t", raw, rows);
        assertThat(draft.lines()).containsExactly(new ScriptDraft.Line(1, "dialogue", 0, "왔어."));
    }

    @Test void onlyTheFirstModelTitleCountsAndLongTitlesAreCut() {
        String raw = "봄날\n여름날\n지수: 안녕.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.TITLE, "", ""));
        rows.put(2, new Row(2, Kind.TITLE, "", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "지수", "지수: "));
        assertThat(assemble(null, raw, rows).title()).isEqualTo("봄날");
        String longTitle = "가".repeat(205);
        assertThat(assemble(longTitle, raw, rows).title()).hasSize(200);
    }

    @Test void dialogueSpeakerCastAndIgnoredLinesAreNotFallbackTitles() {
        String raw = "\n지수\n등장인물: 지수\n쪽 1\n안녕.\n바다 이야기";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(2, new Row(2, Kind.DIALOGUE, "지수", "지수"));
        rows.put(3, new Row(3, Kind.CAST, "", ""));
        rows.put(4, new Row(4, Kind.IGNORE, "", ""));
        rows.put(5, new Row(5, Kind.DIALOGUE, "지수", ""));
        assertThat(assemble(null, raw, rows).title()).isEqualTo("제목 없는 대본");
        Map<Integer, Row> onlyNames = new LinkedHashMap<>();
        onlyNames.put(1, new Row(1, Kind.DIALOGUE, "지수", "지수"));
        assertThat(assemble(null, "지수", onlyNames).title()).isEqualTo("제목 없는 대본");
        assertThat(SplitDraft.assemble(null, "", "paste", List.of(), Map.of(), List.of()).title()).isEqualTo("제목 없는 대본");
    }

    @Test void aFileNameIsOnlyUsedWhenNoRequestedOrModelTitleExists() {
        String raw = "오늘은 먼저 문을 열 거야. 조금 무서워도 괜찮아.";
        Map<Integer, Row> rows = dialogue("화자", 1);
        assertThat(SplitDraft.assembleWithSpeakers(null, raw, "file", NumberedLine.of(raw), rows, List.of(), Map.of(), "독백.v2.txt").draft().title())
                .isEqualTo("독백.v2");
        assertThat(SplitDraft.assembleWithSpeakers("직접 정한 제목", raw, "file", NumberedLine.of(raw), rows, List.of(), Map.of(), "독백.txt").draft().title())
                .isEqualTo("직접 정한 제목");
        String titled = "봄날\n민호: 왔어.";
        Map<Integer, Row> titledRows = new LinkedHashMap<>();
        titledRows.put(1, new Row(1, Kind.TITLE, "", ""));
        titledRows.put(2, new Row(2, Kind.DIALOGUE, "민호", "민호: "));
        assertThat(SplitDraft.assembleWithSpeakers(null, titled, "file", NumberedLine.of(titled), titledRows, List.of(), Map.of(), "파일명.txt").draft().title())
                .isEqualTo("봄날");
    }

    @Test void pageNumbersAreNotTitlesAndOldUploadsWithoutANameGetAnUntitledFallback() {
        String raw = "41쪽\n봄날\n민호: 왔어.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.TITLE, "", ""));
        rows.put(2, new Row(2, Kind.TITLE, "", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "민호", "민호: "));
        assertThat(assemble(null, raw, rows).title()).isEqualTo("봄날");
        rows.put(2, new Row(2, Kind.IGNORE, "", ""));
        assertThat(assemble(null, raw, rows).title()).isEqualTo("제목 없는 대본");
        assertThat(SplitDraft.assembleWithSpeakers(null, raw, "file", NumberedLine.of(raw), rows, List.of(), Map.of(), "C:\\scripts\\내 대본.pdf").draft().title())
                .isEqualTo("내 대본");
        assertThat(SplitDraft.assembleWithSpeakers(null, raw, "file", NumberedLine.of(raw), rows, List.of(), Map.of(), ".txt").draft().title())
                .isEqualTo("제목 없는 대본");
    }

    @Test void smallDomainRulesRejectOrNormaliseOddInput() {
        assertThatThrownBy(() -> new ScriptDraft("t", "r", "paste", List.of("지수"), List.of(), List.of()))
                .hasMessage("characterTraits must line up with characterNames");
        assertThat(SampleScript.draft(" ", "raw", "sample").title()).isEqualTo(SampleScript.TITLE);
        assertThat(RecordingRules.alreadyM4a(null)).isFalse();
        assertThat(RecordingRules.alreadyM4a("audio/aac")).isTrue();
        assertThat(RecordingRules.alreadyM4a("audio/x-m4a; codecs=mp4a")).isTrue();
        assertThat(RecordingRules.alreadyM4a("video/mp4")).isFalse();
    }
}
