package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/** 장면 단위 칸은 같은 장면(root_id)에서만 코치에게 간다 (SOMA-795). */
class MemoryScopeTest {

    private static final UUID SCENE_A = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID SCENE_B = UUID.fromString("00000000-0000-0000-0000-0000000000b1");

    private static final List<MemoryScope.Row> ROWS = List.of(
            new MemoryScope.Row("goal", "아버지에게서 인정받으려는 마음을 숨긴다", false, SCENE_A),
            new MemoryScope.Row("avoid", "- 아버지: \"그건 아니에요\"", false, SCENE_A),
            new MemoryScope.Row("goal", "친구에게 서운함을 꺼내 본다", false, SCENE_B),
            new MemoryScope.Row("tone", "짧게 존댓말로 답하고 직설을 바란다", false, null),
            new MemoryScope.Row("wants", "방법을 바로 알려 주길 바란다(\"어떻게 해요?\")", false, null),
            new MemoryScope.Row("coaching_profile", "[길이] 90\n[이 배우에게 맞춘 코칭]", false, null));

    @Test
    void sceneFieldsOnlyComeFromTheSameScene() {
        assertThat(MemoryScope.forScene(ROWS, SCENE_A))
                .containsEntry("goal", "아버지에게서 인정받으려는 마음을 숨긴다")
                .containsEntry("avoid", "- 아버지: \"그건 아니에요\"")
                .containsKeys("tone", "wants", "coaching_profile");
        assertThat(MemoryScope.forScene(ROWS, SCENE_B))
                .containsEntry("goal", "친구에게 서운함을 꺼내 본다")
                .doesNotContainKey("avoid");
    }

    @Test
    void aNewSceneGetsOnlyActorLevelFields() {
        assertThat(MemoryScope.forScene(ROWS, UUID.randomUUID()))
                .containsOnlyKeys("tone", "wants", "coaching_profile");
        assertThat(MemoryScope.forScene(ROWS, null))
                .containsOnlyKeys("tone", "wants", "coaching_profile");
    }

    @Test
    void aGoalTheActorWroteWithoutASceneIsReadEverywhereButTheSceneOwnWins() {
        List<MemoryScope.Row> rows = List.of(
                new MemoryScope.Row("goal", "오디션에서 내 색을 보여 주고 싶다", true, null),
                new MemoryScope.Row("goal", "친구에게 서운함을 꺼내 본다", false, SCENE_B));
        assertThat(MemoryScope.forScene(rows, SCENE_A)).containsEntry("goal", "오디션에서 내 색을 보여 주고 싶다");
        assertThat(MemoryScope.forScene(rows, SCENE_B)).containsEntry("goal", "친구에게 서운함을 꺼내 본다");
    }

    @Test
    void aModelWrittenSceneFieldWithoutASceneIsNotRead() {
        // 옛 표의 목표처럼 어느 장면의 것인지 모르는 모델 값은 다른 대본에 섞일 수 있어 읽지 않는다.
        List<MemoryScope.Row> rows = List.of(
                new MemoryScope.Row("goal", "어머니에게 사과를 받아 낸다", false, null),
                new MemoryScope.Row("blockage", "감정이 큰 대목에서 말이 멈춘다고 스스로 말했다", false, null));
        assertThat(MemoryScope.forScene(rows, SCENE_A)).containsOnlyKeys("blockage");
    }

    @Test
    void storedMeaninglessModelValuesAreNotReadButTheActorsOwnWordsAre() {
        List<MemoryScope.Row> rows = List.of(
                new MemoryScope.Row("blockage", "복합적인 감정을 소리 지르지 않고 표현하는 가운데, 표현과 표정에서 막히는 지점을 골랐다.",
                        false, null),
                new MemoryScope.Row("habits", "상대에게서 무엇을 얻으려는지 드러나지 않는다는 지적이 있었고 배우가 받아들였다", false, null),
                new MemoryScope.Row("wants", "골랐다", true, null));
        assertThat(MemoryScope.forScene(rows, SCENE_A)).containsOnlyKeys("wants");
    }
}
