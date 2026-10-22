package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.acttub.actingapi.feature.reading.domain.CocreateRules.Conditions;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Experience;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Issue;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 찍을 대사 같이 만들기의 검사 — 2026-10-19 인계본 회귀 테스트(test_server.py)의 검사 항목을 옮겼다. */
class CocreateRulesTest {

    static final String LINE = "가".repeat(25);

    static Conditions conditions(int count, int minutes) {
        return new Conditions(Experience.BEGINNER, "20대 여성", "취미", false, "서운함", "사과", "없음", count, minutes,
                CocreateRules.ENDINGS.getFirst(), CocreateRules.PROPS.getFirst(), CocreateRules.defaultMyLines(minutes, count));
    }

    /** 배역 {@code count} 명, 대사 {@code dialogue} 줄(번갈아), 맨 앞 장면 줄 하나. */
    static CocreatedScript script(int count, int dialogue) {
        List<CocreatedScript.Role> roles = new ArrayList<>();
        String[] names = {"지수", "민호", "서연", "태오"};
        for (int i = 0; i < count; i++) {
            roles.add(new CocreatedScript.Role(names[i], i == 0 ? "f" : "m", "young", i == 0));
        }
        List<CocreatedScript.Line> lines = new ArrayList<>();
        lines.add(new CocreatedScript.Line("scene", null, "옥상, 밤"));
        for (int i = 0; i < dialogue; i++) {
            lines.add(new CocreatedScript.Line("dialogue", names[count == 1 ? 0 : i % count], LINE));
        }
        return new CocreatedScript(CocreatedScript.Design.EMPTY, "잊어버린 생일", "옥상, 밤", roles, lines);
    }

    @Test
    @DisplayName("1분 독백(대사 12줄 300자)과 1분 2인 장면은 문제가 없다")
    void validScripts() {
        assertThat(CocreateRules.check(script(1, 12), conditions(1, 1))).isEmpty();
        assertThat(CocreateRules.check(script(2, 12), conditions(2, 1))).isEmpty();
        assertThat(CocreateRules.check(script(3, 12), conditions(3, 1))).isEmpty();
        assertThat(CocreateRules.check(script(4, 12), conditions(4, 1))).isEmpty();
    }

    @Test
    @DisplayName("배역 수가 고른 수와 다르거나 대사가 없는 배역이 있으면 구조 문제다")
    void castMismatch() {
        assertThat(CocreateRules.check(script(3, 12), conditions(2, 1))).anyMatch(i -> i.why().startsWith("배역 수"));
        CocreatedScript unused = script(3, 12);
        List<CocreatedScript.Line> lines = unused.lines().stream()
                .map(l -> "서연".equals(l.character()) ? new CocreatedScript.Line("dialogue", "민호", l.text()) : l).toList();
        List<Issue> issues = CocreateRules.check(new CocreatedScript(unused.design(), unused.title(), unused.scene(),
                unused.characters(), lines), conditions(3, 1));
        assertThat(issues).anyMatch(i -> i.why().equals("대사가 없는 배역") && i.structural());
    }

    @Test
    @DisplayName("분량은 1분에 225~375자다 — 모자라면 구조 문제")
    void duration() {
        assertThat(CocreateRules.check(script(1, 6), conditions(1, 1)))
                .anyMatch(i -> i.why().startsWith("분량 150자") && i.structural());
        assertThat(CocreateRules.check(script(1, 36), conditions(1, 3))).isEmpty();
        assertThat(CocreateRules.lengthRules(3, 2)).contains("약 3분", "900자", "675~1125자", "내 대사 18줄");
        assertThat(CocreateRules.lengthRules(1, 1)).contains("독백 대사 12줄").doesNotContain("배역 수가 늘어도");
        assertThat(CocreateRules.estimatedSeconds(script(1, 12))).isEqualTo(60);
    }

    @Test
    @DisplayName("대화에서 같은 사람이 연속으로 말하면 그 줄의 치명 문제다 — 지문을 사이에 두면 연속이 아니고, 독백은 보지 않는다")
    void consecutive() {
        CocreatedScript base = script(2, 12);
        List<CocreatedScript.Line> lines = new ArrayList<>(base.lines());
        lines.set(2, new CocreatedScript.Line("dialogue", "지수", LINE));
        lines.set(4, new CocreatedScript.Line("dialogue", "민호", LINE));
        List<Issue> issues = CocreateRules.check(copy(base, lines), conditions(2, 1));
        assertThat(issues).anyMatch(i -> i.index() == 2 && i.fatal());

        List<CocreatedScript.Line> spaced = new ArrayList<>(base.lines());
        spaced.set(2, new CocreatedScript.Line("direction", null, "휴대폰을 내려놓는다"));
        assertThat(CocreateRules.check(copy(base, spaced), conditions(2, 1))).noneMatch(i -> i.why().contains("연속"));
        assertThat(CocreateRules.check(script(1, 12), conditions(1, 1))).noneMatch(i -> i.why().contains("연속"));
    }

