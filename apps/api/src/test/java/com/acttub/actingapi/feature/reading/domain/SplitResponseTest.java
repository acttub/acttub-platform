package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

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
    @DisplayName("SOMA-593 7-2 6번: 모르는 줄 번호, 여섯 종류 밖, 머리가 줄 시작과 다른 것, 배역 없는 대사는 버린다")
    void rejectsRowsThatCannotBeTrusted() {
        SplitResponse parsed = SplitResponse.parse(String.join("\n",
                "1\tt\t\t",
                "3\tx\t\t",
                "5\td\t윤서\t윤서: ",
                "6\td\t태오\t태호: ",
                "7\td\tLOMOV\tLOMOV. ",
                "9\td\t윤서\t윤서: ",
                "6\tq\t\t",
                "6\td\t\t태오: ",
                "abc\td\t윤서\t",
                "설명을 덧붙입니다"), SENT);

        assertThat(parsed.rows()).containsOnlyKeys(1, 3, 5, 7);
        assertThat(parsed.rows().get(5)).isEqualTo(new Row(5, Kind.DIALOGUE, "윤서", "윤서: "));
        assertThat(parsed.rows().get(7)).isEqualTo(new Row(7, Kind.DIALOGUE, "LOMOV", "LOMOV. "));
        assertThat(parsed.rows().get(3)).isEqualTo(new Row(3, Kind.DIRECTION, "", ""));
        assertThat(parsed.rejected()).isEqualTo(6);
        assertThat(parsed.script()).isNull();
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
    }
}
