package com.acttub.actingapi.feature.coach.app;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** acting-agent/prompt.py의 프롬프트와 입력 직렬화 계약. */
public final class CoachPrompt {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final String COACH_V2_PROMPT = load("/coach/coach-v2-prompt.txt");
    private static final String COACH_V3_PROMPT = load("/coach/coach-v3-prompt.txt");
    private static final String SAFE_TEMPLATE =
            "방금 말한 지점에서 하나만 더 볼게. "
                    + "이 말을 상대에게 건넬 때, 상대가 어떻게 되길 바라는 거야?";

    private static final int TURN_BUDGET = 8;
    private static final int OPEN_UNTIL = 3;
    private static final int NARROW_UNTIL = 6;
    private static final List<String> ANALYSIS_PHASES = List.of(
            "1~3번째 응답: 여는 구간",
            "4~6번째 응답: 좁히는 구간",
            "7번째 응답: 닫기 직전",
            "8번째 응답: 마지막 응답");
    private static final List<String> EXPRESSION_PHASES = List.of(
            "1~3번째 응답: 문제 확인 구간",
            "4~6번째 응답: 실험과 조정 구간",
            "7번째 응답: 방향 선택 구간",
            "8번째 응답: 마지막 응답");

    /**
     * 지난 것을 담는 칸의 상한. 넘으면 앞에서부터 자른다 — 지난 연습이 길다고 이번
     * 대화의 예산을 밀어내면 안 된다.
     */
    private static final int PRIOR_CONTEXT_MAX_CHARS = 1200;

    /** 순서가 프롬프트에 그대로 나간다 (`prompt.py:_MEMORY_LABELS`). */
    private static final java.util.LinkedHashMap<String, String> MEMORY_LABELS =
            new java.util.LinkedHashMap<>();

    static {
        MEMORY_LABELS.put("gender", "성별");
        MEMORY_LABELS.put("age", "나이");
        MEMORY_LABELS.put("goal", "배우가 말한 목표");
        MEMORY_LABELS.put("blockage", "배우가 반복해서 고른 막히는 지점");
        MEMORY_LABELS.put("speech_self", "배우가 스스로 말하는 자기 화법");
        MEMORY_LABELS.put("speech_actual", "실제로 말한 방식");
    }

    private CoachPrompt() {
    }

    /**
     * 지난 것을 프롬프트에 넣는다 (`prompt.py:_prior_context_block`).
     *
     * <p><b>없으면 칸 자체를 만들지 않는다</b> — 빈 제목만 남기면 모델이 그 자리를 지어내
     * 채운다. 첫 연습에서는 지금까지와 똑같은 프롬프트가 나가야 한다.
     */
    static String priorContextBlock(PriorContext prior) {
        if (prior == null || prior.isEmpty()) {
            return "";
        }
        List<String> lines = new ArrayList<>();
        lines.add("## 배우에 대해 지금까지 알고 있는 것");
        lines.add("지난 연습에서 정리된 참고 사항이다. **영상 근거가 아니다** — 이걸로 이번"
                + " 영상의 장면을 말하지 않는다. 배우가 지난번에 한 말이므로 그대로 읊지 말고,"
                + " 이번 대화에서 확인할 거리로만 쓴다.");

        if (!prior.memory().isEmpty()) {
            lines.add("");
            MEMORY_LABELS.forEach((name, label) -> {
                String value = prior.memory().get(name);
                if (value != null && !value.isEmpty()) {
                    lines.add("- " + label + ": " + value);
                }
            });
        }

        if (prior.earlierConversation() != null) {
            lines.add("");
            lines.add("### 같은 연습에서 지난번에 나눈 이야기");
            lines.add(prior.earlierConversation());
        }

        if (!prior.pendingTakes().isEmpty()) {
            lines.add("");
            lines.add("### 지난 연습에서 해보기로 했지만 아직 안 해본 것");
            prior.pendingTakes().forEach(take -> lines.add("- " + take));
            lines.add("해봤는지 이번 대화에서 물어볼 수 있다. 다만 안 했다고 다그치지 않는다.");
        }

        return clip(String.join("\n", lines), PRIOR_CONTEXT_MAX_CHARS) + "\n\n";
    }

    /** 파이썬 {@code _clip}: 코드포인트 기준으로 세고 자른 뒤 rstrip + 말줄임표. */
    private static String clip(String text, int budget) {
        int length = text.codePointCount(0, text.length());
        if (length <= budget) {
            return text;
        }
        int end = text.offsetByCodePoints(0, Math.max(0, budget - 1));
        return com.acttub.actingapi.platform.web.PythonText.rstrip(text.substring(0, end)) + "…";
    }

