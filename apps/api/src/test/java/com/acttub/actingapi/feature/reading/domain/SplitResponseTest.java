package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SplitResponseTest {

    private static final List<NumberedLine> SENT = List.of(
            new NumberedLine(1, "옥상, 밤"),
            new NumberedLine(3, "(옥상 난간.)"),
            new NumberedLine(5, "윤서: 여기 있을 줄 알았어."),
            new NumberedLine(6, "태오: 어떻게 알았어."),
            new NumberedLine(7, "  LOMOV. 안녕하세요."));

    @Test
    @DisplayName("SOMA-593 7-2 6번: 모르는 줄 번호, 여섯 종류 밖, 번호가 아닌 줄은 버린다")
    void rejectsRowsThatCannotBeTrusted() {
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "1\tt\t\t",
                "3\tx\t\t",
                "5\td\t윤서\t윤서: ",
                "7\td\tLOMOV\tLOMOV. ",
                "9\td\t윤서\t윤서: ",
                "6\tq\t\t",
                "6\t회사원\t\t",
                "abc\td\t윤서\t",
                "설명을 덧붙입니다"), SENT);

        assertThat(parsed.rows()).containsOnlyKeys(1, 3, 5, 7);
        assertThat(parsed.rows().get(5)).isEqualTo(new Row(5, Kind.DIALOGUE, "윤서", "윤서: "));
        assertThat(parsed.rows().get(7)).isEqualTo(new Row(7, Kind.DIALOGUE, "LOMOV", "LOMOV. "));
        assertThat(parsed.rows().get(3)).isEqualTo(new Row(3, Kind.DIRECTION, "", ""));
        assertThat(parsed.rejected()).isEqualTo(5);
        assertThat(parsed.script()).isNull();
    }

    @Test
    @DisplayName("SOMA-663 M8 N4: 머리가 달라 버린 줄의 첫 답 화자를 남기고, 다시 물어 지어낸 새 이름이면 그 화자로 되돌린다")
    void keepsSpeakerLineageOfRefusedRows() {
        List<NumberedLine> lines = List.of(
                new NumberedLine(1, "얀, 너한테 화가 난 거야!"),
                new NumberedLine(2, "생각은 그래."),
                new NumberedLine(4, "아무리 귀족이라도 이딴 짓을 해?"),
                new NumberedLine(6, "그래, 이건 죽어도 못 잊어. 얀은 몰라."));
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "1\td\t마샤?\t윤서, 너한테 화가 난 거야!",
                "2\td\t마샤\t",
                "4\td\t마샤?\t",
                "6\td\t마샤\t"), lines);
        assertThat(parsed.rows()).doesNotContainKey(1);
        assertThat(parsed.refused()).containsOnly(Map.entry(1, new Row(1, Kind.DIALOGUE, "마샤?", "")));

        Map<Integer, Row> asked = new HashMap<>(parsed.rows());
        asked.put(1, new Row(1, Kind.DIALOGUE, "브릭", ""));
        SplitResponse.lineage(lines, asked, parsed.refused());
        assertThat(asked.get(1)).isEqualTo(new Row(1, Kind.DIALOGUE, "마샤?", ""));

        // 원문에 있는 이름(「얀」)이나 다른 줄도 쓰는 이름(「마샤」)으로 다시 답했으면 그 답을 둔다
        Map<Integer, Row> grounded = new HashMap<>(parsed.rows());
        grounded.put(1, new Row(1, Kind.DIALOGUE, "얀", ""));
        SplitResponse.lineage(lines, grounded, parsed.refused());
        assertThat(grounded.get(1).speaker()).isEqualTo("얀");
        Map<Integer, Row> shared = new HashMap<>(parsed.rows());
        shared.put(1, new Row(1, Kind.DIALOGUE, "마샤", ""));
        SplitResponse.lineage(lines, shared, parsed.refused());
        assertThat(shared.get(1).speaker()).isEqualTo("마샤");
        // 첫 답의 화자를 다른 줄이 쓰지 않으면 계보 근거가 없다
        Map<Integer, Row> alone = new HashMap<>(Map.of(1, new Row(1, Kind.DIALOGUE, "브릭", ""), 2, new Row(2, Kind.DIALOGUE, "마샤", "")));
        SplitResponse.lineage(lines, alone, parsed.refused());
        assertThat(alone.get(1).speaker()).isEqualTo("브릭");
    }

    @Test
    @DisplayName("SOMA-663 M8 N5: 이름 없는 대사로 다시 나눈 답의 「화자」는 먼저 원문 머리로 이름을 밝힌 한 사람이다")
    void joinsMonologueToTheOnlyNamedSpeaker() {
        Map<Integer, Row> rows = new HashMap<>(Map.of(
                1, new Row(1, Kind.DIALOGUE, "초대수장", "초대수장: "),
                3, new Row(3, Kind.DIALOGUE, "화자", ""),
                5, new Row(5, Kind.DIALOGUE, "화자", "")));
        SplitResponse.monologue(rows);
        assertThat(rows.values()).extracting(Row::speaker).containsOnly("초대수장");

        // 이름 둘, 주고받는 「화자1」·「화자2」, 장면이 바뀌는 답, 「화자」가 먼저 말하는 답, 머리 없는 이름은 그대로 둔다
        List<Map<Integer, Row>> kept = List.of(
                Map.of(1, new Row(1, Kind.DIALOGUE, "초대수장", "초대수장: "), 2, new Row(2, Kind.DIALOGUE, "부관", "부관: "),
                        3, new Row(3, Kind.DIALOGUE, "화자", "")),
                Map.of(1, new Row(1, Kind.DIALOGUE, "초대수장", "초대수장: "), 3, new Row(3, Kind.DIALOGUE, "화자1", "")),
                Map.of(1, new Row(1, Kind.DIALOGUE, "초대수장", "초대수장: "), 2, new Row(2, Kind.SCENE, "", ""),
                        3, new Row(3, Kind.DIALOGUE, "화자", "")),
                Map.of(1, new Row(1, Kind.DIALOGUE, "화자", ""), 3, new Row(3, Kind.DIALOGUE, "초대수장", "초대수장: ")),
                Map.of(1, new Row(1, Kind.DIALOGUE, "초대수장", ""), 3, new Row(3, Kind.DIALOGUE, "화자", "")));
        for (Map<Integer, Row> answer : kept) {
            Map<Integer, Row> copy = new HashMap<>(answer);
            SplitResponse.monologue(copy);
            assertThat(copy).isEqualTo(answer);
        }
    }

    @Test
    @DisplayName("SOMA-663 M8 부분 D: 줄 전체를 배역 칸에 쓴 문장은 이름이 아니다 — 배역 이름으로 시작하면 그 배역, 아니면 앞 대사에 잇는다")
    void readsWholeSentenceSpeakerAsDialogue() {
        List<NumberedLine> lines = List.of(new NumberedLine(1, "김순경: 여기 쓰세요."), new NumberedLine(2, "누가 대신 써넣었는지도 모르고요."),
                new NumberedLine(3, "우리 가족이 나중에 알게 된 건"), new NumberedLine(4, "리틀이네즈 유명세 있는 사람은 전부 저래요?"),
                new NumberedLine(5, "리틀이네즈  그래."), new NumberedLine(6, "LOMOV."), new NumberedLine(7, "여자 방송기자 (소리)"),
                new NumberedLine(8, "다같이 : 온새미로 파이팅!"));
        Map<Integer, Row> rows = new HashMap<>(Map.of(
                1, new Row(1, Kind.DIALOGUE, "김순경", "김순경: "),
                2, new Row(2, Kind.DIALOGUE, "누가 대신 써넣었는지도 모르고요.", "누가 대신 써넣었는지도 모르고요."),
                3, new Row(3, Kind.DIALOGUE, "", ""),
                4, new Row(4, Kind.DIALOGUE, "리틀이네즈 유명세 있는 사람은 전부 저래요?", ""),
                5, new Row(5, Kind.DIALOGUE, "리틀이네즈", "리틀이네즈  "),
                6, new Row(6, Kind.DIALOGUE, "LOMOV.", "LOMOV."),
                7, new Row(7, Kind.DIALOGUE, "여자 방송기자 (소리)", "여자 방송기자 (소리)"),
                8, new Row(8, Kind.DIALOGUE, "다같이 : 온새미로 파이팅!", "")));
        SplitResponse.fillSpeakers(lines, rows);

        assertThat(rows.get(2)).isEqualTo(new Row(2, Kind.DIALOGUE, "김순경", ""));
        assertThat(rows.get(3).speaker()).isEqualTo("김순경");
        assertThat(rows.get(4)).isEqualTo(new Row(4, Kind.DIALOGUE, "리틀이네즈", "리틀이네즈 "));
        assertThat(rows.get(8)).isEqualTo(new Row(8, Kind.DIALOGUE, "다같이", "다같이 : "));
        // 한 낱말 이름 줄과 문장 끝 부호가 없는 이름 줄은 그대로다
        assertThat(rows.get(6).speaker()).isEqualTo("LOMOV.");
        assertThat(rows.get(7).speaker()).isEqualTo("여자 방송기자 (소리)");
    }

    @Test
    @DisplayName("SOMA-663: 종류 칸의 「대사」·「D」·「d=윤서」 꼴은 그 종류로 읽고, 이름은 배역 칸이 비었을 때 배역이다")
    void readsCommonKindSpellings() {
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "1\t장면 머리\t\t",
                "3\t지문\t\t",
                "5\t대사\t윤서\t윤서: ",
                "6\td=태오\t\t태오: ",
                "7\tD\tLOMOV\tLOMOV. "), SENT);

        assertThat(parsed.rows()).containsOnly(
                Map.entry(1, new Row(1, Kind.SCENE, "", "")),
                Map.entry(3, new Row(3, Kind.DIRECTION, "", "")),
                Map.entry(5, new Row(5, Kind.DIALOGUE, "윤서", "윤서: ")),
                Map.entry(6, new Row(6, Kind.DIALOGUE, "태오", "태오: ")),
                Map.entry(7, new Row(7, Kind.DIALOGUE, "LOMOV", "LOMOV. ")));
        assertThat(parsed.rejected()).isZero();
    }

    @Test
    @DisplayName("SOMA-663: 머리가 줄 시작과 다르면 버리고, 공백만 다르면 원문 글자로 맞추고, 대사 글을 옮겨 쓴 머리는 머리만, 배역 칸의 종류 이름은 배역만 버린다")
    void keepsRowsWhoseHeaderDoesNotFit() {
        List<NumberedLine> sent = List.of(
                new NumberedLine(1, "윤서: 여기 있을 줄 알았어."),
                new NumberedLine(2, "딱딱이\t: 국가유산미래복원사업."),
                new NumberedLine(3, "그래서 우리가 여름마다 여기 오는 거고."),
                new NumberedLine(4, "여자 방송기자 (소리)"),
                new NumberedLine(5, "(사이)"),
                new NumberedLine(6, "[주인]"),
                new NumberedLine(7, "그냥 갔어."));
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "1\td\t윤서\t태오: ",
                "2\td\t딱딱이\t딱딱이 : ",
                "3\td\t태오\t그래서 우리가 여름마다 여기 오는 거고.",
                "4\td\t여자 방송기자\t여자 방송기자 (소리)",
                "5\tx\t\t5",
                "6\td\t주인\t[주인] ",
                "7\td\t대사\t"), sent);

        assertThat(parsed.rows()).containsOnly(
                Map.entry(2, new Row(2, Kind.DIALOGUE, "딱딱이", "딱딱이\t:")),
                Map.entry(3, new Row(3, Kind.DIALOGUE, "태오", "")),
                Map.entry(4, new Row(4, Kind.DIALOGUE, "여자 방송기자", "여자 방송기자 (소리)")),
                Map.entry(6, new Row(6, Kind.DIALOGUE, "주인", "[주인]")),
                Map.entry(7, new Row(7, Kind.DIALOGUE, "", "")));
        assertThat(parsed.rejected()).isEqualTo(2);
    }

    @Test
    @DisplayName("SOMA-663: 배역 빈 대사는 「윤서: 」·「[로스] 」 머리의 이름을 배역으로 쓰고, 아니면 머리를 버리고 배역을 비운 채 받는다")
    void speakerlessDialogueWaitsForFilling() {
        SplitResponse parsed = SplitResponse.parse("5\td\t\t윤서: \n6\td\t\t\n7\td\t\t[로스] \n8\td\t\t그리고 ", List.of(
                new NumberedLine(5, "윤서: 여기 있을 줄 알았어."), new NumberedLine(6, "어떻게 알았어."), new NumberedLine(7, "[로스] 응."),
                new NumberedLine(8, "그리고 갔어.")));

        assertThat(parsed.rows()).containsOnly(
                Map.entry(5, new Row(5, Kind.DIALOGUE, "윤서", "윤서: ")),
                Map.entry(6, new Row(6, Kind.DIALOGUE, "", "")),
                Map.entry(7, new Row(7, Kind.DIALOGUE, "로스", "[로스] ")),
                Map.entry(8, new Row(8, Kind.DIALOGUE, "", "")));
    }

    @Test
    @DisplayName("SOMA-663: 배역 빈 대사는 줄 앞의 아는 이름, 아니면 무시 줄만 건너 바로 앞 대사나 이름 줄의 배역으로 채우고, 못 채우면 뺀다")
    void fillsSpeakerlessDialogueFromTheLineBefore() {
        List<NumberedLine> lines = List.of(
                new NumberedLine(1, "윤서"),
                new NumberedLine(2, "여기 있을 줄"),
                new NumberedLine(3, "알았어."),
                new NumberedLine(5, "태오: 어떻게 알았어."),
                new NumberedLine(6, "(사이)"),
                new NumberedLine(7, "그냥."),
                new NumberedLine(8, "- 3 -"),
                new NumberedLine(9, "알았지."),
                new NumberedLine(10, "나  간다."),
                new NumberedLine(11, "태오  간다."),
                new NumberedLine(12, "나 갈래."),
                new NumberedLine(13, "태오: 같이 가."),
                new NumberedLine(14, "나\t응."),
                new NumberedLine(15, "(퇴장)"),
                new NumberedLine(16, "윤서"),
                new NumberedLine(17, "잘 가."));
        Map<Integer, Row> rows = new HashMap<>();
        for (Row row : List.of(
                new Row(1, Kind.IGNORE, "", ""),
                new Row(2, Kind.DIALOGUE, "윤서", ""),
                new Row(3, Kind.DIALOGUE, "", ""),
                new Row(5, Kind.DIALOGUE, "", ""),
                new Row(6, Kind.DIRECTION, "", ""),
                new Row(7, Kind.DIALOGUE, "", ""),
                new Row(8, Kind.IGNORE, "", ""),
                new Row(9, Kind.DIALOGUE, "", ""),
                new Row(10, Kind.DIALOGUE, "", ""),
                new Row(11, Kind.DIALOGUE, "", ""),
                new Row(12, Kind.DIALOGUE, "", ""),
                new Row(13, Kind.DIALOGUE, "태오", "태오: "),
                new Row(14, Kind.DIALOGUE, "", ""),
                new Row(15, Kind.DIRECTION, "", ""),
                new Row(16, Kind.IGNORE, "", ""),
                new Row(17, Kind.DIALOGUE, "", ""),
                new Row(20, Kind.DIALOGUE, "나", ""))) {
            rows.put(row.no(), row);
        }

        SplitResponse.fillSpeakers(lines, rows);

        assertThat(rows.get(3).speaker()).isEqualTo("윤서");
        assertThat(rows.get(5).speaker()).isEqualTo("태오");
        assertThat(rows).doesNotContainKeys(7, 9);
        assertThat(rows.get(10).speaker()).isEqualTo("나");
        assertThat(rows.get(11).speaker()).isEqualTo("태오");
        assertThat(rows.get(14).speaker()).isEqualTo("나");
        assertThat(rows.get(12).speaker()).as("이름 뒤 공백 한 칸은 머리로 보지 않고 앞 대사에 잇는다").isEqualTo("태오");
        assertThat(rows.get(17).speaker()).as("블록 형식의 이름 줄").isEqualTo("윤서");
    }

    @Test
    @DisplayName("SOMA-663 M3: 원문에 없는 화자 이름은 줄 머리·줄을 시작하는 배역·위 이름 줄 순으로 원문 이름으로 바꾸고, 이어지는 줄은 같은 이름의 근거를 따른다")
    void groundsSpeakersMissingFromTheSource() {
        List<NumberedLine> lines = NumberedLine.of("""
                칼리아예프 나를 모욕했어.
                [삼십팔] 혹시 짐승이 훔친게 아냐?
                학생 3
                아, 미안. 친구가 온대.
                칼리아예프 그렇지.
                정말이야.
                JIM/SAND 헤에이!
                JIMMY 잘 지내?
                [운전자기 (목소리) 저기요!""");
        Map<Integer, Row> rows = new HashMap<>(Map.of(1, new Row(1, Kind.DIALOGUE, "칼리아예프", "칼리아예프 "),
                2, new Row(2, Kind.DIALOGUE, "죄인 삼십팔 번", "[삼십팔] "), 3, new Row(3, Kind.IGNORE, "", ""),
                4, new Row(4, Kind.DIALOGUE, "student 3", ""), 5, new Row(5, Kind.DIALOGUE, "이반 Калияев", ""),
                6, new Row(6, Kind.DIALOGUE, "이반 Калияев", ""), 7, new Row(7, Kind.DIALOGUE, "JIMMY/SAND", "JIM/SAND "),
                8, new Row(8, Kind.DIALOGUE, "JIMMY", "JIMMY "), 9, new Row(9, Kind.DIALOGUE, "운전자 1", "")));

        SplitResponse.ground(lines, rows);

        assertThat(rows.get(2).speaker()).isEqualTo("삼십팔");
        assertThat(rows.get(4).speaker()).isEqualTo("학생 3");
        assertThat(rows.get(5).speaker()).isEqualTo("칼리아예프");
        assertThat(rows.get(6).speaker()).as("근거 없는 이어지는 줄").isEqualTo("칼리아예프");
        assertThat(rows.get(7).speaker()).as("함께 말하는 화자는 이름마다 본다 — SAND 는 SANDRINE 이 아니어도 원문 글자다").isEqualTo("JIMMY/SAND");
        assertThat(rows.get(8).speaker()).isEqualTo("JIMMY");
        assertThat(rows.get(9).speaker()).as("근거가 없으면 그대로 — 조립이 원문 머리로 바로잡는다").isEqualTo("운전자 1");
    }

    @Test
    @DisplayName("SOMA-593 7-14: 첫 줄 「대본<TAB>아니오」면 대본이 아니고, 「예」나 판단 줄 없음은 대본이다")
    void readsTheJudgmentLine() {
        assertThat(SplitResponse.parse("대본\t아니오\n", SENT).notScript()).isTrue();
        SplitResponse yes = SplitResponse.parse("대본\t예\n5\td\t윤서\t윤서: ", SENT);
        assertThat(yes.script()).isTrue();
        assertThat(yes.rows()).containsOnlyKeys(5);
        assertThat(SplitResponse.parse("5\td\t윤서\t윤서: ", SENT).notScript()).isFalse();
        assertThat(SplitResponse.parse("대본\t글쎄\n5\td\t윤서\t윤서: ", SENT).script()).isNull();
    }

    @Test
    @DisplayName("SOMA-663 M1: 칸 구분을 「<TAB>」·「\\t」 글자로 쓴 답도 줄 판정·판단 줄로 읽는다")
    void readsSpelledOutTabs() {
        assertThat(SplitResponse.parse("대본<TAB>아니오\n", SENT).notScript()).as("2026-10-21 058").isTrue();
        SplitResponse spelled = SplitResponse.parse("대본<TAB>예\n5<TAB>d<TAB>윤서<TAB>윤서: \n6\\td\\t태오\\t태오: ", SENT);
        assertThat(spelled.script()).isTrue();
        assertThat(spelled.rows().get(5)).isEqualTo(new Row(5, Kind.DIALOGUE, "윤서", "윤서: "));
        assertThat(spelled.rows().get(6)).as("2026-10-21 027").isEqualTo(new Row(6, Kind.DIALOGUE, "태오", "태오: "));
    }

    @Test
    @DisplayName("SOMA-663 M1: 배역 칸 끝의 쌍점은 이름이 아니다")
    void speakerDropsATrailingColon() {
        assertThat(SplitResponse.parse("5\td\t윤서 :\t", SENT).rows().get(5).speaker()).isEqualTo("윤서");
    }

    @Test
    @DisplayName("SOMA-663 M1: 원문 머리 안의 탭 때문에 머리가 뒤 칸으로 넘친 답은 뒤 칸을 이어 원문 머리로 읽는다")
    void headerWithATabSpansTheTrailingFields() {
        List<NumberedLine> sent = List.of(new NumberedLine(1, "모\t두\t아멘"), new NumberedLine(2, "윤서: 응."));
        SplitResponse parsed = SplitResponse.parse("1\td\t모두\t모\t두\t\n2\td\t윤서\t윤서: \tf", sent);
        assertThat(parsed.rows().get(1).header()).isEqualTo("모\t두\t");
        assertThat(parsed.rows().get(2).header()).as("원문과 안 맞는 뒤 칸은 버린다").isEqualTo("윤서: ");
    }

    @Test
    @DisplayName("SOMA-663 M1: 번호 줄도 판단 줄도 없는 답은 형식 실패다 — 판단 줄만 쓴 답, 문맥 줄에만 답한 답은 형식 실패가 아니다")
    void answersWithoutNumberedLinesAreUnformatted() {
        assertThat(SplitResponse.unformatted("동기화가 실패했습니다. 저장소 권한을 확인해 주세요.")).isTrue();
        assertThat(SplitResponse.unformatted("대본\t글쎄요\n설명입니다.")).isTrue();
        assertThat(SplitResponse.unformatted("대본\t예\n")).isFalse();
        assertThat(SplitResponse.unformatted("대본\t아니오\n")).isFalse();
        assertThat(SplitResponse.unformatted("대본<TAB>아니오")).isFalse();
        assertThat(SplitResponse.unformatted("5\td\t윤서\t윤서: ")).isFalse();
        assertThat(SplitResponse.unformatted("~4\tx\t\t\n")).isFalse();
        assertThat(SplitResponse.unformatted("5<TAB>d<TAB>윤서<TAB>")).isFalse();
    }

    @Test
    @DisplayName("줄 앞 U+200B 를 모델이 떨어뜨리고 머리를 써도 그 줄을 버리지 않는다")
    void headerComparisonIgnoresInvisibleCharacters() {
        List<NumberedLine> sent = List.of(new NumberedLine(1, "\u200B윤서: 여기 있을 줄 알았어."));
        assertThat(SplitResponse.parse("1\td\t윤서\t윤서: ", sent).rows()).containsKey(1);
        assertThat(SplitResponse.parse("1\td\t윤서\t\u200B윤서: ", sent).rows()).containsKey(1);
        assertThat(SplitResponse.parse("1\td\t윤서\t태오: ", sent).rows()).isEmpty();
    }

    @Test
    void rosterStripsBulletsAndTheJudgmentLine() {
        assertThat(SplitResponse.roster("대본\t예\n- 윤서\n2. 태오\n* 로스\n윤서\n\n")).containsExactly("윤서", "태오", "로스");
    }

    @Test
    @DisplayName("SOMA-670: 짧은 대본의 답 끝 「배역」 블록에서 배역마다 성별·나이대를 읽고, 줄 판정은 그대로다")
    void readsTheTrailingCastBlock() {
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "대본\t예",
                "5\td\t윤서\t윤서: ",
                "6\td\t태오\t태오: ",
                "배역",
                "윤서\tf\tyoung",
                "태오\tM\tAdult",
                ""), SENT);

        assertThat(parsed.script()).isTrue();
        assertThat(parsed.rows()).containsOnlyKeys(5, 6);
        assertThat(parsed.rejected()).isZero();
        assertThat(parsed.traits()).containsOnly(
                Map.entry("윤서", new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG)),
                Map.entry("태오", new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.ADULT)));
    }

    @Test
    @DisplayName("SOMA-670: 「배역」 블록이 없으면 성별·나이대는 비고, 블록 뒤에 온 줄 판정도 받는다")
    void castBlockIsOptionalAndDoesNotSwallowRows() {
        SplitResponse without = SplitResponse.parse("5\td\t윤서\t윤서: \n6\td\t태오\t태오: ", SENT);
        assertThat(without.traits()).isEmpty();
        assertThat(without.rows()).containsOnlyKeys(5, 6);

        SplitResponse late = SplitResponse.parse("5\td\t윤서\t윤서: \n배역\n윤서\tf\tadult\n6\td\t태오\t태오: ", SENT);
        assertThat(late.rows()).containsOnlyKeys(5, 6);
        assertThat(late.traits()).containsOnlyKeys("윤서");
    }

    @Test
    @DisplayName("SOMA-670: 성별 m·f, 나이대 child·young·adult·senior 밖의 값은 모름(null)이다")
    void garbledTraitsAreUnknown() {
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "5\td\t윤서\t윤서: ",
                "배역",
                "윤서\t여자?\t30대",
                "태오",
                "- 로스\tx\tchild",
                "\tf\tadult"), SENT);

        assertThat(parsed.traits()).containsOnly(
                Map.entry("윤서", CharacterTraits.UNKNOWN),
                Map.entry("태오", CharacterTraits.UNKNOWN),
                Map.entry("로스", new CharacterTraits(null, CharacterAgeBand.CHILD)));
    }

    @Test
    @DisplayName("SOMA-670: 배역 목록 답은 「이름<TAB>성별<TAB>나이대」 — 이름만 쓴 줄도 받는다")
    void rosterReadsNameGenderAndAge() {
        String answer = "대본\t예\n- 윤서\tf\tyoung\n2. 태오\tm\t\n로스\n배역\n";
        assertThat(SplitResponse.roster(answer)).containsExactly("윤서", "태오", "로스");
        assertThat(SplitResponse.rosterTraits(answer)).containsOnly(
                Map.entry("윤서", new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG)),
                Map.entry("태오", new CharacterTraits(CharacterGender.MALE, null)),
                Map.entry("로스", CharacterTraits.UNKNOWN));
        assertThat(SplitResponse.roster("대본<TAB>예\n윤서<TAB>f<TAB>young\n")).as("「<TAB>」을 글자 그대로 쓴 답(2026-10-20 053)")
                .containsExactly("윤서");
    }

    @Test
    @DisplayName("SOMA-663 M4: 줄 안 괄호 행동 뒤에 적힌 배역 이름표를 머리로 답한 줄은 화자만 받고, 괄호 없이 줄 가운데를 가리킨 머리는 버린다")
    void keepsSpeakersNamedAfterAnInlineAction() {
        List<NumberedLine> sent = List.of(
                new NumberedLine(1, "(어머니, 갑자기 소리 지른다) 딸 그만해, 어머니!"),
                new NumberedLine(2, "뿌리\t\t\t(말은 없지만 자세를 고쳐잡는다) ... 가지\t\t\t한진이요."),
                new NumberedLine(3, "철수가 영희에게 말한다 영희 가자."),
                new NumberedLine(4, "(웃으며) 민수 그래."));
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "1\td\t딸\t딸 ",
                "2\td\t가지\t가지\t\t\t",
                "3\td\t영희\t영희 ",
                "4\td\t철수\t민수 "), sent);

        assertThat(parsed.rows()).containsOnly(
                Map.entry(1, new Row(1, Kind.DIALOGUE, "딸", "")),
                Map.entry(2, new Row(2, Kind.DIALOGUE, "가지", "")));
        assertThat(parsed.rejected()).isEqualTo(2);
    }

    @Test
    @DisplayName("SOMA-709 3번: 원문 머리가 더 긴 배역 이름이면 그 배역으로 고치고, 머리로 쓰인 적 없는 조각·깨진 글자·드문 이름은 다시 묻는다")
    void repairsNameFragmentsAndAsksAgain() {
        List<NumberedLine> lines = NumberedLine.of("""
                젊은 시워드: 아버지!
                젊은 시워드: 제가 가겠습니다.
                젊은 시워드: 칼을 주십시오.
                운명의 여신: 들어라.
                운명의 여신: 때가 왔다.
                그리고 모두 돌아선다.
                દaiана 어디로 가?
                하은: 엄마 뭐 해?
                하은: 나 왔어.
                하은 엄마: 왔니.
                하은 엄마: 밥 먹자.
                하은 엄마: 어서.
                경찰: 멈춰!
                젊은 시워드
                늦지 않았습니다.
                """);
        Map<Integer, Row> rows = new HashMap<>();
        String[] speakers = {"젊은 시워드", "젊은", "젊은 시워드", "운명의", "운명의 여신", "그리고", "દaiана", "하은", "하은", "하은 엄마", "하은 엄마",
                "하은 엄마", "경찰", null, "젊은"};
        for (int i = 0; i < speakers.length; i++) {
            int no = i + 1;
            rows.put(no, speakers[i] == null ? new Row(no, Kind.IGNORE, "", "")
                    : new Row(no, Kind.DIALOGUE, speakers[i], speakers[i].equals("젊은") || speakers[i].equals("운명의") ? speakers[i] + " " : ""));
        }

        Map<Integer, Row> asked = SplitResponse.fragments(lines, rows, List.of());

        assertThat(rows.get(2)).isEqualTo(new Row(2, Kind.DIALOGUE, "젊은 시워드", ""));
        assertThat(rows.get(4)).isEqualTo(new Row(4, Kind.DIALOGUE, "운명의 여신", ""));
        assertThat(rows.get(15)).as("블록 형식의 이름 줄도 근거다").isEqualTo(new Row(15, Kind.DIALOGUE, "젊은 시워드", ""));
        // 「그리고」·깨진 글자 이름은 원문 머리로 쓰인 적이 없어 다시 묻는다. 「하은」은 ~은 으로 끝나도 원문 머리이고, 「경찰」은 한 번 나와도 원문 머리다
        assertThat(asked).containsOnlyKeys(6, 7);
        assertThat(rows).doesNotContainKeys(6, 7);
        assertThat(asked.get(6)).isEqualTo(new Row(6, Kind.DIALOGUE, "그리고", ""));
        assertThat(rows.get(8).speaker()).isEqualTo("하은");
        assertThat(rows.get(13).speaker()).isEqualTo("경찰");
    }

    @Test
    @DisplayName("SOMA-709 4번: 효과음 표기·괄호로만 된 화자는 배역이 아니라 지문이다. 괄호 안이 아는 배역이면 둔다")
    void soundCuesAreDirections() {
        Map<Integer, Row> rows = new HashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "(음 향)", "(음 향) "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "효과음", "효과음: "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "(천둥)", "(천둥) "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "철수", "철수: "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "(철수)", "(철수) "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "(NA)", "(NA) "));
        rows.put(7, new Row(7, Kind.DIALOGUE, "(목소리)", "(목소리) "));

        SplitResponse.sounds(rows);

        assertThat(rows.get(1)).isEqualTo(new Row(1, Kind.DIRECTION, "", ""));
        assertThat(rows.get(2)).isEqualTo(new Row(2, Kind.DIRECTION, "", ""));
        assertThat(rows.get(3)).isEqualTo(new Row(3, Kind.DIRECTION, "", ""));
        assertThat(rows.get(4).kind()).isEqualTo(Kind.DIALOGUE);
        assertThat(rows.get(5).kind()).isEqualTo(Kind.DIALOGUE);
        assertThat(rows.get(6).kind()).as("내레이션 표시").isEqualTo(Kind.DIALOGUE);
        assertThat(rows.get(7).kind()).as("화면 밖 목소리는 들리는 말").isEqualTo(Kind.DIALOGUE);
    }
}
