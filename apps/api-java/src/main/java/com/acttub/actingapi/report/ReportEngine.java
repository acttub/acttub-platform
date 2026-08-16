package com.acttub.actingapi.report;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.integration.llm.TextGenerator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

/** acting-report 엔진: 차단 판정, Python식 입력 직렬화, 출력 파싱을 한 경계에 둔다. */
@Service
public class ReportEngine {

    private static final Pattern FENCED_JSON = Pattern.compile(
            "^```(?:json)?\\s*([\\s\\S]*?)\\s*```$", Pattern.CASE_INSENSITIVE);
    private static final String BLOCKED_ANALYSIS_REASON =
            "confirmed_analysis_handoff_required";
    private static final String BLOCKED_EXPRESSION_REASON =
            "confirmed_expression_handoff_required";

    private static final Set<String> ANALYSIS_FIELDS = Set.of(
            "report_type", "title", "actor_discovery", "line_meaning",
            "timing_reason", "target_effect", "next_take", "acting_caution",
            "evidence", "uncertainties", "source_handoff_id");
    private static final Set<String> EXPRESSION_FIELDS = Set.of(
            "report_type", "title", "blocked_point", "expression_core",
            "line_meaning", "timing_reason", "playable_action", "effective_experiment",
            "observed_change", "next_take", "acting_trap", "actor_training",
            "evidence", "actor_words", "uncertainties", "source_handoff_ids");

    private final TextGenerator generate;
    private final ObjectMapper mapper;

    public ReportEngine(TextGenerator generate, ObjectMapper mapper) {
        this.generate = generate;
        this.mapper = mapper;
    }

    public JsonNode generateReport(
            String reportType,
            JsonNode videoSummary,
            JsonNode confirmedHandoff,
            boolean confirmed,
            String coachingHandoffId,
            JsonNode analysisHandoff,
            String analysisHandoffId) {
        JsonNode modelInput = buildReportInput(
                reportType,
                videoSummary,
                confirmedHandoff,
                confirmed,
                coachingHandoffId,
                analysisHandoff);
        if (modelInput == null) {
            return blockedReport(reportType);
        }
        String raw = generate.generate(
                ReportPrompt.select(reportType), serializeInput(modelInput)).text();
        return parseReport(raw, reportType, coachingHandoffId, analysisHandoffId);
    }

    public JsonNode buildReportInput(
            String reportType,
            JsonNode videoSummary,
            JsonNode confirmedHandoff,
            boolean confirmed,
            String coachingHandoffId,
            JsonNode analysisHandoff) {
        if (!confirmed || confirmedHandoff == null || !confirmedHandoff.isObject()) {
            return null;
        }
        ObjectNode confirmation = mapper.createObjectNode();
        confirmation.put("confirmed", true);
        confirmation.put("coaching_handoff_id", coachingHandoffId);

        ObjectNode input = mapper.createObjectNode();
        input.set("video_summary", normalizeObservationPack(videoSummary));
        input.set("confirmed_handoff", confirmedHandoff.deepCopy());
        if ("analysis".equals(reportType)) {
            input.set("confirmation", confirmation);
            return input;
        }
        if (!"expression".equals(reportType)) {
            throw new IllegalArgumentException("unsupported report type: " + reportType);
        }
        if (!expressionReady(confirmedHandoff)) {
            return null;
        }
        input.set("analysis_handoff", analysisHandoff == null
                ? mapper.nullNode()
                : analysisHandoff.deepCopy());
        input.set("expression_handoff", confirmedHandoff.deepCopy());
        input.set("confirmation", confirmation);
        return input;
    }

    /** Python {@code json.dumps(..., ensure_ascii=False, indent=2)}와 같은 문자열. */
    public String serializeInput(JsonNode input) {
        StringBuilder output = new StringBuilder();
        appendPythonJson(output, input, 0);
        return output.toString();
    }