    public static String select(String blockageKind) {
        return "표현".equals(blockageKind) ? COACH_V3_PROMPT : COACH_V2_PROMPT;
    }

    public static String buildChat(
            CoachSessionSnapshot session, String userMessage) {
        List<CoachTurnSnapshot> turns = session.turns();
        List<CoachTurnSnapshot> recentTurns = turns.subList(
                Math.max(0, turns.size() - 8), turns.size());
        String history = turnLines(recentTurns);
        if (history.isEmpty()) {
            history = "이전 대화 없음";
        }
        String conversationSummary = empty(session.conversationSummary())
                ? "아직 없음"
                : session.conversationSummary();
        String detail = session.blockageDetail() == null ? "" : session.blockageDetail();
        String transcriptBlock = "";
        if ("분석".equals(session.blockageKind()) && !session.transcripts().isEmpty()) {
            String transcriptLines = session.transcripts().stream()
                    .map(text -> "- " + text)
                    .collect(java.util.stream.Collectors.joining("\n"));
            transcriptBlock = "\n## 영상에서 받아쓴 대사\n" + transcriptLines + "\n";
        }

        return priorContextBlock(session.prior())
                + "## 배우가 쓴 것\n"
                + "- 상황: " + session.situation() + "\n"
                + "- 캐릭터: " + session.characterContext() + "\n"
                + "- 이번 테이크의 목적: " + session.goal() + "\n"
                + "- 배우가 고른 막히는 지점: " + session.blockageKind() + "\n"
                + "- 하위 갈래: " + session.subBranch() + "\n"
                + "- 배우가 쓴 상세: " + detail + "\n"
                + "- 영상 길이: " + session.durationMs() + "ms\n"
                + transcriptBlock + "\n\n"
                + "## 영상에서 확인된 것\n"
                + "이 팩만 영상 근거로 쓴다. 이 호출에는 영상이 첨부되지 않았고 새 영상 사실을 만들면 안 된다.\n"
                + videoFacts(session) + "\n\n"
                + "## 지금까지\n" + conversationSummary + "\n\n"
                + "## 최근 대화\n" + history + "\n\n"
                + analysisHandoffBlock(session)
                + expressionInputBlock(session)
                + "## 배우의 최신 말\n" + userMessage + "\n\n"
                + turnBudgetBlock(session);
    }

    public static String buildRegeneration(
            CoachSessionSnapshot session,
            String userMessage,
            String failedRawText,
            List<String> failures) {
        List<String> numbered = new ArrayList<>();
        for (int index = 0; index < failures.size(); index++) {
            numbered.add((index + 1) + ". " + failures.get(index));
        }
        return buildChat(session, userMessage)
                + "\n\n## 서버 검증 실패 — 아래 걸린 부분만 고쳐 같은 JSON 구조로 다시 낸다\n"
                + String.join("\n", numbered)
                + "\n\n## 노출하지 않은 실패 응답\n"
                + failedRawText;
    }

    public static String safeTemplate() {
        return SAFE_TEMPLATE;
    }

    private static String turnLines(List<CoachTurnSnapshot> turns) {
        return turns.stream()
                .map(turn -> ("actor".equals(turn.role()) ? "배우" : "코치")
                        + ": " + turn.text())
                .collect(java.util.stream.Collectors.joining("\n"));
    }

    private static String videoFacts(CoachSessionSnapshot session) {
        JsonNode pack = session.observationPack();
        if (pack == null || pack.isNull()) {
            return "아직 영상에서 확인된 것이 없다. 영상 이야기를 만들지 마라.";
        }
        JsonNode observations = pack.get("observations");
        JsonNode uncertainties = pack.get("uncertainties");
        if (observations == null || !observations.isArray() || observations.isEmpty()) {
            String uncertaintyText = joinText(uncertainties, " / ");
            if (uncertaintyText.isEmpty()) {
                uncertaintyText = "없음";
            }
            return "관찰 0개. 이것은 정상이며 영상 이야기를 새로 만들면 안 된다.\n"
                    + "불확실: " + uncertaintyText;
        }
        List<String> lines = new ArrayList<>();
        observations.forEach(item -> lines.add(
                "- " + item.path("start_ms").asLong()
                        + "~" + item.path("end_ms").asLong() + "ms: "
                        + pythonString(item.get("label"))
                        + " (확인 가능성 " + pythonString(item.get("confidence")) + ")"));
        String uncertaintyText = joinText(uncertainties, " / ");
        if (!uncertaintyText.isEmpty()) {
            lines.add("확인되지 않은 것: " + uncertaintyText);
        }
        return String.join("\n", lines);
    }

