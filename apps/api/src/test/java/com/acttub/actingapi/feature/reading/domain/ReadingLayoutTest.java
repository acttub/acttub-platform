package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import com.acttub.actingapi.feature.reading.domain.ReadingLayout.Progress;
import com.acttub.actingapi.feature.reading.domain.ReadingLayout.RangeName;
import com.acttub.actingapi.feature.reading.domain.ReadingLayout.Scene;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 입력과 기대값은 앱 {@code tests/reading-session-plan.test.mjs}·{@code reading-session-cards.test.mjs} 와 같다(이름도 같다).
 * 앱은 줄 인덱스로 답하고 서버는 줄 id 로 답하므로 줄 id 를 인덱스로 만든다({@link #id}).
 */
class ReadingLayoutTest {

    private static final List<Row> WITH_SCENES = List.of(
            s("1막"), d("a"), d("b"), x("사이"), d("c"), s("2막"), x("밤"), d("d"), d("e"));

    /** 앱 reading-session-cards 의 SCRIPT — 대사 1~6, 지문 둘. 지문 경계 장면은 합쳐져 하나뿐이다. */
    private static final List<Row> SCRIPT = List.of(
            x("옥상, 밤."), d("여기 있을 줄 알았어."), d("어떻게 알았어."), d("너 힘들면 항상 높은 데로 가잖아."),
            d("(웃으며) 그런가."), x("사이."), d("왜 말 안 했어."), d("말하면 뭐가 달라져."));

    @Test
    @DisplayName("reading.session: 장면 \"1막\"을 고르면 그 장면의 첫·마지막 대사가 구간이다")
    void scenesByHeader() {
        List<Scene> scenes = layout(WITH_SCENES).scenes();

        assertThat(scenes).extracting(Scene::title).containsExactly("1막", "2막");
        assertThat(scenes).extracting(Scene::startLineId, Scene::endLineId)
                .containsExactly(ids(1, 4), ids(7, 8));
        assertThat(scenes).extracting(Scene::dialogueCount).containsExactly(3, 2);
    }

    @Test
    @DisplayName("reading.session: 장면 줄 없는 대본은 지문 경계로 장면이 나뉘고 번호가 붙는다")
    void scenesByDirection() {
        List<Scene> scenes = layout(concat(List.of(x("옥상")), lines(5), List.of(x("사이")), lines(6))).scenes();

        assertThat(scenes).extracting(Scene::title, Scene::no)
                .containsExactly(tuple(null, 1), tuple(null, 2));
        assertThat(scenes).extracting(Scene::startLineId, Scene::endLineId)
                .containsExactly(ids(1, 5), ids(7, 12));
    }

    @Test
    @DisplayName("reading.session: 지문으로 끊긴 장면 가운데 대사 5개 미만은 앞 장면에 붙인다")
    void shortDirectionScenesJoinThePreviousScene() {
        List<Scene> scenes = layout(concat(
                List.of(x("옥상")), lines(6), List.of(x("사이")), lines(2), List.of(x("밤")), lines(5))).scenes();

        assertThat(scenes).extracting(Scene::no, Scene::startLineId, Scene::endLineId, Scene::dialogueCount)
                .containsExactly(tuple(1, id(1), id(9), 8), tuple(2, id(11), id(15), 5));
    }

    @Test
    @DisplayName("reading.session: 첫 장면이 짧으면 뒤 장면에 붙인다")
    void aShortFirstSceneJoinsTheNextScene() {
        List<Scene> scenes = layout(concat(List.of(x("옥상")), lines(2), List.of(x("사이")), lines(5))).scenes();

        assertThat(scenes).extracting(Scene::no, Scene::startLineId, Scene::endLineId, Scene::dialogueCount)
                .containsExactly(tuple(1, id(1), id(8), 7));
    }

    @Test
    @DisplayName("session.md 검증 방법: 지문 경계로 나뉜 둘째 장면의 대사가 3개면 첫 장면에, 첫 장면의 대사가 3개면 둘째 장면에 붙는다")
    void threeDialogueScenesJoinTheirNeighbour() {
        assertThat(layout(concat(List.of(x("옥상")), lines(6), List.of(x("사이")), lines(3))).scenes())
                .extracting(Scene::startLineId, Scene::endLineId, Scene::dialogueCount)
                .containsExactly(tuple(id(1), id(10), 9));
        assertThat(layout(concat(List.of(x("옥상")), lines(3), List.of(x("사이")), lines(6))).scenes())
                .extracting(Scene::startLineId, Scene::endLineId, Scene::dialogueCount)
                .containsExactly(tuple(id(1), id(10), 9));
    }

    @Test
    @DisplayName("reading.session: 막·장 머리로 나뉜 장면은 짧아도 합치지 않는다")
    void headerScenesAreNeverMerged() {
        assertThat(layout(WITH_SCENES).scenes()).extracting(Scene::dialogueCount).containsExactly(3, 2);
    }

    @Test
    @DisplayName("reading.session: 구간 이름 — 대본 전체·장면 하나와 정확히 같을 때·그 밖은 대사 번호")
    void rangeNames() {
        ReadingLayout script = layout(concat(List.of(x("옥상")), lines(5), List.of(x("사이")), lines(6)));

        assertThat(script.rangeName(1, 11)).isEqualTo(new RangeName("all", null, null, 1, 11));
        assertThat(script.rangeName(6, 11)).isEqualTo(new RangeName("scene", 2, null, 6, 11));
        assertThat(script.rangeName(6, 10)).isEqualTo(new RangeName("dialogues", null, null, 6, 10));
        assertThat(layout(WITH_SCENES).rangeName(4, 5)).isEqualTo(new RangeName("scene", 2, "2막", 4, 5));
    }

    @Test
    @DisplayName("reading.session: 대사 번호는 대사 줄만 1부터 세고 지문·장면은 없다")
    void dialogueNumbers() {
        ReadingLayout layout = layout(WITH_SCENES);

        assertThat(layout.rangeName(1, 5).kind()).as("대사 다섯이 전체").isEqualTo("all");
        assertThat(layout.progress(1, 5, id(4))).as("넷째 줄이 3번 대사").isEqualTo(new Progress(2, 5));
        assertThat(layout.progress(1, 5, id(7))).as("여덟째 줄이 4번 대사").isEqualTo(new Progress(3, 5));
        assertThat(layout.dialogueNo(id(4))).as("다르게 말한 대사의 번호도 같은 수").isEqualTo(3);
        assertThat(layout.dialogueNo(id(8))).isEqualTo(5);
        assertThat(layout.dialogueNo(id(0))).as("장면 줄").isNull();
        assertThat(layout.dialogueNo(UUID.randomUUID())).as("다른 대본의 줄").isNull();
    }

    @Test
    @DisplayName("reading.session: 연습 기록 줄은 구간 이름을 장면·대사 번호·처음부터 끝까지로 부른다")
    void sessionRangeNames() {
        assertThat(layout(SCRIPT).rangeName(1, 6).kind()).isEqualTo("all");
        assertThat(layout(SCRIPT).rangeName(2, 4)).isEqualTo(new RangeName("dialogues", null, null, 2, 4));
    }

    @Test
    @DisplayName("reading.session: \"이어서 연습 · K/N\" — N은 구간 대사 수, K는 현재 줄 앞까지의 대사 수")
    void resumeProgress() {
        ReadingLayout eight = layout(lines(8));

        assertThat(eight.progress(3, 7, id(4))).as("현재 줄이 5번 대사").isEqualTo(new Progress(2, 5));
        assertThat(eight.progress(3, 7, null)).isEqualTo(new Progress(0, 5));
        assertThat(layout(SCRIPT).progress(1, 6, id(4))).isEqualTo(new Progress(3, 6));
    }

    @Test
    @DisplayName("웹 resumeProgress: 현재 줄의 대사 번호에서 시작 번호를 뺀다, 현재 줄이 없으면 0")
    void webResumeProgress() {
        ReadingLayout script = layout(concat(List.of(x("밤.")), lines(5)));

        assertThat(script.progress(1, 5, id(3))).isEqualTo(new Progress(2, 5));
        assertThat(script.progress(1, 5, id(1))).isEqualTo(new Progress(0, 5));
        assertThat(script.progress(1, 5, null)).isEqualTo(new Progress(0, 5));
    }

    @Test
    @DisplayName("K/N: 현재 줄이 대사가 아니면(API 밖에서 들어온 행) 그 앞 대사의 번호로 센다 — 웹 규칙, 앱은 0이었다")
    void progressOnANonDialogueLineCountsFromThePreviousDialogue() {
        assertThat(layout(SCRIPT).progress(1, 6, id(5))).as("지문 「사이.」 앞이 4번 대사").isEqualTo(new Progress(3, 6));
        assertThat(layout(SCRIPT).progress(1, 6, id(0))).as("앞에 대사가 없는 지문").isEqualTo(new Progress(0, 6));
    }

    private record Row(String kind, String text) {
    }

    private static ReadingLayout layout(List<Row> rows) {
        List<ReadingLayout.Line> lines = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            lines.add(new ReadingLayout.Line(id(i), rows.get(i).kind(), rows.get(i).text()));
        }
        return ReadingLayout.of(lines);
    }

    private static UUID id(int index) {
        return new UUID(0, index);
    }

    private static Tuple ids(int start, int end) {
        return tuple(id(start), id(end));
    }

    private static Row d(String text) {
        return new Row("dialogue", text);
    }

    private static Row x(String text) {
        return new Row("direction", text);
    }

    private static Row s(String text) {
        return new Row("scene", text);
    }

    private static List<Row> lines(int n) {
        return IntStream.range(0, n).mapToObj(i -> d(String.valueOf(i))).toList();
    }

    @SafeVarargs
    private static List<Row> concat(List<Row>... parts) {
        return Arrays.stream(parts).flatMap(List::stream).toList();
    }
}
