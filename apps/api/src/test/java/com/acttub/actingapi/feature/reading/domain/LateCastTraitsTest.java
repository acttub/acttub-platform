package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class LateCastTraitsTest {

    private static ScriptDraft mecca() {
        List<String> names = List.of("미스 헬렌", "엘사", "마리우스");
        List<ScriptDraft.Line> lines = new ArrayList<>();
        lines.add(new ScriptDraft.Line(1, "scene", null, "1 막"));
        for (int i = 0; i < 40; i++) {
            lines.add(new ScriptDraft.Line(lines.size() + 1, "dialogue", i % 2, "대사 " + i));
        }
        lines.add(new ScriptDraft.Line(lines.size() + 1, "direction", null, "엘사, 무력감과 패배감에 뒤덮인다."));
        lines.add(new ScriptDraft.Line(lines.size() + 1, "dialogue", 1, "그만하세요."));
        lines.add(new ScriptDraft.Line(lines.size() + 1, "direction", null, "무대 뒤에서 남자 목소리: \"아무도 안 계신가?\" 마리우스, 집안으로 들어선다."));
        lines.add(new ScriptDraft.Line(lines.size() + 1, "dialogue", 2, "미스 헬렌! 난 아무도 없는 줄 알았구먼."));
        lines.add(new ScriptDraft.Line(lines.size() + 1, "dialogue", 0, "마리우스."));
        lines.add(new ScriptDraft.Line(lines.size() + 1, "dialogue", 2, "불도 안 켜고."));
        lines.add(new ScriptDraft.Line(lines.size() + 1, "direction", null, "마리우스, 모자를 벗는다."));
        List<CharacterTraits> traits = List.of(
                new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.SENIOR),
                new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG),
                CharacterTraits.UNKNOWN);
        return new ScriptDraft("메카로 가는 길", "raw", "file", names, lines, traits);
    }

    @Test
    @DisplayName("SOMA-937: 성별을 모르는 배역만 고르고, 처음 말하기 직전 지문·첫 대사와 앞 줄·이름이 든 지문을 원래 순서로 보낸다")
    void picksUnknownAndSendsEntrance() {
        ScriptDraft draft = mecca();

        assertThat(LateCastTraits.unknown(draft)).containsExactly(2);
        String excerpt = LateCastTraits.excerpt(draft, List.of(2));

        assertThat(excerpt.lines().toList()).containsExactly(
                "## 마리우스",
                "42\t[지문] 엘사, 무력감과 패배감에 뒤덮인다.",
                "43\t엘사: 그만하세요.",
                "44\t[지문] 무대 뒤에서 남자 목소리: \"아무도 안 계신가?\" 마리우스, 집안으로 들어선다.",
                "45\t마리우스: 미스 헬렌! 난 아무도 없는 줄 알았구먼.",
                "46\t미스 헬렌: 마리우스.",
                "47\t마리우스: 불도 안 켜고.",
                "48\t[지문] 마리우스, 모자를 벗는다.");
    }

    @Test
    @DisplayName("SOMA-937: 답으로 빈 칸만 채우고 아는 칸·묻지 않은 배역은 그대로 둔다")
    void fillsOnlyBlanks() {
        ScriptDraft draft = mecca();
        Map<String, CharacterTraits> answer = Map.of(
                "마리우스", new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.SENIOR),
                "엘사", new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.ADULT));

        ScriptDraft filled = LateCastTraits.fill(draft, List.of(2), answer);

        assertThat(filled.characterTraits()).containsExactly(
                new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.SENIOR),
                new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG),
                new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.SENIOR));
        assertThat(filled.lines()).isEqualTo(draft.lines());
        assertThat(LateCastTraits.fill(draft, List.of(2), Map.of())).isSameAs(draft);
    }

    @Test
    @DisplayName("SOMA-937: 나이대만 아는 배역은 성별만 채우고 나이대는 지킨다")
    void keepsKnownAgeBand() {
        ScriptDraft base = mecca();
        List<CharacterTraits> traits = new ArrayList<>(base.characterTraits());
        traits.set(2, new CharacterTraits(null, CharacterAgeBand.ADULT));
        ScriptDraft draft = base.withTraits(traits);

        assertThat(LateCastTraits.unknown(draft)).containsExactly(2);
        ScriptDraft filled = LateCastTraits.fill(draft, List.of(2), Map.of("마리우스", new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.SENIOR)));

        assertThat(filled.characterTraits().get(2)).isEqualTo(new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.ADULT));
    }
}