    @Test
    @DisplayName("내 배역 비중이 25% 미만이면 구조 문제다")
    void share() {
        CocreatedScript base = script(4, 12);
        List<CocreatedScript.Line> lines = new ArrayList<>(base.lines());
        for (int i = 2; i < lines.size(); i++) {
            if ("지수".equals(lines.get(i).character())) {
                lines.set(i, new CocreatedScript.Line("dialogue", "태오", LINE));
            }
        }
        assertThat(CocreateRules.check(copy(base, lines), conditions(4, 1))).anyMatch(i -> i.why().contains("비중"));
    }

    @Test
    @DisplayName("모르는 배역·내 배역 없음·겹친 이름·빈 제목·빈 줄·종류 오류는 구조 문제 하나다")
    void structure() {
        CocreatedScript base = script(2, 12);
        assertThat(CocreateRules.check(null, conditions(2, 1))).containsExactly(new Issue(null, "대본 JSON 구조 오류"));
        assertThat(CocreateRules.check(copy(base, List.of(new CocreatedScript.Line("dialogue", "철수", LINE))), conditions(2, 1)))
                .containsExactly(new Issue(null, "모르는 배역의 대사"));
        CocreatedScript noMine = new CocreatedScript(base.design(), base.title(), base.scene(),
                List.of(new CocreatedScript.Role("지수", "f", "young", false), new CocreatedScript.Role("민호", "m", "young", false)),
                base.lines());
        assertThat(CocreateRules.check(noMine, conditions(2, 1))).singleElement().matches(Issue::structural);
        CocreatedScript twins = new CocreatedScript(base.design(), base.title(), base.scene(),
                List.of(new CocreatedScript.Role("지수", "f", "young", true), new CocreatedScript.Role("지수", "m", "young", false)),
                base.lines());
        assertThat(CocreateRules.check(twins, conditions(2, 1))).singleElement().matches(Issue::structural);
        assertThat(CocreateRules.check(new CocreatedScript(base.design(), " ", base.scene(), base.characters(), base.lines()),
                conditions(2, 1))).singleElement().matches(Issue::structural);
        assertThat(CocreateRules.check(copy(base, List.of()), conditions(2, 1))).singleElement().matches(Issue::structural);
        assertThat(CocreateRules.check(copy(base, List.of(new CocreatedScript.Line("aside", null, "x"))), conditions(2, 1)))
                .singleElement().matches(Issue::structural);
        assertThat(CocreateRules.check(copy(base, List.of(new CocreatedScript.Line("direction", "지수", "x"))), conditions(2, 1)))
                .singleElement().matches(Issue::structural);
    }

    @Test
    @DisplayName("줄 문제 — 길이·괄호·감정 이름·글 같은 어미·안전 금지어·긴 지문·표정 지문")
    void lineIssues() {
        CocreatedScript base = script(1, 12);
        List<CocreatedScript.Line> lines = new ArrayList<>(base.lines());
        lines.set(1, new CocreatedScript.Line("dialogue", "지수", "짧아"));
        lines.set(2, new CocreatedScript.Line("dialogue", "지수", "(웃으며) 그런가 정말로 그런 걸까 몰라"));
        lines.set(3, new CocreatedScript.Line("dialogue", "지수", "나 지금 너무 서운해 정말 너무 서운해"));
        lines.set(4, new CocreatedScript.Line("dialogue", "지수", "그건 원래 그런 것이다 알고 있었잖아"));
        lines.set(5, new CocreatedScript.Line("dialogue", "지수", "한강에 가자 오늘 밤에 같이 가 줘"));
        lines.add(new CocreatedScript.Line("direction", null, "흔들리는 눈빛으로 한참 동안 바라본다 그리고 천천히 돌아선다"));
        List<Issue> issues = CocreateRules.check(copy(base, lines), conditions(1, 1));
        assertThat(issues).extracting(Issue::why).anyMatch(w -> w.startsWith("길이 2자"))
                .contains("대사 안 괄호", "감정 이름을 대사로 말함", "글 같은 어미", "안전 금지어(죽음·자해·욕설·몸 이상)")
                .anyMatch(w -> w.startsWith("지문 ") && w.endsWith("(25자 이내)"))
                .anyMatch(w -> w.startsWith("지문에 표정·속마음(") && w.contains("눈빛"));
        assertThat(issues.stream().filter(i -> i.why().startsWith("안전"))).allMatch(Issue::fatal);
        assertThat(issues.stream().filter(i -> i.why().startsWith("길이"))).noneMatch(Issue::fatal);
    }