    private static String analysisHandoffBlock(CoachSessionSnapshot session) {
        JsonNode handoff = session.analysisHandoff();
        if (!"표현".equals(session.blockageKind()) || handoff == null || handoff.isNull()) {
            return "";
        }
        String evidenceLines = indentedItems(handoff.get("scene_evidence"));
        String actorWordLines = indentedItems(handoff.get("actor_words"));
        return "## 이전 분석 세션에서 전달받은 입력 정보\n"
                + "- blocked_point: " + pythonString(handoff.get("blocked_point")) + "\n"
                + "- line_meaning: " + pythonString(handoff.get("line_meaning")) + "\n"
                + "- timing_reason: " + pythonString(handoff.get("timing_reason")) + "\n"
                + "- target_effect: " + pythonString(handoff.get("target_effect")) + "\n"
                + "- scene_evidence:\n" + evidenceLines + "\n"
                + "- actor_words:\n" + actorWordLines + "\n\n";
    }

    private static String expressionInputBlock(CoachSessionSnapshot session) {
        JsonNode pack = session.observationPack();
        JsonNode observations = pack == null ? null : pack.get("observations");
        if (!"표현".equals(session.blockageKind())
                || observations == null
                || !observations.isArray()
                || observations.isEmpty()) {
            return "";
        }
        List<String> lines = new ArrayList<>();
        observations.forEach(observation -> lines.add("  - " + compactJson(observation)));
        String heading = session.analysisHandoff() == null || session.analysisHandoff().isNull()
                ? "## 표현 세션 입력 정보\n"
                : "";
        return heading + "- video_observations:\n" + String.join("\n", lines) + "\n\n";
    }

    private static String phaseLabel(int turnNumber, String blockageKind) {
        List<String> phases = "표현".equals(blockageKind)
                ? EXPRESSION_PHASES
                : ANALYSIS_PHASES;
        if (turnNumber <= OPEN_UNTIL) {
            return phases.get(0);
        }
        if (turnNumber <= NARROW_UNTIL) {
            return phases.get(1);
        }
        if (turnNumber < TURN_BUDGET) {
            return phases.get(2);
        }
        return phases.get(3);
    }

    private static String turnBudgetBlock(CoachSessionSnapshot session) {
        int turnNumber = (int) session.turns().stream()
                .filter(turn -> "ai".equals(turn.role()))
                .count() + 1;
        int left = Math.max(0, TURN_BUDGET - turnNumber);
        List<String> lines = new ArrayList<>(List.of(
                "## 남은 응답",
                "전체 응답 예산: " + TURN_BUDGET + "번",
                "현재 응답: " + turnNumber + "번째",
                "이번 응답 뒤에 남는 횟수: " + left + "번",
                "현재 구간: " + phaseLabel(turnNumber, session.blockageKind())));
        if (turnNumber >= TURN_BUDGET) {
            lines.add("이번이 마지막 응답이다.");
        }
        return String.join("\n", lines);
    }

    private static String indentedItems(JsonNode values) {
        if (values == null || !values.isArray() || values.isEmpty()) {
            return "  - 없음";
        }
        List<String> lines = new ArrayList<>();
        values.forEach(value -> lines.add("  - " + pythonString(value)));
        return String.join("\n", lines);
    }

    private static String joinText(JsonNode values, String delimiter) {
        if (values == null || !values.isArray()) {
            return "";
        }
        List<String> texts = new ArrayList<>();
        values.forEach(value -> texts.add(pythonString(value)));
        return String.join(delimiter, texts);
    }

    private static String pythonString(JsonNode value) {
        if (value == null) {
            return "";
        }
        if (value.isNull()) {
            return "None";
        }
        if (value.isTextual()) {
            return value.textValue();
        }
        if (value.isBoolean()) {
            return value.booleanValue() ? "True" : "False";
        }
        return value.asText();
    }

    private static String compactJson(JsonNode value) {
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException exc) {
            throw new IllegalStateException("코치 입력 JSON을 직렬화하지 못했습니다.", exc);
        }
    }

    private static boolean empty(String value) {
        return value == null || value.isEmpty();
    }

    private static String load(String resource) {
        try (InputStream input = CoachPrompt.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IllegalStateException("coach prompt is missing: " + resource);
            }
            String value = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            // apply_patch로 추가한 텍스트 리소스의 파일 종단 개행은 Python 상수에는 없다.
            return value.endsWith("\n") ? value.substring(0, value.length() - 1) : value;
        } catch (IOException exc) {
            throw new IllegalStateException("failed to read coach prompt: " + resource, exc);
        }
    }
}
