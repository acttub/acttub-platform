package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SplitDraftTest {

    @Test
    @DisplayName("SOMA-593 7-2 9번: 머리를 뗀 대사, 블록 형식의 이어지는 줄 합치기, 판정 없는 줄은 지문, 제목·등장인물·무시 줄은 대본 밖, 장면 머리는 모델이 머리라 해도 통째로")
    void assemblesBlockFormatAndStripsHeaders() {
        String raw = """
                봄날의 끝
                등장인물: 지수, 민호

                S#1 거실

                지수
                (문을 열며) 왔어?
                늦었네.
                민호: 미안.
                민호: 차가 막혔어.
                이상한 줄
                2
                """;
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.TITLE, "", ""));
        rows.put(2, new Row(2, Kind.CAST, "", ""));
        rows.put(4, new Row(4, Kind.SCENE, "", "S#1 "));
        rows.put(6, new Row(6, Kind.IGNORE, "", ""));
        rows.put(7, new Row(7, Kind.DIALOGUE, "지수", ""));
        rows.put(8, new Row(8, Kind.DIALOGUE, "지수", ""));
        rows.put(9, new Row(9, Kind.DIALOGUE, "민호", "민호: "));
        rows.put(10, new Row(10, Kind.DIALOGUE, "민호", "민호: "));
        rows.put(12, new Row(12, Kind.IGNORE, "", ""));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", lines, rows, List.of("지수", "민호"));

        assertThat(draft.title()).isEqualTo("봄날의 끝");
        assertThat(draft.characterNames()).containsExactly("지수", "민호");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "scene", null, "S#1 거실"),
                new ScriptDraft.Line(2, "dialogue", 0, "(문을 열며) 왔어? 늦었네."),
                new ScriptDraft.Line(3, "dialogue", 1, "미안."),
                new ScriptDraft.Line(4, "dialogue", 1, "차가 막혔어."),
                new ScriptDraft.Line(5, "direction", null, "이상한 줄"));
    }

    @Test
    @DisplayName("배역 순서: 등장인물 소개 줄에 나온 순이 먼저고, 거기 없는 배역은 대사 많은 순(같으면 먼저 말한 순)")
    void ordersCharactersByCastListThenDialogueCount() {
        String raw = """
                나오는 사람들 — 태오, 윤서
                하나: 안녕
                윤서: 안녕
                둘: 안녕
                태오: 안녕
                둘: 또 안녕
                """;
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.CAST, "", ""));
        rows.put(2, new Row(2, Kind.DIALOGUE, "하나", "하나: "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "윤서", "윤서: "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "둘", "둘: "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "태오", "태오: "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "둘", "둘: "));

        ScriptDraft draft = SplitDraft.assemble("제목", raw, "paste", lines, rows, List.of());

        assertThat(draft.characterNames()).containsExactly("태오", "윤서", "둘", "하나");
        assertThat(draft.lines().get(0).characterIndex()).isEqualTo(3);
    }

    @Test
    @DisplayName("줄 앞의 U+200B·BOM 은 저장되는 글과 제목에 남지 않는다")
    void invisibleCharactersDoNotSurvive() {
        String raw = "\uFEFF\u200B반지하 라디오\n\u200B(낡은 라디오에서 잡음이 난다.)\n\u200B하은: 오빠, 그거 고장 난 거 아니야?";
        Map<Integer, Row> rows = Map.of(
                2, new Row(2, Kind.DIRECTION, "", ""),
                3, new Row(3, Kind.DIALOGUE, "하은", "\u200B하은: "));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.title()).isEqualTo("반지하 라디오");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "direction", null, "반지하 라디오"),
                new ScriptDraft.Line(2, "direction", null, "(낡은 라디오에서 잡음이 난다.)"),
                new ScriptDraft.Line(3, "dialogue", 0, "오빠, 그거 고장 난 거 아니야?"));
    }

    @Test
    @DisplayName("배역 이름은 목록으로 바로잡아 저장하고, 모델이 쓴 제목이 없으면 첫 줄이 제목이다. 배역이 없으면 빈 배역 목록이다")
    void fixesNamesAndFallsBackToFirstLineTitle() {
        String raw = "맥베스: 내일, 또 내일.\n맥베س: 그리고 또 내일.";
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "맥베스", "맥베스: "),
                2, new Row(2, Kind.DIALOGUE, "맥베س", "맥베س: "));

        ScriptDraft draft = SplitDraft.assemble(" ", raw, "file", lines, rows, List.of("맥베스"));

        assertThat(draft.title()).isEqualTo("맥베스: 내일, 또 내일.");
        assertThat(draft.characterNames()).containsExactly("맥베스");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "dialogue", 0, "내일, 또 내일."),
                new ScriptDraft.Line(2, "dialogue", 0, "그리고 또 내일."));

        ScriptDraft prose = SplitDraft.assemble(null, "어느 날 밤이었다.", "paste", NumberedLine.of("어느 날 밤이었다."),
                Map.of(1, new Row(1, Kind.DIRECTION, "", "")), List.of());
        assertThat(prose.characterNames()).isEmpty();
        assertThat(prose.lines()).containsExactly(new ScriptDraft.Line(1, "direction", null, "어느 날 밤이었다."));
    }
}
