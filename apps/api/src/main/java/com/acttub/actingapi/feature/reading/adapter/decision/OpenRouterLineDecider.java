package com.acttub.actingapi.feature.reading.adapter.decision;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;

import com.acttub.actingapi.feature.reading.app.LineDecider;
import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.feature.reading.domain.SpeakerMerge;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * OpenRouter Decisions API 로 Jev 를 부른다(SOMA-663 J1). 한 요청에 종류·화자 두 질문과 줄에 따라 더 묻는 질문({@link LineReview.Extra})을 넣고, 보기는 {@code {값: {label, description}}}
 * 이다. 데이터를 보관하는 provider 는 라우팅에서 뺀다({@code data_collection: deny}). 붐빔·서버 실패·연결 실패는 1·2·4초 물러서 세 번까지
 * 다시 보낸다. 이 객체 하나로 나가는 요청은 동시 {@code maxInFlight} 개까지다 — 운영은 빈 하나라 서버 전체 상한이다.
 */
public class OpenRouterLineDecider implements LineDecider {
    private static final URI URL = URI.create("https://openrouter.ai/api/alpha/decisions");
    private static final int RETRIES = 3;

    private final ObjectMapper json;
    private final HttpClient http;
    private final String model;
    private final String key;
    private final Duration timeout;
    private final Semaphore inFlight;

    /** 「말하는 글인가」 질문(SOMA-663 H1). 보기는 {@code speech}·{@code other}. */
    static final String SPEECH_QUESTION = "script";
    private static final String SPEECH_INSTRUCTIONS = "이 글이 연기 연습용 대본으로 쓸 수 있는 「사람이 소리 내어 하는 말」인지 판단한다. 배역 이름 표기가 없어도 된다.";
    private static final List<LineReview.Choice> SPEECH_CHOICES = List.of(
            new LineReview.Choice("speech", "말하는 글", "한 사람의 독백이나 여러 사람이 주고받는 대화처럼, 사람이 직접 소리 내어 하는 말로 된 글. 희곡·시나리오·대본 포함."),
            new LineReview.Choice("other", "말이 아닌 글", "이야기를 서술로 들려주는 소설·동화, 기사, 설명문·교육 자료·논문, 목록·레시피·회의록, 노래 가사·시, 글자가 깨져 읽을 수 없는 글."));

    public OpenRouterLineDecider(ObjectMapper json, String model, String key, Duration timeout, int maxInFlight) {
        this.inFlight = new Semaphore(maxInFlight);
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
        this.model = model;
        this.key = key;
        this.timeout = timeout;
    }

    public String model() {
        return model;
    }

    @Override
    public LineReview.Decision decide(LineReview.Question question) {
        return parse(send(body(question)));
    }

    @Override
    public double speech(String text) {
        return speechConfidence(send(speechBody(text)));
    }

    @Override
    public Map<String, Double> role(SpeakerMerge.Candidate candidate, boolean reversed) {
        return roleProbabilities(send(roleBody(candidate, reversed)));
    }

    /** 배역 후보 질문 — 보기에 배역 정책(내레이션·가족·한 배우의 다른 역은 독립 배역)을 넣는다. */
    public ObjectNode roleBody(SpeakerMerge.Candidate candidate, boolean reversed) {
        ObjectNode body = json.createObjectNode().put("model", model).put("state", candidate.state());
        question(body.putObject("questions").putObject(SpeakerMerge.QUESTION), candidate.instructions(), candidate.choices(reversed));
        body.putObject("provider").put("data_collection", "deny");
        return body;
    }

    public static Map<String, Double> roleProbabilities(JsonNode response) {
        JsonNode probabilities = response.path("answers").path(SpeakerMerge.QUESTION).path("probabilities");
        if (!probabilities.isObject() || probabilities.isEmpty()) {
            throw new IllegalStateException("decision answer is missing");
        }
        Map<String, Double> out = new LinkedHashMap<>();
        probabilities.fields().forEachRemaining(entry -> out.put(entry.getKey(), entry.getValue().asDouble(0)));
        return out;
    }

