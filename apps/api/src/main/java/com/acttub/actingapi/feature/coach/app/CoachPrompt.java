package com.acttub.actingapi.feature.coach.app;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import com.acttub.actingapi.feature.coach.domain.CoachBranch;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** acting-agent/prompt.py의 프롬프트와 입력 직렬화 계약. */
public final class CoachPrompt {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final String COACH_V2_PROMPT = load("/coach/coach-v2-prompt.txt");
    private static final String COACH_V3_PROMPT = load("/coach/coach-v3-prompt.txt");
    /**
     * 모델 답이 두 번 검증에 걸렸을 때 서버가 대신 내는 문장. 1~6번째 응답에서만 쓴다 —
     * 질문이라서, 7번째부터 내면 두 프롬프트가 그 응답부터 하지 말라는 "새로운 질문"이
     * 서버 손으로 나간다.
     */
    private static final String SAFE_TEMPLATE =
            "방금 말한 지점에서 하나만 더 볼게. "
                    + "이 말을 상대에게 건넬 때, 상대가 어떻게 되길 바라는 거야?";

    /**
     * 마지막 구간(7번째부터)의 안전 문구. 새 질문 대신 배우의 말로 정리해 달라고 청한다 —
     * 두 프롬프트의 7번째 응답 절이 모델에 시키는 두 가지 중 둘째다. 첫째(오늘 대화에서 배우가
     * 말한 것 하나를 되짚기)는 서버가 알 수 없어 뺀다. 분석·그 외는 다음 테이크에서 해볼 것,
     * 표현은 다음 연습에서 유지할 것을 청한다. v3 는 실험을 못 한 세션에는 "해볼 것"을 청하라
     * 하지만 서버는 실험 여부를 모르므로 표현은 늘 "유지할 것"이다.
     */
    private static final String ANALYSIS_CLOSING_SAFE_TEMPLATE =
            "오늘 이야기한 것 가운데 다음 테이크에서 해볼 것 하나만 네 말로 정리해줄래? "
                    + "한 줄이면 충분해.";
    private static final String EXPRESSION_CLOSING_SAFE_TEMPLATE =
            "오늘 이야기한 것 가운데 다음 연습에서 유지할 것 하나만 네 말로 정리해줄래? "
                    + "한 줄이면 충분해.";

    /**
     * 코치 응답의 턴 예산. 분석·표현 갈래가 같은 값을 쓴다.
     *
     * <p>상한에서 대화를 끊는 값이 아니라, 매 요청 프롬프트 끝에 "## 남은 응답" 블록으로
     * 실려 모델이 그 안에서 대화를 배분하게 하는 값이다. 서버는 이 번호를 넘어도 끊지
     * 않는다 — 넘은 응답의 처리는 모델 프롬프트의 몫이다.
     */
    private static final int TURN_BUDGET = 8;
    /**
     * 구간 경계 — 앞 두 구간의 마지막 응답 번호. 둘째 경계 다음이 마지막 구간이고, 안전
     * 문구도 그 경계에서 질문에서 정리 청유로 바뀐다.
     */
    private static final int OPEN_UNTIL = 3;
    private static final int NARROW_UNTIL = 6;
    /** 구간 이름은 두 프롬프트 본문의 "## N번째 응답: ..." 제목과 글자 그대로 같아야 한다. */
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
     * Scene Context 세 칸이 <b>모두</b> 빈 세션에 붙는 장면 맥락 미입력 블록의 본문. 코치가 첫 한두
     * 응답에서 영상 관찰 하나를 근거로 장면을 묻게 한다. 배우의 답은 대화 turn 으로만 남고
     * Scene Context 가 되지 않는다(ADR-021 개정). {@code ObservationPrompt} 는 같은 세션에
     * 한 줄짜리 부재 안내를 따로 넣는데, 두 프롬프트는 각자 진화하므로 문구를 공유하지
     * 않는다.
     */
    private static final String SCENE_CONTEXT_MISSING_TEXT =
            load("/coach/coach-block-scene-context-missing.txt");