    public JsonNode parseReport(
            String rawText,
            String reportType,
            String sourceHandoffId,
            String analysisHandoffId) {
        String original = rawText.strip();
        Matcher fenced = FENCED_JSON.matcher(original);
        String jsonText = fenced.matches() ? fenced.group(1).strip() : original;
        if (jsonText.isEmpty()) {
            throw new ReportParseError(PythonJsonDecodeError.expectingValueAtStart());
        }
        JsonNode parsed;
        try {
            parsed = mapper.readTree(jsonText);
        } catch (JsonProcessingException exception) {
            throw new ReportParseError(
                    PythonJsonDecodeError.format(exception, jsonText), exception);
        }
        if (parsed == null || !parsed.isObject()) {
            throw new ReportParseError("report response is not an object");
        }
        ObjectNode candidate = (ObjectNode) parsed;
        try {
            if ("blocked".equals(candidate.path("report_type").asText())) {
                validateBlocked(candidate);
                return candidate;
            }
            if ("analysis".equals(reportType)) {
                candidate.put("source_handoff_id", sourceHandoffId);
                validateAnalysis(candidate);
                return candidate;
            }
            candidate.set("source_handoff_ids", mapper.createObjectNode()
                    .put("analysis", analysisHandoffId)
                    .put("expression", sourceHandoffId));
            validateExpression(candidate);
            return candidate;
        } catch (IllegalArgumentException exception) {
            throw new ReportParseError(exception.getMessage(), exception);
        }
    }

    private ObjectNode normalizeObservationPack(JsonNode value) {
        if (value == null || !value.isObject()) {
            throw new IllegalArgumentException("video_summary must be an object");
        }
        ArrayNode normalizedObservations = mapper.createArrayNode();
        JsonNode observations = value.get("observations");
        if (observations != null) {
            require(observations.isArray(), "observations must be an array");
            observations.forEach(item -> {
                require(item.isObject(), "observation must be an object");
                ObjectNode normalized = mapper.createObjectNode();
                normalized.put("start_ms", integral(item.get("start_ms"), "start_ms"));
                normalized.put("end_ms", integral(item.get("end_ms"), "end_ms"));
                normalized.put("label", text(item.get("label"), "label"));
                JsonNode confidence = item.get("confidence");
                require(confidence != null && confidence.isNumber(), "confidence must be a number");
                normalized.put("confidence", confidence.doubleValue());
                normalizedObservations.add(normalized);
            });
        }
        ArrayNode normalizedUncertainties = mapper.createArrayNode();
        JsonNode uncertainties = value.get("uncertainties");
        if (uncertainties != null) {
            require(uncertainties.isArray(), "uncertainties must be an array");
            uncertainties.forEach(item -> normalizedUncertainties.add(text(item, "uncertainty")));
        }
        ObjectNode pack = mapper.createObjectNode();
        pack.set("observations", normalizedObservations);
        pack.set("uncertainties", normalizedUncertainties);
        return pack;
    }

    private static boolean expressionReady(JsonNode handoff) {
        JsonNode experiment = handoff.get("experiment");
        JsonNode observed = handoff.get("observed_change");
        return experiment != null
                && experiment.isObject()
                && experiment.path("tested").isBoolean()
                && experiment.path("tested").booleanValue()
                && nonBlankText(experiment.get("instruction"))
                && nonBlankText(observed);
    }

    private void validateBlocked(ObjectNode report) {
        exactFields(report, Set.of("report_type", "reason"));
        exactText(report, "report_type", "blocked");
        String reason = text(report.get("reason"), "reason");
        require(Set.of(BLOCKED_ANALYSIS_REASON, BLOCKED_EXPRESSION_REASON).contains(reason),
                "invalid blocked report reason");
    }

    private void validateAnalysis(ObjectNode report) {
        exactFields(report, ANALYSIS_FIELDS);
        exactText(report, "report_type", "analysis");
        for (String field : List.of(
                "title", "actor_discovery", "line_meaning", "timing_reason",
                "target_effect", "acting_caution", "source_handoff_id")) {
            text(report.get(field), field);
        }
        ObjectNode next = object(report.get("next_take"), "next_take");
        exactFields(next, Set.of("direction", "tested"));
        text(next.get("direction"), "next_take.direction");
        exactBoolean(next, "tested", false);
        stringArray(report.get("evidence"), "evidence");
        stringArray(report.get("uncertainties"), "uncertainties");
    }

