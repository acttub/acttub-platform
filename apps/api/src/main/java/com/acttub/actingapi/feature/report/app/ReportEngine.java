package com.acttub.actingapi.feature.report.app;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.feature.report.domain.ExpressionReadiness;
import com.acttub.actingapi.feature.report.domain.ReportBranch;
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
        if (ReportBranch.isAnalysis(reportType)) {
            input.set("confirmation", confirmation);
            return input;
        }
        if (!ReportBranch.isExpression(reportType)) {
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
            if (ReportBranch.isBlocked(candidate.path("report_type").asText())) {
                validateBlocked(candidate);
                return candidate;
            }
            if (ReportBranch.isAnalysis(reportType)) {
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
                // 관찰 본문은 `what` 이다(SOMA-490). 옛 요약 행은 `label` 로 남아 있어 둘 다 받는다.
                JsonNode what = item.has("what") ? item.get("what") : item.get("label");
                normalized.put("what", text(what, "what"));
                // 대사 원문과 어느 축의 관찰인지는 연습 노트가 순간을 가리킬 때 쓴다 —
                // 있는 것을 여기서 버리면 노트도 시각으로만 순간을 가리키게 된다.
                copyText(item, "quote", normalized);
                copyText(item, "dimension", normalized);
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
        // 장면이 무슨 이야기인지가 먼저다 — 구간 관찰만으로는 노트가 장면을 통째로 알지
        // 못한다(SOMA-490). 옛 요약 행에는 이 칸이 없어 있을 때만 싣는다.
        copyText(value, "scene_summary", pack);
        pack.set("observations", normalizedObservations);
        pack.set("uncertainties", normalizedUncertainties);
        return pack;
    }

    /** 있으면 문자열로 옮기고, 없으면 칸 자체를 만들지 않는다. */
    private static void copyText(JsonNode source, String field, ObjectNode target) {
        JsonNode value = source.get(field);
        if (value != null && value.isTextual()) {
            target.put(field, value.textValue());
        }
    }

    /** 핸드오프 JSON 에서 판정에 쓰는 셋을 꺼내 규칙에 넘긴다. 판정 자체는 domain 이 한다. */
    private static boolean expressionReady(JsonNode handoff) {
        JsonNode experiment = handoff.get("experiment");
        boolean hasExperiment = experiment != null && experiment.isObject();
        Boolean tested = hasExperiment && experiment.path("tested").isBoolean()
                ? experiment.path("tested").booleanValue()
                : null;
        return ExpressionReadiness.playable(
                tested,
                hasExperiment ? textOrNull(experiment.get("instruction")) : null,
                textOrNull(handoff.get("observed_change")));
    }

    private static String textOrNull(JsonNode value) {
        return value != null && value.isTextual() ? value.textValue() : null;
    }

    private void validateBlocked(ObjectNode report) {
        exactFields(report, Set.of("report_type", "reason"));
        exactText(report, "report_type", ReportBranch.BLOCKED);
        String reason = text(report.get("reason"), "reason");
        require(ReportBranch.isKnownBlockedReason(reason), "invalid blocked report reason");
    }

    private void validateAnalysis(ObjectNode report) {
        exactFields(report, ANALYSIS_FIELDS);
        exactText(report, "report_type", ReportBranch.ANALYSIS);
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
        exactText(report, "report_type", ReportBranch.EXPRESSION);
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
        return mapper.createObjectNode()
                .put("report_type", ReportBranch.BLOCKED)
                .put("reason", ReportBranch.blockedReason(reportType));
    }
}
