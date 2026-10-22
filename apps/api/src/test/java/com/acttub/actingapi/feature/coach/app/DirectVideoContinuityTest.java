package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.StructuredJson;
import org.junit.jupiter.api.Test;

class DirectVideoContinuityTest {
    private static CoachSessionSnapshot session(String written, PriorContext prior) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 30000, "표현", "그 외", written, "open", "",
                List.of(), prior, "three_layers_v1", 0, null, null, null);
    }

    private static PriorContext prior(String line) {
        return new PriorContext(Map.of(), "코치: 오늘은 여기까지 해요.", false, List.of(), List.of(line));
    }

    @Test void continuedRoundGetsLastSuggestionAndNoRepeatRule() {
        var s = session(null, prior("1차: 버릇 아빠에게 무엇을 얻으려는지가 분명하지 않아요 — 제안: 아빠에게 하나씩 따져 묻듯 말해 봐도 좋아요."));
        String design = "근본 문제: 2 목적\n첫 질문 모양: 이어서 — 지난 시도: 따져 묻기 / 이번에 보인 곳: 없음\n";
        var lines = DirectVideoCoach.withContinuity(List.of("이 배우의 문제: x"), s, design, PracticeLoopRouter.WRAP_UP);
        assertThat(lines).contains("지난 회차 제안(배우가 이번 테이크에서 해 보려던 것): 아빠에게 하나씩 따져 묻듯 말해 봐도 좋아요.");
        assertThat(lines).anyMatch(l -> l.startsWith("이번에 권하는 행동은 지난 회차 제안과 같은 행동"));
        assertThat(lines).noneMatch(l -> l.startsWith("배우가 지난 시도로 달라진 점"));
        assertThat(lines).anyMatch(l -> l.startsWith("지난 회차에 이미 권한 행동: 따지기("));
        var gap = DirectVideoCoach.withContinuity(List.of(), s, design, PracticeLoopRouter.GAP);
        assertThat(gap).anyMatch(l -> l.startsWith("배우가 지난 시도로 달라진 점"));
    }

    @Test void newSceneOrNoSuggestionAddsNothingAboutLastRound() {
        var s = session(null, prior("1차: 버릇 x — 제안: 떠봐도 좋아요."));
        assertThat(DirectVideoCoach.withContinuity(List.of("a"), s, "첫 질문 모양: 2 목적 — 원하는 것\n", PracticeLoopRouter.WRAP_UP))
                .containsExactly("a");
        var noSuggestion = session(null, prior("1차: 버릇 x"));
        assertThat(DirectVideoCoach.continuedSuggestion(noSuggestion, "첫 질문 모양: 이어서 — 지난 시도: y\n")).isNull();
        assertThat(DirectVideoCoach.continuedSuggestion(session(null, PriorContext.EMPTY), "첫 질문 모양: 이어서 — y\n")).isNull();
    }

    @Test void actionFamiliesGroupSynonyms() {
        assertThat(DirectVideoCoach.actionFamilies("잘못된 사실들을 조목조목 따져 물으며 몰아붙여 봐도 좋아요"))
                .containsExactly("몰아붙이기(몰아붙이다·몰아세우다·쏘아붙이다·다그치다)", "따지기(따지다·조목조목·캐묻다·추궁하다)");
        assertThat(DirectVideoCoach.actionFamilies("견우가 민망해서 어쩔 줄 모르는 걸 보려고 더 빤히 쳐다보며 말해 봐도 좋아요"))
                .containsExactly("빤히 보기(빤히·쳐다보다·눈을 보다)");
        assertThat(DirectVideoCoach.actionFamilies("하나씩 들려주듯 말해 봐도 좋아요")).isEmpty();
    }

    @Test void actorWrittenNoteIsKeptAsChoice() {
        var s = session("첫 대사는  놀리면서\n시작하고 싶었어!", PriorContext.EMPTY);
        var lines = DirectVideoCoach.withContinuity(List.of(), s, "", PracticeLoopRouter.GAP);
        assertThat(lines.getFirst()).isEqualTo("배우가 이번 연습을 올리며 적은 것: 첫 대사는 놀리면서 시작하고 싶었어!");
        assertThat(lines.get(1)).contains("배우의 선택이다");
    }
}
