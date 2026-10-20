package com.acttub.actingapi.feature.coach.app;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * 목적별 코칭(SOMA-719)에서 화면이 그대로 그리는 값. 목적 없이 시작한 대화는 {@code null} 이다.
 *
 * @param purpose evaluate·stuck·character
 * @param step 지금 단계(evaluate: card·method·wrap, stuck: reason·line·seen·method·wrap, character: view·cell·wrap)
 * @param choices 이번 코치 답 아래에 그릴 답 버튼(누르면 그 글을 배우 답으로 보낸다). 정리에서는 빈 목록이다
 * @param scene AI가 영상에서 알아본 장면. 없으면 {@code null}
 * @param lines AI가 받아 적은 대사와 영상 시간(초). 소리가 없거나 대사를 못 알아들었으면 빈 목록이다
 * @param card 평가 받기의 결과 카드. 없으면 {@code null}
 * @param characterCard 인물 이해하기의 인물 카드. 없으면 {@code null}
 */
public record PurposeView(
        String purpose,
        String step,
        List<Choice> choices,
        Scene scene,
        List<Line> lines,
        Card card,
        CharacterCard characterCard) {

    /** 답 버튼. {@code at} 은 그 버튼이 가리키는 영상 시간(초), 없으면 {@code null}. */
    public record Choice(String label, Integer at) { }

    /** 빈 칸은 빈 문자열이다. */
    public record Scene(String situation, String character, String partner) { }

    public record Line(int at, String text) { }

    /** 칸이 없으면 그 칸은 {@code null} 이다. */
    public record Card(CardItem good, CardItem issue, CardItem next) { }

    public record CardItem(Integer at, String text) { }

    public record CharacterCard(List<Cell> cells) { }

    /**
     * @param key who·before·relation·want·obstacle·action
     * @param source 내 말·같이 찾음·영상·대본
     */
    public record Cell(String key, String label, String value, String source) { }

    /** 저장된 목적과 대화 상태에서 만든다. 목적이 없으면 {@code null}. */
    public static PurposeView from(String sessionPurpose, JsonNode state) {
        PurposeLoop.Purpose purpose = PurposeLoop.Purpose.of(sessionPurpose);
        if (purpose == null) return null;
        JsonNode loop = state == null ? null : state.path(PurposeLoop.STATE_KEY);
        if (loop == null || !loop.isObject()) {
            return new PurposeView(purpose.id, purpose.steps.getFirst(), List.of(), null, List.of(), null, null);
        }
        int index = Math.max(0, Math.min(purpose.steps.size() - 1, loop.path("step").asInt(0)));
        var choices = new ArrayList<Choice>();
        for (JsonNode choice : loop.path("choices")) {
            choices.add(new Choice(choice.path("label").asText(""), at(choice.path("at"))));
        }
        Scene scene = null;
        if (loop.path("scene").isObject()) {
            JsonNode s = loop.path("scene");
            scene = new Scene(s.path("situation").asText(""), s.path("character").asText(""), s.path("partner").asText(""));
        }
        var lines = new ArrayList<Line>();
        for (JsonNode line : loop.path("lines")) {
            lines.add(new Line(line.path("at").asInt(0), line.path("text").asText("")));
        }
        Card card = null;
        if (loop.path("card").isObject()) {
            JsonNode c = loop.path("card");
            card = new Card(item(c.path("good")), item(c.path("issue")), item(c.path("next")));
        }
        CharacterCard characterCard = null;
        if (loop.path("character_card").path("cells").isArray()) {
            var cells = new ArrayList<Cell>();
            for (JsonNode cell : loop.path("character_card").path("cells")) {
                cells.add(new Cell(cell.path("key").asText(""), cell.path("label").asText(""),
                        cell.path("value").asText(""), cell.path("source").asText("")));
            }
            characterCard = new CharacterCard(List.copyOf(cells));
        }
        return new PurposeView(purpose.id, purpose.steps.get(index), List.copyOf(choices), scene, List.copyOf(lines),
                card, characterCard);
    }

    private static CardItem item(JsonNode node) {
        if (node == null || !node.isObject()) return null;
        return new CardItem(at(node.path("at")), node.path("text").asText(""));
    }

    private static Integer at(JsonNode node) {
        return node != null && node.isNumber() ? node.asInt() : null;
    }
}