    @Test
    @DisplayName("10대에게는 받아낸다·휴대폰·사진·옷을 고르지 않고, 최근 것은 피하되 다 빠지면 처음부터 고른다")
    void slots() {
        for (int i = 0; i < 20; i++) {
            int seed = i;
            assertThat(CocreateRules.pick(CocreateRules.ENDINGS, true, Set.of(), n -> seed).minorAllowed()).isTrue();
            assertThat(CocreateRules.pick(CocreateRules.PROPS, true, Set.of(), n -> seed).minorAllowed()).isTrue();
        }
        assertThat(CocreateRules.pick(CocreateRules.ENDINGS, false, Set.of("떠난다"), n -> 0).name()).isEqualTo("털어놓는다");
        Set<String> all = Set.of("떠난다", "털어놓는다", "미룬다", "받아들인다", "받아낸다");
        assertThat(CocreateRules.pick(CocreateRules.ENDINGS, false, all, n -> 0).name()).isEqualTo("떠난다");
    }

    @Test
    @DisplayName("값의 범위·예시 JSON·수정 규칙 문구·조건 바꾸기")
    void helpers() {
        assertThat(CocreateRules.allowedLength(3)).isTrue();
        assertThat(CocreateRules.allowedLength(2)).isFalse();
        assertThat(CocreateRules.allowedLength(null)).isFalse();
        assertThat(CocreateRules.allowedCount(1)).isTrue();
        assertThat(CocreateRules.allowedCount(5)).isFalse();
        assertThat(CocreateRules.allowedCount(null)).isFalse();
        assertThat(CocreateRules.charactersSchema(2)).contains("\"mine\":true").contains("\"mine\":false");
        assertThat(CocreateRules.castRule(1, 12)).contains("독백 대사 12줄");
        assertThat(CocreateRules.castRule(2, 6)).contains("연속 금지", "6줄");
        Conditions resized = conditions(1, 1).resized(2, 3);
        assertThat(resized.characterCount()).isEqualTo(2);
        assertThat(resized.myLines()).isEqualTo(18);
        assertThat(resized.monologue()).isFalse();
        assertThat(Experience.EXAM.lineLen()).isEqualTo("15~40");
        assertThat(Experience.EXPERIENCED.label()).startsWith("경력자");
    }

    @Test
    @DisplayName("대본 저장 모양 — 배역은 자리로, 성별·나이대는 모델 값, 출처는 typed, 줄 번호는 1부터")
    void toDraft() {
        CocreatedScript base = script(2, 2);
        List<CocreatedScript.Line> lines = new ArrayList<>(base.lines());
        lines.add(new CocreatedScript.Line("direction", null, "돌아선다"));
        ScriptDraft draft = copy(base, lines).toDraft();
        assertThat(draft.source()).isEqualTo("typed");
        assertThat(draft.characterNames()).containsExactly("지수", "민호");
        assertThat(draft.characterTraits().getFirst().gender()).isEqualTo(CharacterGender.of("f"));
        assertThat(draft.characterTraits().getFirst().ageBand()).isEqualTo(CharacterAgeBand.of("young"));
        assertThat(draft.lines()).extracting(ScriptDraft.Line::ordinal).containsExactly(1, 2, 3, 4);
        assertThat(draft.lines()).extracting(ScriptDraft.Line::characterIndex).containsExactly(null, 0, 1, null);
        assertThat(draft.rawText()).startsWith("잊어버린 생일\n\n옥상, 밤\n지수: ").endsWith("(돌아선다)");
        assertThat(base.withText(1, "새 글").lines().get(1).text()).isEqualTo("새 글");
        assertThat(new CocreatedScript(base.design(), base.title(), base.scene(), List.of(), base.lines()).myLines()).isZero();
    }

    private static CocreatedScript copy(CocreatedScript base, List<CocreatedScript.Line> lines) {
        return new CocreatedScript(base.design(), base.title(), base.scene(), base.characters(), lines);
    }
}
