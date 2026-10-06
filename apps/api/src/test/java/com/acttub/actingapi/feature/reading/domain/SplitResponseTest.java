package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;
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
}