    private void validateExpression(ObjectNode report) {
        exactFields(report, EXPRESSION_FIELDS);
        exactText(report, "report_type", "expression");
        for (String field : List.of(
                "title", "blocked_point", "expression_core", "line_meaning",
                "timing_reason", "playable_action", "observed_change", "next_take",
                "acting_trap")) {
            text(report.get(field), field);
        }
        ObjectNode experiment = object(report.get("effective_experiment"), "effective_experiment");
        exactFields(experiment, Set.of("instruction", "tested"));
        text(experiment.get("instruction"), "effective_experiment.instruction");
        exactBoolean(experiment, "tested", true);

        ObjectNode training = object(report.get("actor_training"), "actor_training");
        exactFields(training, Set.of(
                "title", "purpose", "duration_minutes", "steps", "focus",
                "success_check", "tested"));
        for (String field : List.of("title", "purpose", "focus", "success_check")) {
            text(training.get(field), "actor_training." + field);
        }
        JsonNode duration = training.get("duration_minutes");
        require(duration != null && duration.isNumber(), "actor_training.duration_minutes must be a number");
        stringArray(training.get("steps"), "actor_training.steps");
        exactBoolean(training, "tested", false);

        stringArray(report.get("evidence"), "evidence");
        stringArray(report.get("actor_words"), "actor_words");
        stringArray(report.get("uncertainties"), "uncertainties");
        ObjectNode ids = object(report.get("source_handoff_ids"), "source_handoff_ids");
        exactFields(ids, Set.of("analysis", "expression"));
        JsonNode analysis = ids.get("analysis");
        require(analysis != null && (analysis.isNull() || analysis.isTextual()),
                "source_handoff_ids.analysis must be a string or null");
        text(ids.get("expression"), "source_handoff_ids.expression");
    }

    private void appendPythonJson(StringBuilder output, JsonNode value, int depth) {
        if (value.isObject()) {
            if (value.isEmpty()) {
                output.append("{}");
                return;
            }
            output.append("{\n");
            List<String> fields = new ArrayList<>();
            value.fieldNames().forEachRemaining(fields::add);
            for (int index = 0; index < fields.size(); index++) {
                String field = fields.get(index);
                indent(output, depth + 1);
                output.append(jsonString(field)).append(": ");
                appendPythonJson(output, value.get(field), depth + 1);
                output.append(index + 1 == fields.size() ? '\n' : ",\n");
            }
            indent(output, depth);
            output.append('}');
            return;
        }
        if (value.isArray()) {
            if (value.isEmpty()) {
                output.append("[]");
                return;
            }
            output.append("[\n");
            for (int index = 0; index < value.size(); index++) {
                indent(output, depth + 1);
                appendPythonJson(output, value.get(index), depth + 1);
                output.append(index + 1 == value.size() ? '\n' : ",\n");
            }
            indent(output, depth);
            output.append(']');
            return;
        }
        if (value.isTextual()) {
            output.append(jsonString(value.textValue()));
            return;
        }
        output.append(value.toString());
    }

    private String jsonString(String value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("failed to serialize report input string", exception);
        }
    }

    private static void indent(StringBuilder output, int depth) {
        output.append("  ".repeat(depth));
    }

    private static long integral(JsonNode value, String field) {
        require(value != null && value.isNumber() && value.doubleValue() == value.longValue(),
                field + " must be an integer");
        return value.longValue();
    }

    private static ObjectNode object(JsonNode value, String field) {
        require(value != null && value.isObject(), field + " must be an object");
        return (ObjectNode) value;
    }

    private static String text(JsonNode value, String field) {
        require(value != null && value.isTextual(), field + " must be a string");
        return value.textValue();
    }

    private static boolean nonBlankText(JsonNode value) {
        return value != null && value.isTextual() && !value.textValue().strip().isEmpty();
    }

    private static void exactText(ObjectNode object, String field, String expected) {
        require(expected.equals(text(object.get(field), field)), field + " must be " + expected);
    }

    private static void exactBoolean(ObjectNode object, String field, boolean expected) {
        JsonNode value = object.get(field);
        require(value != null && value.isBoolean() && value.booleanValue() == expected,
                field + " must be " + expected);
    }

    private static void stringArray(JsonNode value, String field) {
        require(value != null && value.isArray(), field + " must be an array");
        value.forEach(item -> text(item, field + " item"));
    }

    private static void exactFields(ObjectNode value, Set<String> expected) {
        Set<String> actual = new LinkedHashSet<>();
        value.fieldNames().forEachRemaining(actual::add);
        require(actual.equals(expected), "report fields do not match schema");
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalArgumentException(message);
        }
    }

    /** 갈래별 차단 노트. 리포트를 만들지 않기로 한 자리에서 이 값을 그대로 쓴다. */
    public ObjectNode blockedReport(String reportType) {
        return blocked("expression".equals(reportType)
                ? BLOCKED_EXPRESSION_REASON
                : BLOCKED_ANALYSIS_REASON);
    }

    private ObjectNode blocked(String reason) {
        return mapper.createObjectNode()
                .put("report_type", "blocked")
                .put("reason", reason);
    }
}