    /**
     * 막힘을 고르지 않은 세션에 붙는 막힘 미특정 블록의 본문. 코치가 막힘을 지어내지 않고
     * 영상에서 확인된 것 하나를 근거로 대화를 열고, 배우가 다루고 싶은 지점을 말하면 그리로
     * 좁히게 한다. 부착 조건은 {@link #blockageUnspecifiedBlock} 에 있다.
     */
    private static final String BLOCKAGE_UNSPECIFIED_TEXT =
            load("/coach/coach-block-blockage-unspecified.txt");

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
                + " 영상의 장면을 말하지 않는다. 배우가 지난번에 한 말이므로 그대로 읊지 않는다.");
        lines.add("다만 모른 척도 하지 않는다 — **대화 중 자연스러운 자리에서 한 번은"
                + " 이어받아라.** 지난 목표가 이번에도 유효한지 묻거나, 반복해서 막히는 지점이"
                + " 이번 장면에서도 보이는지 연결하거나, 해보기로 한 것을 해봤는지 묻는 식이다.");

        if (!prior.memory().isEmpty()) {
            lines.add("");
            MEMORY_LABELS.forEach((name, label) -> {
                String value = prior.memory().get(name);
                if (value != null && !value.isEmpty()) {
                    lines.add("- " + label + ": " + value);
                }
            });
        }

        if (!prior.sceneHistory().isEmpty()) {
            lines.add("");
            lines.add("### 이 장면에서 지금까지");
            prior.sceneHistory().forEach(row -> lines.add("- " + row));
        }

        if (prior.earlierConversation() != null) {
            lines.add("");
            lines.add(prior.fromSamePractice()
                    ? "### 같은 연습에서 지난번에 나눈 이야기"
                    : "### 지난 연습에서 나눈 이야기");
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

    /**
     * 갈래로 시스템 프롬프트를 고른다. {@code 표현} 만 v3 이고 {@code 분석}·{@code 그 외} 는
     * v2 다 — 그래서 v2 의 입력 정보는 {@code blockage_kind} 를 "분석 또는 그 외" 로 선언하고,
     * {@code 그 외} 세션의 할 일은 {@link #blockageUnspecifiedBlock} 이 대화 프롬프트에서 말한다.
     */
    public static String select(String blockageKind) {
        return CoachBranch.isExpressionBlockage(blockageKind) ? COACH_V3_PROMPT : COACH_V2_PROMPT;
    }

    /**
     * 배우가 쓴 것을 담는 칸.
     *
     * <p><b>빈 칸은 줄 자체를 만들지 않는다</b> — {@link #priorContextBlock} 이 같은 이유로
     * 이미 그렇게 하고 있다. 일부만 비면 그 줄만 빠지고 부재를 말하지 않는다(ADR-021). 셋이
     * <b>모두</b> 비면 여기서는 아무 말도 하지 않고 {@link #sceneContextMissingBlock} 이
     * 이어서 부재와 할 일을 말한다. 막힘을 고르지 않은 세션도 같은 꼴이다 — 갈래 줄은 값
     * {@code 그 외} 를 그대로 적고, {@link #blockageUnspecifiedBlock} 이 이어서 할 일을 말한다.
     */
    private static String actorMaterialBlock(CoachSessionSnapshot session) {
        List<String> lines = new ArrayList<>();
        lines.add("## 배우가 쓴 것");
        addField(lines, "상황", session.situation());
        addField(lines, "캐릭터", session.characterContext());
        addField(lines, "이번 테이크의 목적", session.goal());
        lines.add("- 배우가 고른 막히는 지점: " + session.blockageKind());
        lines.add("- 하위 갈래: " + subBranchLabel(session.subBranch()));
        addField(lines, "배우가 쓴 상세", session.blockageDetail());
        lines.add("- 영상 길이: " + session.durationMs() + "ms");
        return String.join("\n", lines) + "\n";
    }

    /**
     * Scene Context 세 칸이 모두 빈 세션에만 붙는다. 일부만 빈 세션은 적은 것이 있으므로
     * 부재를 말하지 않는다(ADR-021). 없으면 칸 자체를 만들지 않는다({@link #priorContextBlock}
     * 과 같은 이유).
     */
    private static String sceneContextMissingBlock(CoachSessionSnapshot session) {
        if (!sceneContextMissing(session)) {
            return "";
        }
        return section("장면 맥락 미입력", SCENE_CONTEXT_MISSING_TEXT);
    }

    private static boolean sceneContextMissing(CoachSessionSnapshot session) {
        return blank(session.situation())
                && blank(session.characterContext())
                && blank(session.goal());
    }

    /**
     * 갈래가 {@code 그 외} 인 세션에만 붙는다 — 웹·앱 모두가 막힘 선택을 건너뛰면 보내는
     * 값이다(SOMA-432, ADR-021 보강). 하위 갈래만 {@code 그 외} 인 세션에는 붙지 않는다 —
     * 그 세션은 갈래(분석·표현)를 고른 세션이고, 하위 갈래를 직접 고른 사람과 안 고른 사람은
     * 서버가 가를 수 없다({@link #subBranchLabel}). 없으면 칸 자체를 만들지 않는다
     * ({@link #priorContextBlock} 과 같은 이유).
     */
    private static String blockageUnspecifiedBlock(CoachSessionSnapshot session) {
        if (!CoachBranch.isBlockageUnspecified(session.blockageKind())) {
            return "";
        }
        return section("막힘 미특정", BLOCKAGE_UNSPECIFIED_TEXT);
    }

    /** 조건부 칸의 공통 꼴 — 앞 칸과 빈 줄 하나로 떼고 제목·본문을 잇는다. */
    private static String section(String heading, String body) {
        return "\n## " + heading + "\n" + body + "\n";
    }

    /**
     * {@code 그 외} 는 <b>"특정하지 않음"</b> 으로 적는다. 하위 갈래를 직접 고른 사람과 화면에서
     * 안 고른 사람을 서버가 구분할 수 없는데, 이 표현은 <b>양쪽 모두에게 참</b>이다(ADR-021).
     */
    private static String subBranchLabel(String subBranch) {
        return "그 외".equals(subBranch) ? "특정하지 않음" : subBranch;
    }

    private static void addField(List<String> lines, String label, String value) {
        if (!blank(value)) {
            lines.add("- " + label + ": " + value);
        }
    }

    /**
     * 빈 칸 판정. {@link #empty} 와 갈라 두는 이유는 대상이 다르기 때문이다 — 저쪽은
     * {@code conversationSummary} 가 쓰는 {@code isEmpty()} 이고, 이쪽은 배우가 쓴 칸이라
     * 공백만 든 값도 "안 적었다" 로 본다. 웹이 {@code .trim()} 해 보내지만 서버가 그 보장에
     * 기대지 않는다.
     *
     * <p>{@code CoachEngine:firstActorMessage} 가 같은 판정을 쓴다 — 프롬프트에서 뺀 칸이
     * 첫 발화로는 남는 어긋남을 만들지 않으려면 두 자리의 기준이 같아야 한다.
     */
    static boolean blank(String value) {
        return value == null || value.isBlank();
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
        return priorContextBlock(session.prior())
                + actorMaterialBlock(session)
                + sceneContextMissingBlock(session)
                + blockageUnspecifiedBlock(session)
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

    /**
     * 모델 답이 두 번 검증에 걸렸을 때 배우에게 갈 문장. 6번째까지는 질문이고, 마지막
     * 구간(7번째부터)에서는 갈래별 정리 청유다 — 두 프롬프트가 그 응답부터 새 질문을 하지
     * 말라고 하는데 서버가 대신 내는 문장이 질문이면 안 된다. 응답 번호는 {@link #turnNumber}
     * 로 센다.
     */
    public static String safeTemplate(int turnNumber, String blockageKind) {
        if (turnNumber <= NARROW_UNTIL) {
            return SAFE_TEMPLATE;
        }
        return CoachBranch.isExpressionBlockage(blockageKind)
                ? EXPRESSION_CLOSING_SAFE_TEMPLATE
                : ANALYSIS_CLOSING_SAFE_TEMPLATE;
    }

    /**
     * 지금 만들 응답의 번호. turn 개수가 아니라 코치 turn 수 + 1 이다 — 프롬프트의
     * "현재 응답: N번째" 와 같은 셈이고, {@code CoachEngine} 의 안전 문구 판정과 그 로그도 이
     * 번호를 쓴다.
     */
    static int turnNumber(CoachSessionSnapshot session) {
        return (int) session.turns().stream()
                .filter(turn -> "ai".equals(turn.role()))
                .count() + 1;
    }

    private static String turnLines(List<CoachTurnSnapshot> turns) {
        return turns.stream()
                .map(turn -> ("actor".equals(turn.role()) ? "배우" : "코치")
                        + ": " + turn.text())
                .collect(java.util.stream.Collectors.joining("\n"));
    }


    /**
     * 영상을 본 모델이 낸 관찰을 <b>가공하지 않고 그대로</b> 넘긴다 (SOMA-490).
     *
     * <p>예전에는 관찰 3개를 "- 0~93000ms: 라벨" 한 줄씩으로 다시 써서 넘겼다. 그 과정에서
     * 장면 요약도, 대사 인용도, 어느 축의 관찰인지도 사라졌다 — 코치는 영상을 보지 못하므로
     * 이 JSON 이 유일한 영상 근거다. 줄여서 넘길 이유가 없다.
     */
    private static String videoFacts(CoachSessionSnapshot session) {
        JsonNode pack = session.observationPack();
        if (pack == null || pack.isNull() || pack.isEmpty()) {
            return "아직 영상에서 확인된 것이 없다. 영상 이야기를 만들지 마라.";
        }
        JsonNode observations = pack.get("observations");
        if (observations == null || !observations.isArray() || observations.isEmpty()) {
            String uncertaintyText = joinText(pack.get("uncertainties"), " / ");
            return "관찰 0개. 영상 이야기를 새로 만들면 안 된다.\n불확실: "
                    + (uncertaintyText.isEmpty() ? "없음" : uncertaintyText);
        }
        return compactJson(pack);
    }

    private static String analysisHandoffBlock(CoachSessionSnapshot session) {
        JsonNode handoff = session.analysisHandoff();
        if (!CoachBranch.isExpressionBlockage(session.blockageKind())
                || handoff == null
                || handoff.isNull()) {
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
        if (!CoachBranch.isExpressionBlockage(session.blockageKind())
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
        List<String> phases = CoachBranch.isExpressionBlockage(blockageKind)
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
        int turnNumber = turnNumber(session);
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
