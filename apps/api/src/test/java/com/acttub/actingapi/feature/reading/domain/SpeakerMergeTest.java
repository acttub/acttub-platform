package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SpeakerMergeTest {

    /** 화자 차례대로 대사 한 줄씩인 대본. */
    private static ScriptDraft draft(List<String> names, String... speakers) {
        List<ScriptDraft.Line> lines = new ArrayList<>();
        for (String speaker : speakers) {
            lines.add(new ScriptDraft.Line(lines.size() + 1, "dialogue", names.indexOf(speaker), speaker + "의 대사"));
        }
        return new ScriptDraft("t", "", "paste", names, lines);
    }

    /** 원문 줄 k(1부터)가 k번째 화자의 대사인 것처럼 — 원문은 「화자 대사」 줄들. */
    private static List<SpeakerMerge.Candidate> candidates(List<String> names, String... speakers) {
        List<String> source = new ArrayList<>();
        Map<Integer, String> bySource = new HashMap<>();
        for (int k = 0; k < speakers.length; k++) {
            source.add(speakers[k] + " 대사" + k);
            bySource.put(k + 1, speakers[k]);
        }
        return SpeakerMerge.candidates(draft(names, speakers), NumberedLine.of(String.join("\n", source)), bySource, Map.of(), java.util.Set.of());
    }

    private static List<String> asked(List<SpeakerMerge.Candidate> candidates) {
        return candidates.stream().map(candidate -> candidate.name() + "→" + candidate.roles()).toList();
    }

    @Test
    @DisplayName("SOMA-663 R2: 후보는 비슷한 쌍의 대사 적은 쪽과 대사 두 개 이하 이름이고, 보기는 짝·앞뒤 대사의 배역이다. 정책상 다른 배역은 보기에 없다")
    void asksMinorAndRareNamesWithPartnersAndNeighbours() {
        List<String> names = List.of("앰버", "엠버", "철수", "철수 NA", ".", "주혁, 돈결");
        List<SpeakerMerge.Candidate> candidates = candidates(names,
                "앰버", "앰버", "앰버", "철수", "철수", "철수", "엠버", "철수", ".", "철수 NA", "주혁, 돈결", "주혁, 돈결", "주혁, 돈결");

        assertThat(asked(candidates)).containsExactly("엠버→[앰버, 철수]", "철수 NA→[]", ".→[철수]");
        assertThat(candidates.getFirst().choices(false)).extracting(LineReview.Choice::value)
                .containsExactly("r0", "r1", SpeakerMerge.OWN, SpeakerMerge.NONE, SpeakerMerge.UNSURE);
        assertThat(asked(candidates(List.of("형사1", "형사2", "어린 마티아스", "마티아스"),
                "형사1", "형사1", "형사1", "형사2", "형사2", "형사2", "마티아스", "마티아스", "마티아스", "어린 마티아스", "어린 마티아스", "어린 마티아스")))
                .as("번호만·나이 낱말만 다른 쌍은 묻지 않는다").isEmpty();
        assertThat(asked(candidates(List.of("주혁", "승욱", "주혁 승욱"), "주혁", "주혁", "주혁", "승욱", "승욱", "승욱", "주혁 승욱")))
                .as("띄어 쓴 배역 이름들뿐인 이름은 함께 말하기").isEmpty();
        assertThat(asked(candidates(List.of("쥴리아", "줄리아", "슐리아", "엑스트라2", "엑스타라2"),
                "쥴리아", "쥴리아", "쥴리아", "줄리아", "슐리아", "엑스트라2", "엑스타라2")))
                .as("다른 후보는 보기에서 빼되, 짝이 모두 후보면 짝은 남긴다")
                .containsExactly("줄리아→[쥴리아]", "슐리아→[쥴리아]", "엑스타라2→[엑스트라2]", "엑스트라2→[]");
    }

    @Test
    @DisplayName("SOMA-663 R2: state 는 후보의 대사 수·원문 머리 수, 대본 시작, 붙은 원문 줄(▶)과 앞뒤, 쓰인 장면의 말하는 배역, 보기 역할의 첫 쓰임·가까운 쓰임이고 줄마다 지금 붙은 배역을 단다(후보 자신의 줄은 빼고, X1)")
    void stateShowsUsesInSourceAndRoles() {
        List<NumberedLine> source = NumberedLine.of("등장인물: 쥴리아(가정교사)\n주인 앉아요.\n쥴리아 네.\n주인 월급 얘기요.\n슐리아 네?\n주인 그래요.");
        ScriptDraft draft = draft(List.of("주인", "쥴리아", "슐리아"), "주인", "쥴리아", "주인", "슐리아", "주인");
        Map<Integer, String> speakers = Map.of(2, "주인", 3, "쥴리아", 4, "주인", 5, "슐리아", 6, "주인");

        SpeakerMerge.Candidate candidate = SpeakerMerge.candidates(draft, source, speakers, Map.of(), java.util.Set.of()).stream()
                .filter(found -> found.name().equals("슐리아")).findFirst().orElseThrow();

        assertThat(candidate.roles()).containsExactly("쥴리아", "주인");
        assertThat(candidate.state()).isEqualTo("""
                배역 후보 「슐리아」: 대사 1개, 원문에서 이 이름으로 시작하는 줄 1개. 줄 앞 [이름] 은 지금 그 줄이 붙은 배역이다.

                대본 시작:
                L1: 등장인물: 쥴리아(가정교사)
                L2: [주인] 주인 앉아요.
                L3: [쥴리아] 쥴리아 네.
                L4: [주인] 주인 월급 얘기요.
                ▶ L5: 슐리아 네?
                L6: [주인] 주인 그래요.

                후보가 붙은 곳(▶):

                후보가 쓰인 장면과 그 장면에서 말하는 배역(대사 줄 수):
                - L1~L6: 주인 3, 쥴리아 1, 슐리아 1

                보기 「쥴리아」: 대사 1개, 원문 머리 1개
                L3: [쥴리아] 쥴리아 네.

                보기 「주인」: 대사 3개, 원문 머리 3개
                L2: [주인] 주인 앉아요.
                L4: [주인] 주인 월급 얘기요.""");
    }

    @Test
    @DisplayName("SOMA-663 R2: 문턱 이상 답만 적용 — 기존 역할로 합치고(이어진 대응도 끝 역할로) 성별·나이대를 잇고, 배역 아님은 지문이 되고 배역이 지워진다")
    void appliesConfidentAnswers() {
        List<String> names = List.of("쥴리아", "슐리아", "졸리아", "마티아스", ".", "경찰", "가", "나");
        CharacterTraits female = new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG);
        List<CharacterTraits> traits = new ArrayList<>(java.util.Collections.nCopies(names.size(), CharacterTraits.UNKNOWN));
        traits.set(1, female);
        ScriptDraft base = draft(names, "쥴리아", "쥴리아", "슐리아", "졸리아", "마티아스", ".", "경찰", "가", "나");
        ScriptDraft draft = new ScriptDraft("t", "", "paste", names, base.lines(), traits);
        Map<SpeakerMerge.Candidate, LineReview.Answer> answers = new LinkedHashMap<>();
        answers.put(new SpeakerMerge.Candidate("슐리아", List.of("쥴리아"), ""), new LineReview.Answer("r0", 0.8));
        answers.put(new SpeakerMerge.Candidate("졸리아", List.of("마티아스", "슐리아"), ""), new LineReview.Answer("r1", 0.9));
        answers.put(new SpeakerMerge.Candidate(".", List.of("마티아스"), ""), new LineReview.Answer(SpeakerMerge.NONE, 0.95));
        answers.put(new SpeakerMerge.Candidate("경찰", List.of("마티아스"), ""), new LineReview.Answer("r0", 0.5));
        answers.put(new SpeakerMerge.Candidate("가", List.of("나"), ""), new LineReview.Answer("r0", 0.9));
        answers.put(new SpeakerMerge.Candidate("나", List.of("가"), ""), new LineReview.Answer("r0", 0.9));

        ScriptDraft applied = SpeakerMerge.apply(draft, answers, 0.7);

        assertThat(applied.characterNames()).as("돌고 도는 가·나는 그대로").containsExactly("쥴리아", "마티아스", "경찰", "가", "나");
        assertThat(applied.lines()).extracting(line -> line.characterIndex() == null ? line.kind() : applied.characterNames().get(line.characterIndex()))
                .containsExactly("쥴리아", "쥴리아", "쥴리아", "쥴리아", "마티아스", "direction", "경찰", "가", "나");
        assertThat(applied.lines().get(5).text()).isEqualTo(".의 대사");
        assertThat(applied.characterTraits().getFirst()).as("합쳐진 「슐리아」의 성별·나이대").isEqualTo(female);
        assertThat(SpeakerMerge.apply(draft, answers, 0.96)).as("문턱 위가 없으면 그대로").isSameAs(draft);
    }

    @Test
    @DisplayName("SOMA-663 R2b: 보기 순서를 바꿔 두 번 물은 답은 보기별 확률 평균의 가장 높은 보기다. 하나라도 못 받으면 답이 없다")
    void meansTwoOrders() {
        assertThat(SpeakerMerge.mean(Map.of("r0", 0.6, "own", 0.4), Map.of("r0", 0.8, "own", 0.2)))
                .satisfies(answer -> {
                    assertThat(answer.choice()).isEqualTo("r0");
                    assertThat(answer.confidence()).isCloseTo(0.7, org.assertj.core.data.Offset.offset(1e-9));
                });
        assertThat(SpeakerMerge.mean(Map.of("r0", 0.9), null)).isNull();
    }

    @Test
    @DisplayName("SOMA-663 R2b: 이름이 그 줄 글 전체인 후보는 기존 역할로 문턱 넘게 합치지 않으면 지문이 되고 배역이 지워진다 — 글은 남는다")
    void wholeLineNameBecomesDirection() {
        List<NumberedLine> source = NumberedLine.of("철수 안녕.\n엥 그런게 있네\n철수 그래.\n철수 응.");
        ScriptDraft draft = draft(List.of("철수", "엥 그런게 있네"), "철수", "엥 그런게 있네", "철수", "철수");
        SpeakerMerge.Candidate candidate = SpeakerMerge.candidates(draft, source, Map.of(1, "철수", 2, "엥 그런게 있네", 3, "철수", 4, "철수"), Map.of(), java.util.Set.of())
                .getFirst();
        assertThat(candidate.wholeLine()).isTrue();
        Map<SpeakerMerge.Candidate, LineReview.Answer> answers = new HashMap<>();
        answers.put(candidate, null);

        ScriptDraft applied = SpeakerMerge.apply(draft, answers, 0.7);

        assertThat(applied.characterNames()).containsExactly("철수");
        assertThat(applied.lines().get(1)).satisfies(line -> {
            assertThat(line.kind()).isEqualTo("direction");
            assertThat(line.text()).isEqualTo("엥 그런게 있네의 대사");
        });
        answers.put(candidate, new LineReview.Answer("r0", 0.8));
        assertThat(SpeakerMerge.apply(draft, answers, 0.7).lines().get(1).characterIndex()).as("문턱 넘게 「철수」를 고르면 철수의 말").isZero();
    }

    @Test
    @DisplayName("SOMA-663 M6: 후보 줄 원문 머리의 괄호 안 이름이 보기 역할이면 state 와 독립 배역 보기가 그렇다고 적는다(배우와 극중 역할)")
    void statesTheActorInTheHeadParenthesis() {
        List<NumberedLine> source = NumberedLine.of("태수 가\n태수 나\n민수(태수) 다\n태수 라");
        List<String> names = List.of("태수", "민수");
        ScriptDraft draft = draft(names, "태수", "태수", "민수", "태수");
        Map<Integer, String> speakers = Map.of(1, "태수", 2, "태수", 3, "민수", 4, "태수");

        List<SpeakerMerge.Candidate> candidates = SpeakerMerge.candidates(draft, source, speakers, Map.of(1, "태수", 2, "태수", 3, "민수(태수)", 4, "태수"),
                java.util.Set.of());

        assertThat(asked(candidates)).containsExactly("민수→[태수]");
        assertThat(candidates.getFirst().state()).contains("원문에서 이 이름으로 시작하는 줄 1개. 줄 앞 [이름] 은 지금 그 줄이 붙은 배역이다.\n"
                + "후보 머리 「민수(태수)」의 괄호 안 「태수」는 보기 역할 이름이다.\n\n대본 시작:");
        assertThat(candidates.getFirst().choices(false)).filteredOn(choice -> choice.value().equals(SpeakerMerge.OWN)).singleElement()
                .satisfies(choice -> assertThat(choice.description()).endsWith(" 후보 머리 괄호 안의 「태수」가 극 안에서 연기하는 역도 독립 배역이다."));
        SpeakerMerge.Candidate headless = SpeakerMerge.candidates(draft, source, speakers, Map.of(), java.util.Set.of()).getFirst();
        assertThat(headless.state()).as("머리가 없으면 근거 문장도 없다").doesNotContain("괄호 안");
        assertThat(headless.choices(false)).extracting(LineReview.Choice::description).noneMatch(text -> text.contains("괄호 안"));
        assertThat(SpeakerMerge.actor("태수(NA)", "태수")).as("제 이름 뒤 표시는 배우가 아니다").isFalse();
    }
}