    /** 글 앞 {@link ScriptSplitRules#SPEECH_STATE_CHARS}자만 보낸다 — 판단에는 앞부분이면 된다. */
    public ObjectNode speechBody(String text) {
        ObjectNode body = json.createObjectNode().put("model", model)
                .put("state", text.substring(0, text.offsetByCodePoints(0, Math.min(text.codePointCount(0, text.length()), ScriptSplitRules.SPEECH_STATE_CHARS))));
        question(body.putObject("questions").putObject(SPEECH_QUESTION), SPEECH_INSTRUCTIONS, SPEECH_CHOICES);
        body.putObject("provider").put("data_collection", "deny");
        return body;
    }

    public static double speechConfidence(JsonNode response) {
        LineReview.Answer answer = answer(response.path("answers").path(SPEECH_QUESTION));
        if (answer == null) {
            throw new IllegalStateException("decision answer is missing");
        }
        return answer.choice().equals("speech") ? answer.confidence() : 0;
    }

    /** 요청 본문. 모델에는 창 글과 보기만 간다 — 지금 답·의심 사유는 보내지 않는다. */
    public ObjectNode body(LineReview.Question question) {
        ObjectNode body = json.createObjectNode().put("model", model).put("state", question.state());
        ObjectNode questions = body.putObject("questions");
        question(questions.putObject(LineReview.KIND_QUESTION), LineReview.KIND_INSTRUCTIONS, LineReview.KINDS);
        question(questions.putObject(LineReview.SPEAKER_QUESTION), LineReview.SPEAKER_INSTRUCTIONS, question.speakers());
        for (LineReview.Extra extra : question.extras()) {
            question(questions.putObject(extra.key()), extra.instructions(), extra.choices());
        }
        body.putObject("provider").put("data_collection", "deny");
        return body;
    }

    private static void question(ObjectNode node, String instructions, List<LineReview.Choice> choices) {
        node.put("type", "choice").put("instructions", instructions);
        ObjectNode criteria = node.putObject("criteria");
        for (LineReview.Choice choice : choices) {
            criteria.putObject(choice.value()).put("label", choice.label()).put("description", choice.description());
        }
    }

    public JsonNode send(ObjectNode body) {
        RuntimeException last = null;
        for (int attempt = 0; attempt <= RETRIES; attempt++) {
            if (attempt > 0) {
                pause(Duration.ofSeconds(1L << (attempt - 1)));
            }
            try {
                HttpResponse<String> response;
                inFlight.acquire();
                try {
                    response = http.send(HttpRequest.newBuilder(URL).timeout(timeout)
                            .header("Authorization", "Bearer " + key).header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body), StandardCharsets.UTF_8)).build(),
                            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                } finally {
                    inFlight.release();
                }
                if (response.statusCode() == 200) {
                    return json.readTree(response.body());
                }
                last = new IllegalStateException("decision HTTP " + response.statusCode());
                if (response.statusCode() != 429 && response.statusCode() < 500) {
                    throw last;
                }
            } catch (IOException failure) {
                last = new IllegalStateException("decision call failed: " + failure.getClass().getSimpleName(), failure);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("decision call was interrupted", interrupted);
            }
        }
        throw last;
    }

    public static LineReview.Decision parse(JsonNode response) {
        JsonNode answers = response.path("answers");
        Map<String, LineReview.Answer> extras = new LinkedHashMap<>();
        answers.fieldNames().forEachRemaining(key -> {
            LineReview.Answer answer = answer(answers.path(key));
            if (!key.equals(LineReview.KIND_QUESTION) && !key.equals(LineReview.SPEAKER_QUESTION) && answer != null) {
                extras.put(key, answer);
            }
        });
        return new LineReview.Decision(answer(answers.path(LineReview.KIND_QUESTION)), answer(answers.path(LineReview.SPEAKER_QUESTION)), extras);
    }

    private static LineReview.Answer answer(JsonNode node) {
        if (!node.hasNonNull("choice")) {
            return null;
        }
        String choice = node.get("choice").asText();
        JsonNode confidence = node.hasNonNull("confidence") ? node.get("confidence") : node.path("probabilities").path(choice);
        return new LineReview.Answer(choice, confidence.asDouble(0));
    }

    private static void pause(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("decision retry was interrupted", interrupted);
        }
    }
}
