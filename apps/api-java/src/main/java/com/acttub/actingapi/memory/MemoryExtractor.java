package com.acttub.actingapi.memory;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.coach.CoachValidation;
import com.acttub.actingapi.coach.CoachValidator;
import com.acttub.actingapi.web.PythonText;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 연습 하나에서 배우 기억 4칸을 뽑아낸다 (`acting-agent/memory_extract.py`).
 *
 * <p><b>성별·나이는 쓰지 않는다.</b> 영상이나 말투에서 추론하는 순간 틀릴 수 있고, 틀린
 * 채로 다음 연습의 전제가 된다.
 *
 * <p><b>뽑아낸 값도 대화와 같은 검사를 통과해야 한다.</b> 기억은 다음 요청의 입력이라
 * 여기가 뚫리면 코치 대화에 걸어둔 검사가 통째로 우회된다. 통과 못 한 칸은 버리고 이전
 * 값을 그대로 둔다 — 빈 값으로 밀어내면 배우가 쓴 것까지 사라진다.
 */
public final class MemoryExtractor {
    private static final Logger LOG = LoggerFactory.getLogger(MemoryExtractor.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 에이전트가 손대는 칸. 성별·나이는 배우 전용이라 여기 없다. */
    static final List<String> AGENT_WRITABLE_FIELDS =
            List.of("goal", "blockage", "speech_self", "speech_actual");

    /** 저장 계층의 길이 상한과 같은 값. 넘으면 저장이 거부되므로 여기서 미리 버린다. */
    static final int VALUE_MAX_LENGTH = 1000;

    /** 목표 칸에서만 통과시키는 결과 어휘 (`acting-llm/forbidden.py:ACTOR_GOAL_ALLOWED`). */
    private static final List<String> ACTOR_GOAL_ALLOWED = List.of("합격");

    private static final Pattern FENCED_JSON =
            Pattern.compile("^```(?:json)?\\s*(.*?)\\s*```$", Pattern.DOTALL);

    private static final LinkedHashMap<String, String> FIELD_LABELS = new LinkedHashMap<>();

    static {
        FIELD_LABELS.put("goal", "목표");
        FIELD_LABELS.put("blockage", "막히는 지점");
        FIELD_LABELS.put("speech_self", "본인이 생각하는 화법");
        FIELD_LABELS.put("speech_actual", "실제로 말하는 화법");
    }

    static final String SYSTEM_PROMPT = """
            너는 배우의 연습 기록을 정리하는 사람이다.

            방금 끝난 연습 하나를 읽고, 배우에 대해 **다음 연습까지 가져갈 만한 것**만 골라
            적는다. 아래를 지킨다.

            - **근거가 있는 칸만 적는다.** 이번 연습에서 새로 알게 된 것이 없는 칸은 아예 빼라.
              빈 문자열도 적지 마라. 칸을 빼는 것이 정상이다.
            - **판정하지 말고 인용하라.** "말이 빠르다", "뻣뻣하다" 처럼 네가 내린 평가는 적지
              않는다. 배우가 한 말과 실제 대사를 그대로 옮겨 차이가 드러나게만 한다.
            - **약점·개선점 같은 말을 쓰지 않는다.** 배우를 깎는 말, 마음 상태를 단정하는 말도
              쓰지 않는다.
            - 각 칸은 200자를 넘기지 않는다.
            - 성별과 나이는 **절대 적지 않는다.** 배우가 직접 입력하는 칸이다.

            아래 JSON 만 출력한다. 적을 칸이 없으면 {} 를 출력한다.

            {"goal": "...", "blockage": "...", "speech_self": "...", "speech_actual": "..."}
            """;

    private MemoryExtractor() {
    }

    static String buildExtractionPrompt(
            MemoryStore.MemoryUpdateMaterial material, Map<String, String> existing) {
        List<String> lines = new ArrayList<>();
        lines.add("[이번 연습]");
        lines.add("- 배우가 적은 목표: " + material.goal());
        lines.add("- 배우가 고른 막히는 지점: "
                + material.blockageKind() + " / " + material.subBranch());
        if (material.blockageDetail() != null && !material.blockageDetail().isEmpty()) {
            lines.add("- 배우가 덧붙인 설명: " + material.blockageDetail());
        }
        if (!material.transcripts().isEmpty()) {
            lines.add("");
            lines.add("[영상에서 받아쓴 실제 대사]");
            material.transcripts().forEach(text -> lines.add("- " + text));
        }
        if (!material.actorMessages().isEmpty()) {
            lines.add("");
            lines.add("[대화에서 배우가 한 말]");
            material.actorMessages().forEach(text -> lines.add("- " + text));
        }
        lines.add("");
        lines.add("[지금까지 쌓인 기억]");
        if (existing.isEmpty()) {
            lines.add("- (아직 없음)");
        } else {
            for (String name : AGENT_WRITABLE_FIELDS) {
                String value = existing.get(name);
                if (value != null && !value.isEmpty()) {
                    lines.add("- " + FIELD_LABELS.get(name) + ": " + value);
                }
            }
        }
        lines.add("");
        lines.add("달라진 칸만 JSON 으로 출력하라.");
        return String.join("\n", lines);
    }

    /**
     * 대화와 같은 검사를 걸되, <b>목표 칸에서만 결과 어휘를 통과시킨다.</b>
     *
     * <p>"합격" 은 코치가 말하면 판정이지만 배우가 자기 목표로 말하면 그냥 그 배우의 말이다.
     * 그 밖의 실패(판정 어휘·타임코드 등)는 목표 칸에서도 그대로 막는다.
     */
    private static List<String> languageFailures(String name, String text) {
        CoachValidation validation = CoachValidator.validateTurn(text, false);
        if (validation.failures().isEmpty()) {
            return List.of();
        }
        if (!"goal".equals(name)) {
            return validation.failures();
        }
        List<String> remaining = validation.forbiddenHits().stream()
                .filter(hit -> !ACTOR_GOAL_ALLOWED.contains(hit))
                .toList();
        if (!remaining.isEmpty()) {
            return validation.failures();
        }
        // 금지어 말고 다른 사유(타임코드 등)가 남았는지 본다.
        return validation.checks().entrySet().stream()
                .filter(entry -> !entry.getValue())
                .map(Map.Entry::getKey)
                .filter(key -> !"forbidden_language".equals(key))
                .toList();
    }

    private static JsonNode parse(String rawText) {
        String text = PythonText.strip(rawText == null ? "" : rawText);
        Matcher fenced = FENCED_JSON.matcher(text);
        if (fenced.matches()) {
            text = PythonText.strip(fenced.group(1));
        }
        try {
            JsonNode candidate = MAPPER.readTree(text);
            return candidate != null && candidate.isObject() ? candidate : MAPPER.createObjectNode();
        } catch (JsonProcessingException notJson) {
            return MAPPER.createObjectNode();
        }
    }

    /**
     * 이번 연습에서 달라진 기억 칸만 돌려준다.
     *
     * <p>모델이 형식을 어기거나 아무것도 못 찾아도 예외를 내지 않는다 — 기억 갱신이
     * 실패했다고 연습이 실패하면 안 된다.
     */
    public static Map<String, String> extract(
            MemoryStore.MemoryUpdateMaterial material,
            Map<String, String> existing,
            java.util.function.BiFunction<String, String, String> generate) {
        String rawText = generate.apply(SYSTEM_PROMPT, buildExtractionPrompt(material, existing));
        JsonNode candidate = parse(rawText);

        Map<String, String> updates = new LinkedHashMap<>();
        Map<String, String> rejected = new LinkedHashMap<>();

        candidate.fieldNames().forEachRemaining(name -> {
            if ("gender".equals(name) || "age".equals(name)) {
                rejected.put(name, "배우 전용 칸");
                return;
            }
            if (!AGENT_WRITABLE_FIELDS.contains(name)) {
                return;
            }
            JsonNode value = candidate.get(name);
            if (!value.isTextual()) {
                rejected.put(name, "문자열이 아님");
                return;
            }
            String text = PythonText.strip(value.asText());
            if (text.isEmpty()) {
                rejected.put(name, "빈 값");
                return;
            }
            if (text.codePointCount(0, text.length()) > VALUE_MAX_LENGTH) {
                rejected.put(name, "길이 상한 초과");
                return;
            }
            if (text.equals(existing.get(name))) {
                return;
            }
            List<String> failures = languageFailures(name, text);
            if (!failures.isEmpty()) {
                rejected.put(name, "검사 실패: " + String.join(", ", failures));
                return;
            }
            updates.put(name, text);
        });

        if (!rejected.isEmpty()) {
            // 조용히 사라지면 나중에 "왜 안 쌓이지" 를 추적할 방법이 없다.
            LOG.info("기억 갱신에서 걸러낸 칸: {}", rejected);
        }
        return updates;
    }
}
