package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class LineReviewTest {

    private static final LineReview.Settings SETTINGS = new LineReview.Settings(LineReview.Mode.ALL, 0.9, 0.9, 0.8, 0.6, 0.7, 1.0, 4);
    private static final List<NumberedLine> LINES = NumberedLine.of("""
            S#1. 거실
            철수: 왔어?
            영희
            응, 방금.
            - 3 -
            철수  늦었네.
            (문이 닫힌다)
            민수: 나도 왔다.""");
    private static final Map<Integer, Row> ROWS = Map.of(
            1, new Row(1, Kind.SCENE, "", ""),
            2, new Row(2, Kind.DIALOGUE, "철수", "철수: "),
            3, new Row(3, Kind.DIALOGUE, "영희", "영희"),
            4, new Row(4, Kind.DIALOGUE, "영희", ""),
            6, new Row(6, Kind.DIRECTION, "", ""),
            8, new Row(8, Kind.DIALOGUE, "민수", "민수: "));

    @Test
    void asksDialogueAndDirectionLinesExceptPageNumbersAndNameOnlyLines() {
        List<LineReview.Question> questions = LineReview.questions(LINES, ROWS, Set.of(7), List.of("철수", "영희"), LineReview.Mode.ALL);

        assertThat(questions).extracting(LineReview.Question::no).containsExactly(2, 4, 6, 7, 8);
        assertThat(questions.get(1).reasons()).containsExactly("nohead", "edge");
        assertThat(questions.get(2).reasons()).containsExactly("rule", "edge");
        assertThat(questions.get(3).reasons()).containsExactly("dropped", "unanswered", "edge", "nospeech");
        assertThat(questions.get(0).reasons()).containsExactly("edge");
        assertThat(LineReview.questions(LINES, ROWS, Set.of(7), List.of("철수", "영희"), LineReview.Mode.SUSPECT))
                .extracting(LineReview.Question::no).containsExactly(4, 6, 7);
    }

    @Test
    void offersCharactersSeenInTheWindowFirstThenUnknownHeadsThenNone() {
        LineReview.Question last = LineReview.questions(LINES, ROWS, Set.of(), List.of("영희", "지수", "철수"), LineReview.Mode.ALL).getLast();

        assertThat(last.speakers()).extracting(LineReview.Choice::label).containsExactly("영희", "철수", "지수", "민수", "none");
        assertThat(last.state()).startsWith("판단할 줄:\nL8: 민수: 나도 왔다.\n\n앞뒤 줄(▶가 판단할 줄):\n  L1: S#1. 거실\n")
                .endsWith("\n▶ L8: 민수: 나도 왔다.");
    }

    @Test
    void changesOnlyWhatTheModelIsSureOf() {
        List<LineReview.Question> questions = LineReview.questions(LINES, ROWS, Set.of(), List.of("철수", "영희"), LineReview.Mode.ALL);
        LineReview.Question direction = questions.get(2); // 6: 철수  늦었네.
        LineReview.Question dialogue = questions.get(1); // 4: 영희의 이어지는 줄

        assertThat(LineReview.apply(direction, decision("dialogue", 0.95, "c01", 0.1), SETTINGS))
                .isEqualTo(new Row(6, Kind.DIALOGUE, "철수", ""));
        assertThat(LineReview.apply(direction, decision("dialogue", 0.5, "c01", 1.0), SETTINGS)).isNull();
        assertThat(LineReview.apply(direction, decision("dialogue", 0.95, "none", 1.0), SETTINGS)).isNull();
        assertThat(LineReview.apply(dialogue, decision("dialogue", 1.0, "c01", 0.85), SETTINGS))
                .isEqualTo(new Row(4, Kind.DIALOGUE, "철수", ""));
        assertThat(LineReview.apply(dialogue, decision("dialogue", 1.0, "c01", 0.7), SETTINGS)).isNull();
        assertThat(LineReview.apply(dialogue, decision("direction", 0.95, "none", 1.0), SETTINGS))
                .isEqualTo(new Row(4, Kind.DIRECTION, "", ""));
    }

    @Test
    void keepsGroupSpeakersAndSpacingVariantsAndDropsDialogueOnlyWhenSure() {
        List<NumberedLine> lines = NumberedLine.of("철수, 영희  가자!\n플레이어1 왔다\n이어지는 말이다");
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "철수, 영희", ""),
                2, new Row(2, Kind.DIALOGUE, "플레이어1", ""),
                3, new Row(3, Kind.DIALOGUE, "철수", ""));
        List<LineReview.Question> questions = LineReview.questions(lines, rows, Set.of(), List.of("철수", "플레이어 1"), LineReview.Mode.ALL);
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.6, 0.6, 0.7, 1.0, 4);

        assertThat(LineReview.apply(questions.get(0), decision("dialogue", 1.0, "c01", 1.0), settings)).isNull();
        String spaced = questions.get(1).speakers().stream().filter(c -> c.label().equals("플레이어 1")).findFirst().orElseThrow().value();
        assertThat(LineReview.apply(questions.get(1), decision("dialogue", 1.0, spaced, 1.0), settings)).isNull();
        assertThat(LineReview.apply(questions.get(2), decision("direction", 0.7, "none", 1.0), settings)).isNull();
        assertThat(LineReview.apply(questions.get(2), decision("direction", 0.8, "none", 1.0), settings))
                .isEqualTo(new Row(3, Kind.DIRECTION, "", ""));
    }

    @Test
    void asksExcludedLinesBetweenScenesAndFrontCastLinesButNotNameLinesRunningHeadersOrTitles() {
        StringBuilder text = new StringBuilder("짧은 청춘\n상황: 철수가 회사에서 의심받는다.\n");
        Map<Integer, Row> rows = new java.util.HashMap<>(Map.of(1, new Row(1, Kind.TITLE, "", ""), 2, new Row(2, Kind.CAST, "", "")));
        for (int no = 3; no <= 30; no++) {
            text.append("철수: 말 ").append(no).append('\n');
            rows.put(no, new Row(no, Kind.DIALOGUE, "철수", "철수: "));
        }
        String[] middle = {"경비: 저기 나가지 마세", "먼", "동서울대학교 제작공연 | <시련>", "영희", "가자.", "철수, 영희", "동서울대학교 제작공연 | <시련>", "⸻"};
        Kind[] kinds = {Kind.DIALOGUE, Kind.IGNORE, Kind.IGNORE, Kind.IGNORE, Kind.DIALOGUE, Kind.IGNORE, Kind.TITLE, Kind.IGNORE};
        for (int k = 0; k < middle.length; k++) {
            int no = 31 + k;
            text.append(middle[k]).append('\n');
            rows.put(no, kinds[k] == Kind.DIALOGUE
                    ? new Row(no, Kind.DIALOGUE, k == 0 ? "경비" : "영희", k == 0 ? "경비: " : "") : new Row(no, kinds[k], "", ""));
        }
        for (int no = 39; no <= 60; no++) {
            text.append("철수: 말 ").append(no).append('\n');
            rows.put(no, new Row(no, Kind.DIALOGUE, "철수", "철수: "));
        }
        List<LineReview.Question> questions = LineReview.questions(NumberedLine.of(text.toString().strip()), rows, Set.of(),
                List.of("철수", "영희", "경비"), LineReview.Mode.ALL);

        assertThat(questions).filteredOn(q -> q.reasons().contains("excluded")).extracting(LineReview.Question::no).containsExactly(2, 32);
        assertThat(questions).extracting(LineReview.Question::no).doesNotContain(1, 33, 34, 36, 37, 38);
        LineReview.Question fragment = questions.stream().filter(q -> q.no() == 32).findFirst().orElseThrow();
        String guard = fragment.speakers().stream().filter(c -> c.label().equals("경비")).findFirst().orElseThrow().value();
        assertThat(fragment.extras()).extracting(LineReview.Extra::key).containsExactly(LineReview.NOTE_QUESTION);
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 1.0, 4);
        assertThat(LineReview.apply(fragment, decision("dialogue", 0.95, guard, 0.5), settings)).isEqualTo(new Row(32, Kind.DIALOGUE, "경비", ""));
        assertThat(LineReview.apply(fragment, decision("dialogue", 0.6, guard, 0.5), settings)).isNull();
        assertThat(LineReview.apply(fragment, decision("title", 0.95, "none", 1.0), settings)).isNull();
        assertThat(LineReview.apply(fragment, with(decision("dialogue", 0.95, guard, 0.5), LineReview.NOTE_QUESTION, "note", 0.6), settings)).isNull();
        assertThat(LineReview.apply(fragment, with(decision("dialogue", 0.95, guard, 0.5), LineReview.NOTE_QUESTION, "script", 0.6), settings))
                .isEqualTo(new Row(32, Kind.DIALOGUE, "경비", ""));
        LineReview.Question title = new LineReview.Question(37, Set.of("excluded"), "", fragment.speakers(), new Row(37, Kind.TITLE, "", ""), List.of(), null, null, Set.of());
        assertThat(LineReview.apply(title, decision("dialogue", 0.95, guard, 1.0), settings)).isNull();
        assertThat(LineReview.apply(title, decision("scene", 0.8, "none", 1.0), settings)).isEqualTo(new Row(37, Kind.SCENE, "", ""));
        // 문서 머리의 등장인물 줄은 작품 정보·안내 글이라고 확신한 답이 아니면 되살린다
        LineReview.Question front = questions.getFirst();
        assertThat(front.extras()).extracting(LineReview.Extra::key).containsExactly(LineReview.EDGE_QUESTION);
        assertThat(LineReview.apply(front, with(decision("direction", 0.9, "none", 1.0), LineReview.EDGE_QUESTION, "info", 0.6), settings)).isNull();
        assertThat(LineReview.apply(front, with(decision("direction", 0.9, "none", 1.0), LineReview.EDGE_QUESTION, "guide", 0.3), settings))
                .isEqualTo(new Row(2, Kind.DIRECTION, "", ""));
        assertThat(LineReview.apply(front, decision("scene", 0.9, "none", 1.0), settings)).isNull();
    }

    @Test
    void keepsNameAndActionOnlyLinesAsDialogueOnlyWhenTheModelIsSure() {
        List<NumberedLine> lines = NumberedLine.of("처녀    (끄덕)\n동하 : (민우를 바라본다)\n[ 엄 마 ] (아무 말 안 함)\n철수 (웃으며) 그래.\n영희");
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "처녀", "처녀    "),
                2, new Row(2, Kind.DIALOGUE, "동하", "동하 : (민우를 바라본다)"),
                3, new Row(3, Kind.DIALOGUE, "엄마", "[ 엄 마 ] "),
                4, new Row(4, Kind.DIALOGUE, "철수", "철수 "),
                5, new Row(5, Kind.DIALOGUE, "영희", "영희"));
        List<LineReview.Question> questions = LineReview.questions(lines, rows, Set.of(), List.of("처녀", "동하", "엄마", "철수", "영희"),
                LineReview.Mode.ALL);
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 1.0, 4);

        assertThat(questions).extracting(LineReview.Question::no).containsExactly(1, 2, 3, 4);
        assertThat(questions).filteredOn(q -> q.reasons().contains("action")).extracting(LineReview.Question::no).containsExactly(1, 2, 3);
        assertThat(LineReview.apply(questions.get(0), decision("dialogue", 0.5, "none", 1.0), settings)).isEqualTo(new Row(1, Kind.DIRECTION, "", ""));
        assertThat(LineReview.apply(questions.get(1), decision("direction", 0.5, "none", 1.0), settings)).isEqualTo(new Row(2, Kind.DIRECTION, "", ""));
        assertThat(LineReview.apply(questions.get(2), decision("dialogue", 0.8, "none", 1.0), settings)).isNull();
        assertThat(LineReview.apply(questions.get(2), new LineReview.Decision(null, null), settings)).isNull();
        assertThat(LineReview.apply(questions.get(3), decision("dialogue", 0.5, "none", 1.0), settings)).isNull();
    }

    @Test
    void tellsTheModelWhereTheLineSitsAtTheEdgesOfTheDocument() {
        LineReview.Question first = LineReview.questions(LINES, ROWS, Set.of(), List.of("철수", "영희"), LineReview.Mode.ALL).getFirst();

        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 1.0, 4);

        assertThat(first.state()).startsWith("판단할 줄:\nL2: 철수: 왔어?");
        assertThat(first.extras().getFirst().instructions()).contains("문서 전체 8줄 중 앞에서 2번째 줄");
        assertThat(LineReview.apply(first, edge("guide", 0.9), settings)).isEqualTo(new Row(2, Kind.IGNORE, "", ""));
        assertThat(LineReview.apply(first, edge("info", 0.7), settings)).isNull();
        LineReview.Question direction = LineReview.questions(LINES, ROWS, Set.of(), List.of("철수", "영희"), LineReview.Mode.ALL).get(2);
        assertThat(LineReview.apply(direction, edge("guide", 0.7), settings)).isEqualTo(new Row(6, Kind.IGNORE, "", ""));
        assertThat(LineReview.apply(direction, edge("guide", 0.5), settings)).isNull();
        assertThat(LineReview.apply(first, edge("script", 1.0), settings)).isNull();
    }

    @Test
    void asksWhetherTheWordsAfterALeadingActionAreSpokenAndKeepsTheSourceHead() {
        List<NumberedLine> lines = NumberedLine.of("""
                에드나  나눠야 해.
                (전화가 울린다) 또 오네.
                댄포스 (눈을 크게 뜨고) 그래. (사이, 그는
                돌아선다.) 네가 그랬니?
                트레이시  네.
                (조명이 바뀐다) 철수가 들어온다.
                어느새 고(35)가 본다.
                (짐승처럼 악을 쓴다)
                에드나 ( ) , , , .""");
        Map<Integer, Row> rows = new java.util.HashMap<>();
        for (int no = 2; no <= 9; no++) {
            rows.put(no, new Row(no, Kind.DIRECTION, "", ""));
        }
        rows.put(1, new Row(1, Kind.DIALOGUE, "에드나", "에드나  "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "트레이시", "트레이시  "));
        List<String> characters = List.of("에드나", "댄포스", "트레이시", "철수");
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), characters, LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 1.0, 4);

        assertThat(questions.values()).filteredOn(q -> q.reasons().contains("talk")).extracting(LineReview.Question::no).containsExactlyInAnyOrder(2, 3, 4, 6);
        assertThat(questions.get(2).extras()).extracting(LineReview.Extra::key).contains(LineReview.TALK_QUESTION);
        assertThat(questions.get(3).extras().getLast().instructions()).contains("「그래.」");
        assertThat(questions.get(8).reasons()).contains("nospeech").doesNotContain("talk");
        assertThat(questions.get(9).reasons()).contains("nospeech");
        assertThat(questions.get(6).reasons()).doesNotContain("nospeech");
        assertThat(LineReview.apply(questions.get(2), talk(0.8), settings)).isEqualTo(new Row(2, Kind.DIALOGUE, "에드나", ""));
        assertThat(LineReview.apply(questions.get(3), talk(0.8), settings)).isEqualTo(new Row(3, Kind.DIALOGUE, "댄포스", "댄포스 "));
        assertThat(LineReview.apply(questions.get(3), talk(0.6), settings)).isNull();
        assertThat(LineReview.apply(questions.get(4), talk(0.8), settings)).isNull(); // 화자를 정할 수 없다
        assertThat(LineReview.apply(questions.get(6), with(decision("direction", 0.9, "none", 1.0), LineReview.TALK_QUESTION, "narration", 0.9),
                settings)).isNull();
        String edna = questions.get(8).speakers().stream().filter(c -> c.label().equals("에드나")).findFirst().orElseThrow().value();
        assertThat(LineReview.apply(questions.get(8), decision("dialogue", 0.6, edna, 1.0), settings)).isNull();
        assertThat(LineReview.apply(questions.get(8), decision("dialogue", 0.8, edna, 1.0), settings)).isEqualTo(new Row(8, Kind.DIALOGUE, "에드나", ""));

        rows.put(2, new Row(2, Kind.DIALOGUE, "에드나", ""));
        LineReview.Question continued = LineReview.questions(lines, rows, Set.of(), characters, LineReview.Mode.ALL).get(1);
        assertThat(continued.reasons()).contains("talk");
        assertThat(LineReview.apply(continued, talk(0.8), settings)).isNull(); // 지문 0.9 여도 말이라 내리지 않는다
        assertThat(LineReview.apply(continued, talk(0.3), settings)).isNull(); // 말 판단이 종류 답과 어긋나면 확신이 낮아도 내리지 않는다(재생 007)
        assertThat(LineReview.apply(continued, with(decision("direction", 0.9, "none", 1.0), LineReview.TALK_QUESTION, "narration", 0.6),
                settings)).isEqualTo(new Row(2, Kind.DIRECTION, "", ""));
    }

    @Test
    void judgesSeparatorsEndMarksAndCastLinesInsideADialogueBlockFromTheirContext() {
        List<NumberedLine> lines = NumberedLine.of("""
                S#1. 거실
                철수: 왔어?
                ⸻
                영희: 응.
                ⸻
                철수: 오늘 정말
                이상한 날이었어.
                ⸻
                영희: 그래.
                넘버 1 - 노래
                24 240 ,
                철수: 끝이야.
                - 막 -
                이 작품은 2026년 봄에 처음 무대에 올랐다.""");
        Kind[] kinds = {Kind.SCENE, Kind.DIALOGUE, Kind.IGNORE, Kind.DIALOGUE, Kind.IGNORE, Kind.DIALOGUE, Kind.CAST, Kind.DIRECTION,
                Kind.DIALOGUE, Kind.TITLE, Kind.IGNORE, Kind.DIALOGUE, Kind.IGNORE, Kind.TITLE};
        Map<Integer, Row> rows = new java.util.HashMap<>();
        for (int no = 1; no <= kinds.length; no++) {
            String speaker = kinds[no - 1] != Kind.DIALOGUE ? "" : no % 4 == 0 || no == 9 ? "영희" : "철수";
            rows.put(no, new Row(no, kinds[no - 1], speaker, speaker.isEmpty() ? "" : speaker + ": "));
        }
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("철수", "영희"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);

        assertThat(questions.keySet()).contains(7, 8, 10, 13).doesNotContain(3, 5, 11, 14);
        assertThat(questions.get(8).reasons()).contains("decor");
        assertThat(LineReview.apply(questions.get(8), decision("direction", 0.9, "none", 1.0), settings)).isEqualTo(new Row(8, Kind.IGNORE, "", ""));
        assertThat(questions.get(7).reasons()).contains("carry");
        assertThat(LineReview.apply(questions.get(7), decision("dialogue", 0.45, "none", 1.0), settings)).isEqualTo(new Row(7, Kind.DIALOGUE, "철수", ""));
        assertThat(LineReview.apply(questions.get(7), decision("direction", 0.6, "none", 1.0), settings)).isNull();
        assertThat(questions.get(10).reasons()).doesNotContain("carry");
        assertThat(LineReview.apply(questions.get(10), decision("dialogue", 0.95, "none", 1.0), settings)).isNull();
        assertThat(questions.get(13).reasons()).contains("tail");
        assertThat(LineReview.apply(questions.get(13), with(decision("direction", 0.8, "none", 1.0), LineReview.EDGE_QUESTION, "script", 0.6), settings))
                .isEqualTo(new Row(13, Kind.SCENE, "", ""));
        assertThat(LineReview.apply(questions.get(13), with(decision("scene", 0.8, "none", 1.0), LineReview.EDGE_QUESTION, "info", 0.6), settings))
                .isNull();

        // 구분선은 같은 줄을 첫 답이 무엇으로 몇 번 판정했든 구분선이다
        rows.put(3, new Row(3, Kind.DIRECTION, "", ""));
        rows.put(5, new Row(5, Kind.DIRECTION, "", ""));
        assertThat(LineReview.questions(lines, rows, Set.of(), List.of("철수", "영희"), LineReview.Mode.ALL))
                .filteredOn(q -> q.no() == 8).allSatisfy(q -> assertThat(q.reasons()).contains("decor"));
    }

    @Test
    @DisplayName("SOMA-663 M8 부분 C: 첫 답이 지문으로 둔 꾸민 끝 표시도 대본 내용이라는 답이면 장면이고, 꾸밈 없는 「암전.」은 지문이다")
    void readsDecoratedEndMarkAnsweredAsDirection() {
        List<NumberedLine> lines = NumberedLine.of("철수: 끝이야.\n암전.\n- 막 -\n");
        Map<Integer, Row> rows = Map.of(1, new Row(1, Kind.DIALOGUE, "철수", "철수: "), 2, new Row(2, Kind.DIRECTION, "", ""),
                3, new Row(3, Kind.DIRECTION, "", ""));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("철수"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);

        assertThat(questions.get(2).reasons()).doesNotContain("tail");
        assertThat(questions.get(3).reasons()).contains("tail");
        assertThat(LineReview.apply(questions.get(3), with(decision("direction", 0.9, "none", 1.0), LineReview.EDGE_QUESTION, "script", 0.9), settings))
                .isEqualTo(new Row(3, Kind.SCENE, "", ""));
        assertThat(LineReview.apply(questions.get(2), with(decision("direction", 0.9, "none", 1.0), LineReview.EDGE_QUESTION, "script", 0.9), settings))
                .isNull();
    }

    @Test
    void marksSeparatorsByTheirShapeOnly() {
        List<NumberedLine> lines = NumberedLine.of("철수: 왔어?\n━━━━━━\n* * *\n---\n…\n-\n~\n( ) .\n*\n*\n영희: 응.");
        Map<Integer, Row> rows = new java.util.HashMap<>();
        for (int no = 2; no <= 10; no++) {
            rows.put(no, new Row(no, Kind.DIRECTION, "", ""));
        }
        rows.put(1, new Row(1, Kind.DIALOGUE, "철수", "철수: "));
        rows.put(11, new Row(11, Kind.DIALOGUE, "영희", "영희: "));

        assertThat(LineReview.questions(lines, rows, Set.of(), List.of("철수", "영희"), LineReview.Mode.ALL))
                .filteredOn(q -> q.reasons().contains("decor")).extracting(LineReview.Question::no).containsExactly(2, 3, 4, 9, 10);
    }

    @Test
    void revivesTitleAndCastLinesAsDialogueOnlyWithASpeakerHeadOrAQuoteAndASureSpeaker() {
        List<NumberedLine> lines = NumberedLine.of("""
                철수: 왔어?
                [다음 화 예고]
                1. 철수가 묻는다.
                    “너 진짜 괜찮아?”
                영희: 응, 괜찮아.
                철수: 그래.""");
        Map<Integer, Row> rows = new java.util.HashMap<>();
        for (int no = 2; no <= 5; no++) {
            rows.put(no, new Row(no, Kind.TITLE, "", ""));
        }
        rows.put(1, new Row(1, Kind.DIALOGUE, "철수", "철수: "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "철수", "철수: "));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("철수", "영희"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);
        String cheolsu = questions.get(4).speakers().stream().filter(c -> c.label().equals("철수")).findFirst().orElseThrow().value();
        String younghee = questions.get(5).speakers().stream().filter(c -> c.label().equals("영희")).findFirst().orElseThrow().value();

        assertThat(questions.get(4).reasons()).contains("quote");
        assertThat(questions.get(5).reasons()).contains("rule");
        assertThat(questions.get(3).reasons()).doesNotContain("quote", "rule");
        assertThat(LineReview.apply(questions.get(4), decision("dialogue", 0.9, cheolsu, 0.95), settings)).isEqualTo(new Row(4, Kind.DIALOGUE, "철수", ""));
        assertThat(LineReview.apply(questions.get(5), decision("dialogue", 0.9, younghee, 0.95), settings)).isEqualTo(new Row(5, Kind.DIALOGUE, "영희", ""));
        // 화자를 확신하지 못하거나, 종류를 내리기 문턱만큼 확신하지 못하거나, 근거가 없거나, 덧붙은 글이라는 답이면 그대로 둔다
        assertThat(LineReview.apply(questions.get(4), decision("dialogue", 0.9, cheolsu, 0.8), settings)).isNull();
        assertThat(LineReview.apply(questions.get(4), decision("dialogue", 0.7, cheolsu, 0.95), settings)).isNull();
        assertThat(LineReview.apply(questions.get(3), decision("dialogue", 0.9, cheolsu, 0.95), settings)).isNull();
        assertThat(LineReview.apply(questions.get(4), with(decision("dialogue", 0.9, cheolsu, 0.95), LineReview.NOTE_QUESTION, "note", 0.6), settings))
                .isNull();
    }

    @Test
    void sendsTheNearestSpeakerHeadAndSceneCastForHeadlessLinesThatDisagree() {
        List<NumberedLine> lines = NumberedLine.of("""
                S#1. 거실
                폴라  안녕.
                카트린  아냐, 그 사람들은 의견을 내놓지 않아.
                심지어 행동까지 했다고.
                저기요 좀 움직여 보세요!
                프랑주  좋아.
                (폴라, 프랑주 보며) 기분 나빠지신 거 같은데?""");
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.SCENE, "", ""),
                2, new Row(2, Kind.DIALOGUE, "폴라", "폴라  "),
                3, new Row(3, Kind.DIALOGUE, "카트린", "카트린  "),
                4, new Row(4, Kind.DIALOGUE, "카트린", ""),
                5, new Row(5, Kind.DIALOGUE, "폴라", ""),
                6, new Row(6, Kind.DIALOGUE, "프랑주", "프랑주  "),
                7, new Row(7, Kind.DIALOGUE, "프랑주", "(폴라, 프랑주 보며) "));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("폴라", "프랑주", "카트린"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = ScriptSplitRules.REVIEW;

        assertThat(questions.get(4).head()).isNull(); // 나누기 답이 위 머리와 같다 — 요청은 전과 같다
        assertThat(questions.get(4).state()).doesNotContain("문맥 근거");
        LineReview.Question continued = questions.get(5);
        assertThat(continued.head()).isEqualTo("카트린");
        assertThat(continued.state()).contains("\n\n문맥 근거:\n- 위로 가장 가까운 화자 머리: L3: 카트린  아냐", "→ 카트린.",
                "\n- 이 장면에서 말한 배역: 카트린, 폴라, 프랑주");
        String katrin = value(continued, "카트린");
        assertThat(LineReview.apply(continued, decision("dialogue", 1.0, katrin, 0.85), settings)).isEqualTo(new Row(5, Kind.DIALOGUE, "카트린", ""));
        assertThat(LineReview.apply(continued, decision("dialogue", 1.0, katrin, 0.7), settings)).isNull();
        assertThat(LineReview.apply(continued, decision("dialogue", 1.0, value(continued, "프랑주"), 0.8), settings)).isNull();
        LineReview.Question looking = questions.get(7);
        assertThat(looking.watched()).containsExactly("폴라", "프랑주");
        assertThat(looking.state()).contains("괄호 안의 이름(폴라, 프랑주)은 말하는 사람이 바라보거나 말을 거는 대상일 수 있습니다");
        assertThat(LineReview.apply(looking, decision("dialogue", 1.0, value(looking, "폴라"), 0.95), settings)).isNull();
    }

    @Test
    void offersSceneParticipantSetsForCountedAndJoinedGroupHeads() {
        List<NumberedLine> lines = NumberedLine.of("""
                S#2. 골목
                순이네    이거나 먹어봐.
                동진네    뭐야?
                미나네    좋다.
                영실네    네.
                셋        맛있네, 뭐야?
                네 알겠어요.
                미나네,동진네 쉿!""");
        Map<Integer, Row> rows = new java.util.HashMap<>(Map.of(1, new Row(1, Kind.SCENE, "", "")));
        String[] said = {"순이네", "동진네", "미나네", "영실네", "순이네", "영실네", "미나네"};
        for (int k = 0; k < said.length; k++) {
            rows.put(k + 2, new Row(k + 2, Kind.DIALOGUE, said[k], k < 4 ? said[k] + "    " : ""));
        }
        List<String> characters = List.of("순이네", "동진네", "미나네", "영실네", "셋");
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), characters, LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.6, 4);

        LineReview.Question three = questions.get(6);
        assertThat(three.speakers()).extracting(LineReview.Choice::label).contains("셋", "순이네, 동진네, 영실네", "동진네, 미나네, 영실네");
        assertThat(three.state()).contains("줄 머리 「셋」은 함께 말하는 3명입니다");
        assertThat(LineReview.apply(three, decision("dialogue", 1.0, value(three, "동진네, 미나네, 영실네"), 0.95), settings))
                .isEqualTo(new Row(6, Kind.DIALOGUE, "동진네, 미나네, 영실네", ""));
        assertThat(questions.get(7).speakers()).extracting(LineReview.Choice::label).noneMatch(label -> label.contains(","));
        assertThat(questions.get(8).speakers()).extracting(LineReview.Choice::label).contains("미나네, 동진네");
    }

    @Test
    void asksWhetherAHeadlessLineAfterNarrationIsWrittenAndDropsOnlySureWriting() {
        List<NumberedLine> lines = NumberedLine.of("""
                S#1. 교실
                유리는 책상 위 종이를 본다.
                너 때문에 다 피곤해.
                [은서]
                미안해 오늘 못 갔어.
                유리 그래?
                은서는 고개를 든다.
                은서 알았어.""");
        Map<Integer, Row> rows = Map.of(1, new Row(1, Kind.SCENE, "", ""), 2, new Row(2, Kind.DIRECTION, "", ""),
                3, new Row(3, Kind.DIALOGUE, "유리", ""), 4, new Row(4, Kind.IGNORE, "", ""), 5, new Row(5, Kind.DIALOGUE, "은서", ""),
                6, new Row(6, Kind.DIALOGUE, "유리", "유리 "), 7, new Row(7, Kind.DIRECTION, "", ""), 8, new Row(8, Kind.DIALOGUE, "윤은서", ""));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("유리", "은서"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);
        LineReview.Question paper = questions.get(3);
        LineReview.Decision kept = decision("dialogue", 0.9, value(paper, "유리"), 0.9);

        assertThat(paper.extras()).extracting(LineReview.Extra::key).contains(LineReview.MEDIUM_QUESTION);
        // 이름 줄 아래 문자 메시지와 머리 있는 줄, 모델 이름과 달라도 줄 머리에 배역 이름이 있는 줄은 묻지 않는다
        assertThat(questions.get(5).extras()).extracting(LineReview.Extra::key).doesNotContain(LineReview.MEDIUM_QUESTION);
        assertThat(questions.get(6).extras()).extracting(LineReview.Extra::key).doesNotContain(LineReview.MEDIUM_QUESTION);
        assertThat(questions.get(8).reasons()).contains("nohead");
        assertThat(questions.get(8).extras()).extracting(LineReview.Extra::key).doesNotContain(LineReview.MEDIUM_QUESTION);
        assertThat(LineReview.apply(paper, with(kept, LineReview.MEDIUM_QUESTION, "writing", 0.8), settings)).isEqualTo(new Row(3, Kind.DIRECTION, "", ""));
        assertThat(LineReview.apply(paper, with(kept, LineReview.MEDIUM_QUESTION, "writing", 0.7), settings)).isNull();
        assertThat(LineReview.apply(paper, with(kept, LineReview.MEDIUM_QUESTION, "action", 1.0), settings)).isNull();
        // 실제 발화라는 답과 어긋나는 지문 답으로는 대사를 내리지 않는다(재생 054 증언)
        LineReview.Decision dropped = decision("direction", 0.9, "none", 1.0);
        assertThat(LineReview.apply(paper, with(dropped, LineReview.MEDIUM_QUESTION, "voice", 0.3), settings)).isNull();
        assertThat(LineReview.apply(paper, with(dropped, LineReview.MEDIUM_QUESTION, "action", 0.3), settings)).isEqualTo(new Row(3, Kind.DIRECTION, "", ""));
    }

    @Test
    @DisplayName("줄 앞 괄호가 배역 이름뿐이면 화자 표시다 — 말이라는 답에 대사로 바꾸기 문턱을 쓴다(재생 002)")
    void readsALeadingParenthesizedNameAsTheSpeakerMark() {
        List<NumberedLine> lines = NumberedLine.of("""
                제혁  다음에 봐.
                (NA.) 메모리어의 인기에도 나는 갖고 싶지 않았다.
                (웃으며) 다들 그렇지.""");
        Map<Integer, Row> rows = Map.of(1, new Row(1, Kind.DIALOGUE, "제혁", "제혁  "), 2, new Row(2, Kind.DIRECTION, "", ""),
                3, new Row(3, Kind.DIRECTION, "", ""));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("제혁", "NA"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);

        assertThat(questions.get(2).reasons()).contains("talk", "mark");
        assertThat(questions.get(3).reasons()).contains("talk").doesNotContain("mark");
        assertThat(LineReview.apply(questions.get(2), talk(0.5), settings)).isEqualTo(new Row(2, Kind.DIALOGUE, "NA", "(NA.) "));
        assertThat(LineReview.apply(questions.get(2), talk(0.3), settings)).isNull();
        assertThat(LineReview.apply(questions.get(3), talk(0.5), settings)).isNull(); // 화자 표시가 없으면 말 문턱 0.7
    }

    @Test
    void offersTheBlockParticipantsForATogetherMarkWithoutACount() {
        List<NumberedLine> lines = NumberedLine.of("""
                S#1. 무대
                (연수) 첫 소절
                (지해) 둘째 소절
                이어지는 가사
                (같이) 마지막 소절
                (함께 걸으며) 가자""");
        Map<Integer, Row> rows = Map.of(1, new Row(1, Kind.SCENE, "", ""), 2, new Row(2, Kind.DIALOGUE, "연수", "(연수)"),
                3, new Row(3, Kind.DIALOGUE, "지해", "(지해)"), 4, new Row(4, Kind.DIALOGUE, "지해", ""), 5, new Row(5, Kind.DIALOGUE, "연수", ""),
                6, new Row(6, Kind.DIALOGUE, "지해", ""));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("연수", "지해", "이암"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);
        LineReview.Question together = questions.get(5);

        assertThat(together.speakers()).extracting(LineReview.Choice::label).contains("연수, 지해");
        assertThat(together.state()).contains("「(같이)」 표지", "위로 이어진 대사 블록에서 머리로 밝힌 배역: 연수, 지해.");
        assertThat(LineReview.apply(together, decision("dialogue", 1.0, value(together, "연수, 지해"), 0.95), settings))
                .isEqualTo(new Row(5, Kind.DIALOGUE, "연수, 지해", ""));
        assertThat(LineReview.apply(together, decision("dialogue", 1.0, value(together, "연수, 지해"), 0.86), settings)).isNull();
        // 함께 하는 행동은 표지가 아니다
        assertThat(questions.get(6).speakers()).extracting(LineReview.Choice::label).noneMatch(label -> label.contains(","));
    }

    @Test
    void offersAnUnlistedSourceHeadAndKeepsItAsTheHeaderWhenChosen() {
        List<NumberedLine> lines = NumberedLine.of("""
                S#8. 어둠 속
                귓가에 여주의 목소리가 들려온다.
                여주VO (나지막하게) 함께하자.
                한여름 (웃으며) 좋아.""");
        Map<Integer, Row> rows = Map.of(1, new Row(1, Kind.SCENE, "", ""), 2, new Row(2, Kind.DIRECTION, "", ""),
                3, new Row(3, Kind.DIALOGUE, "한여름", ""), 4, new Row(4, Kind.DIALOGUE, "한여름", "한여름 "));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("한여름", "남주"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);
        LineReview.Question voice = questions.get(3);

        assertThat(voice.speakers()).extracting(LineReview.Choice::label).contains("여주VO");
        assertThat(voice.state()).contains("줄 맨 앞 「여주VO」은 원문이 이 줄에 적은 화자 표기일 수 있습니다.");
        assertThat(LineReview.apply(voice, decision("dialogue", 1.0, value(voice, "여주VO"), 0.96), settings))
                .isEqualTo(new Row(3, Kind.DIALOGUE, "여주VO", "여주VO "));
        assertThat(LineReview.apply(voice, decision("dialogue", 1.0, value(voice, "여주VO"), 0.8), settings)).isNull();
        assertThat(questions.get(4).speakers()).extracting(LineReview.Choice::label).doesNotContain("한여름 ");
        assertThat(questions.get(4).own()).isNull();
    }

    private static String value(LineReview.Question question, String label) {
        return question.speakers().stream().filter(c -> c.label().equals(label)).findFirst().orElseThrow().value();
    }

    private static LineReview.Decision talk(double confidence) {
        return with(decision("direction", 0.9, "none", 1.0), LineReview.TALK_QUESTION, "speech", confidence);
    }

    private static LineReview.Decision with(LineReview.Decision decision, String key, String choice, double confidence) {
        return new LineReview.Decision(decision.kind(), decision.speaker(), Map.of(key, new LineReview.Answer(choice, confidence)));
    }

    private static LineReview.Decision edge(String choice, double confidence) {
        return new LineReview.Decision(new LineReview.Answer("dialogue", 1.0), new LineReview.Answer("none", 1.0),
                Map.of(LineReview.EDGE_QUESTION, new LineReview.Answer(choice, confidence)));
    }

    @Test
    @DisplayName("SOMA-663 M4: 머리 없는 함께 말하기 줄은 위 머리의 한 사람으로 바꿀 수 있고, 바꾼 화자는 옛 화자의 이름 머리를 잇지 않는다")
    void unlocksHeadlessGroupLinesAndDropsTheOldSpeakersHeader() {
        List<NumberedLine> lines = NumberedLine.of("""
                여자  안녕하세요.
                모두  안녕하세요.
                마틴  salaam alaikum.
                살람 알레이쿰.
                아비게일  윌리엄즈가…… (말을 끊는다)
                백지안: 세아야.""");
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "여자", "여자  "),
                2, new Row(2, Kind.DIALOGUE, "모두", "모두  "),
                3, new Row(3, Kind.DIALOGUE, "마틴", "마틴  "),
                4, new Row(4, Kind.DIALOGUE, "모두", ""),
                5, new Row(5, Kind.DIALOGUE, "아비게일", "아비게일  "),
                6, new Row(6, Kind.DIALOGUE, "백지안", "백지안: "));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("여자", "마틴", "아비게일", "엘리자베스", "지안", "백지안"), LineReview.Mode.ALL)
                .forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = ScriptSplitRules.REVIEW;

        LineReview.Question group = questions.get(4);
        assertThat(group.head()).isEqualTo("마틴");
        assertThat(LineReview.apply(group, decision("dialogue", 1.0, value(group, "마틴"), 0.85), settings))
                .isEqualTo(new Row(4, Kind.DIALOGUE, "마틴", ""));
        assertThat(LineReview.apply(group, decision("dialogue", 1.0, value(group, "여자"), 0.95), settings))
                .as("위 머리가 아닌 한 사람으로 줄이는 답은 받지 않는다").isNull();
        assertThat(LineReview.apply(questions.get(2), decision("dialogue", 1.0, value(questions.get(2), "마틴"), 0.95), settings))
                .as("머리가 있는 함께 말하기 줄은 그대로").isNull();
        LineReview.Question named = questions.get(5);
        assertThat(LineReview.apply(named, decision("dialogue", 1.0, value(named, "엘리자베스"), 0.98), settings))
                .isEqualTo(new Row(5, Kind.DIALOGUE, "엘리자베스", ""));
        LineReview.Question shortened = questions.get(6);
        assertThat(LineReview.apply(shortened, decision("dialogue", 1.0, value(shortened, "지안"), 0.98), settings))
                .as("줄인 이름으로 바꾸면 머리는 그 사람의 것이다").isEqualTo(new Row(6, Kind.DIALOGUE, "지안", "백지안: "));
    }

    @Test
    @DisplayName("SOMA-663 M4: 위 화자 머리 줄이 줄 너비에서 끊긴 바로 앞 줄이면 그 사실을 문맥 근거로 보내고 대사로 바꾸기 문턱으로 그 머리 화자를 받는다")
    void continuesASentenceCutAtTheLineWidth() {
        List<NumberedLine> lines = NumberedLine.of("""
                의뢰인 냄새도 못 맞는 조향사가 뭘 알아! 난 그런 적 없어요.
                푸크시아 작년 연구소에서 불이 나서 아수라장이 되었는데 저 사람은
                나한테 와서 사람 마음을 조작하는 향을 의뢰했어요.
                목신 푸크시아에게 부탁한 적 없다고 했잖아요?
                의뢰인 노래를 불러요
                라라라 랄라 라라라""");
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "의뢰인", "의뢰인 "),
                2, new Row(2, Kind.DIALOGUE, "푸크시아", "푸크시아 "),
                3, new Row(3, Kind.DIALOGUE, "의뢰인", ""),
                4, new Row(4, Kind.DIALOGUE, "목신", "목신 "),
                5, new Row(5, Kind.DIALOGUE, "의뢰인", "의뢰인 "),
                6, new Row(6, Kind.DIALOGUE, "목신", ""));
        Map<Integer, LineReview.Question> questions = new java.util.HashMap<>();
        LineReview.questions(lines, rows, Set.of(), List.of("의뢰인", "푸크시아", "목신"), LineReview.Mode.ALL).forEach(q -> questions.put(q.no(), q));
        LineReview.Settings settings = ScriptSplitRules.REVIEW;

        LineReview.Question cut = questions.get(3);
        assertThat(cut.reasons()).contains("unfinished");
        assertThat(cut.state()).contains("문서의 줄 너비만큼 차서 문장 끝 부호 없이 끊겼습니다(「…이 되었는데 저 사람은」)");
        assertThat(LineReview.apply(cut, decision("dialogue", 1.0, value(cut, "푸크시아"), 0.6), settings))
                .isEqualTo(new Row(3, Kind.DIALOGUE, "푸크시아", ""));
        LineReview.Question lyric = questions.get(6);
        assertThat(lyric.reasons()).as("짧은 가사 줄은 줄 너비에서 끊긴 줄이 아니다").doesNotContain("unfinished");
        assertThat(LineReview.apply(lyric, decision("dialogue", 1.0, value(lyric, "의뢰인"), 0.6), settings)).isNull();
    }

    @Test
    @DisplayName("SOMA-663 M8 N7: 줄 너비에서 끊긴 한 말의 다음 조각은 앞 조각을 바꾼 Jev 화자를 다시 고르면 종류 문턱으로 바꾼다")
    void carriesJevSpeakerAcrossCutLines() {
        List<NumberedLine> lines = NumberedLine.of("""
                남자 너는 대대로 가난한 집안 출신이지? 조상 중에는 꼭
                주고 그러지? 갈릴레이 대본도 그때 준 거지? 진실을 얘기해 진실을
                모르면 진실을 만들어내!
                주혁 아니에요.""");
        List<LineReview.Choice> speakers = List.of(new LineReview.Choice("c01", "남자", ""), new LineReview.Choice("c02", "주혁", ""),
                new LineReview.Choice("none", "없음", ""));
        Row cut = new Row(2, Kind.DIALOGUE, "주혁", "");
        Row last = new Row(3, Kind.DIALOGUE, "주혁", "");
        List<LineReview.Question> questions = List.of(
                new LineReview.Question(2, Set.of("nohead"), "", speakers, cut, List.of(), null, "남자", Set.of()),
                new LineReview.Question(3, Set.of("nohead"), "", speakers, last, List.of(), null, "남자", Set.of()));
        Map<Integer, Row> changed = Map.of(2, new Row(2, Kind.DIALOGUE, "남자", ""));
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);
        List<String> characters = List.of("남자", "주혁");

        assertThat(LineReview.neighbors(lines, questions, Map.of(3, decision("dialogue", 0.98, "c01", 0.79)), changed, characters, settings))
                .containsOnly(Map.entry(3, new Row(3, Kind.DIALOGUE, "남자", "")));
        // Jev 가 다른 화자·none 을 고르거나 문턱 아래면, 앞 조각이 바뀌지 않았으면 그대로 둔다
        assertThat(LineReview.neighbors(lines, questions, Map.of(3, decision("dialogue", 0.98, "c02", 0.9)), changed, characters, settings)).isEmpty();
        assertThat(LineReview.neighbors(lines, questions, Map.of(3, decision("dialogue", 0.98, "none", 0.9)), changed, characters, settings)).isEmpty();
        assertThat(LineReview.neighbors(lines, questions, Map.of(3, decision("dialogue", 0.98, "c01", 0.3)), changed, characters, settings)).isEmpty();
        assertThat(LineReview.neighbors(lines, questions, Map.of(3, decision("dialogue", 0.98, "c01", 0.79)), Map.of(), characters, settings)).isEmpty();
        // 앞 조각 말이 끝났으면(줄 너비에서 끊기지 않았으면) 한 말이 아니다
        List<NumberedLine> ended = NumberedLine.of("""
                남자 너는 대대로 가난한 집안 출신이지? 조상 중에는 꼭
                주고 그러지? 갈릴레이 대본도 그때 준 거지? 진실을 얘기해 진실을.
                모르면 진실을 만들어내!
                주혁 아니에요.""");
        assertThat(LineReview.neighbors(ended, questions, Map.of(3, decision("dialogue", 0.98, "c01", 0.79)), changed, characters, settings)).isEmpty();
        // 바뀐 화자가 위쪽 화자 머리가 아니면(괄호 속 청자 등) 잇지 않는다
        List<LineReview.Question> unheaded = List.of(
                new LineReview.Question(2, Set.of("nohead"), "", speakers, cut, List.of(), null, "주혁", Set.of()),
                new LineReview.Question(3, Set.of("nohead"), "", speakers, last, List.of(), null, "주혁", Set.of()));
        assertThat(LineReview.neighbors(lines, unheaded, Map.of(3, decision("dialogue", 0.98, "c01", 0.79)), changed, characters, settings)).isEmpty();
    }

    @Test
    @DisplayName("SOMA-663 M8 N7: 같은 배역의 이름 머리 두 줄 사이의 머리 없는 줄은 Jev 가 고른 다른 배역의 차례다")
    void readsHeadlessTurnBetweenSameSpeakerHeads() {
        List<NumberedLine> lines = NumberedLine.of("에 밀 리 :\t날 보고서도 그런 소릴 하니? 미안해.\n\t무슨.\n에 밀 리 :\t정말은 안 그렇다는 거 알아.\n조 오 지 :\t저기···\n");
        List<LineReview.Choice> speakers = List.of(new LineReview.Choice("c01", "에 밀 리", ""), new LineReview.Choice("c02", "조 오 지", ""),
                new LineReview.Choice("none", "없음", ""));
        List<String> characters = List.of("에 밀 리", "조 오 지");
        LineReview.Settings settings = new LineReview.Settings(LineReview.Mode.ALL, 0.4, 0.75, 0.9, 0.6, 0.7, 0.8, 4);
        LineReview.Question turn = new LineReview.Question(2, Set.of("nohead"), "", speakers, new Row(2, Kind.DIALOGUE, "에 밀 리", ""), List.of(),
                null, null, Set.of());

        assertThat(LineReview.neighbors(lines, List.of(turn), Map.of(2, decision("dialogue", 0.8, "c02", 0.61)), Map.of(), characters, settings))
                .containsOnly(Map.entry(2, new Row(2, Kind.DIALOGUE, "조 오 지", "")));
        // 뒤 줄이 다른 배역의 머리면(이름 일부만 같아도) 앞 배역이 이어 말한 줄일 수 있다
        List<NumberedLine> part = NumberedLine.of("에 밀 리 :\t날 보고서도 그런 소릴 하니? 미안해.\n\t무슨.\n에 밀 :\t저기···\n");
        assertThat(LineReview.neighbors(part, List.of(turn), Map.of(2, decision("dialogue", 0.8, "c02", 0.61)), Map.of(), List.of("에 밀 리", "조 오 지", "에 밀"),
                settings)).isEmpty();
        List<NumberedLine> other = NumberedLine.of("에 밀 리 :\t날 보고서도 그런 소릴 하니? 미안해.\n\t무슨.\n조 오 지 :\t저기···\n");
        assertThat(LineReview.neighbors(other, List.of(turn), Map.of(2, decision("dialogue", 0.8, "c02", 0.61)), Map.of(), characters, settings)).isEmpty();
    }

    private static LineReview.Decision decision(String kind, double kindConfidence, String speaker, double speakerConfidence) {
        return new LineReview.Decision(new LineReview.Answer(kind, kindConfidence), new LineReview.Answer(speaker, speakerConfidence));
    }
}
