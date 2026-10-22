package com.acttub.actingapi.feature.coach.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 일반 배우의 맞춤 코칭 설정 (SOMA-795).
 *
 * <p>자문위원 파일을 뜯어 보면 같은 몇 가지를 사람마다 다르게 정해 두었다 — 막혔을 때 어떻게 묻는지, 첫 질문과 정리의 모양,
 * 쓰지 않을 말, 이유를 먼저 대는지, 물으면 바로 답하는지, 정리 전 질문 수, 원하는 피드백 쪽, 짚지 않을 것, 답 길이. 기억 갱신이
 * 이 칸들을 근거가 있을 때만 정하고({@code coaching_profile} 에 JSON 으로 저장), 코치는 이걸로 세 군데를 바꾼다.
 * <ol>
 *   <li>단계 지시 바꿔 끼우기 — "둘 중 고르는 질문" 같은 공통 지시를 그 배우용 지시로 바꾸거나 뺀다({@link #stepTask},
 *   {@link #firstTask}, {@link #withoutNeverSay}). 끝에 덧붙인 메모만으로는 단계 지시가 이겼다(2026-10-22 재생: 맞춤 코칭을
 *   붙여도 양자택일이 그대로 나왔다).</li>
 *   <li>자문위원 파일 모양의 글 — 코치 성격 자리에 붙는다({@link #personaText}).</li>
 *   <li>서버 진행 값 — 정리 전 질문 수 상한({@link #maxQuestions})과 답 길이({@code [길이]}).</li>
 * </ol>
 * 근거가 없는 칸은 비어 있고(기본), 그 칸에 해당하는 지시는 공통 그대로다. 연기 문제 진단과 장면 내용은 담지 않는다.
 */
public record ActorCoaching(
        String stuck,
        String firstQuestion,
        String closing,
        List<String> neverSay,
        Boolean reasonsFirst,
        Boolean answerDirectly,
        Integer maxQuestions,
        String feedbackFocus,
        List<String> skip,
        Integer replyLength,
        String summary,
        String legacyText) {

    /** 막혔을 때: 지금처럼 둘 중 고르기 / 코치가 이유와 함께 하나 제안 / 더 쉬운 열린 질문 한 번. */
    public static final Set<String> STUCK = Set.of("choice", "propose_one", "easier_open");
    /** 원하는 피드백 쪽: 근본(인물이 상대에게 하는 일) / 표현 방법(구체적 실행법) / 둘 다. */
    public static final Set<String> FOCUS = Set.of("root", "method", "both");
    public static final int MIN_QUESTIONS = 2;
    public static final int MAX_QUESTIONS = 4;
    public static final int MIN_LENGTH = 60;
    public static final int MAX_LENGTH = 160;

    public static final String HEADER = "[이 배우에게 맞춘 코칭]";
    static final String INTRO = "아래는 이 배우가 지난 대화에서 남긴 말과 평가를 보고 정한 것이다. 위의 공통 지시와 할 일 파일의 모양·좋은 예보다"
            + " 먼저다. 영상에 있는 것만 말하기, 대사로 가리키기, 영상 시간 쓰지 않기, 한 번에 질문 하나는 그대로 지킨다."
            + " 이 글에는 장면 내용이 없다 — 장면은 이번 영상과 배우가 적은 것에서만 본다.";

    private static final ObjectMapper JSON = new ObjectMapper();

    public ActorCoaching {
        stuck = stuck != null && STUCK.contains(stuck) ? stuck : null;
        feedbackFocus = feedbackFocus != null && FOCUS.contains(feedbackFocus) ? feedbackFocus : null;
        neverSay = neverSay == null ? List.of() : List.copyOf(neverSay);
        skip = skip == null ? List.of() : List.copyOf(skip);
        maxQuestions = maxQuestions == null ? null : Math.max(MIN_QUESTIONS, Math.min(MAX_QUESTIONS, maxQuestions));
        replyLength = replyLength == null ? null : Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, replyLength));
        firstQuestion = blank(firstQuestion) ? null : firstQuestion.strip();
        closing = blank(closing) ? null : closing.strip();
        summary = blank(summary) ? null : summary.strip();
        legacyText = blank(legacyText) ? null : legacyText.strip();
    }

    /** 저장된 값을 읽는다. JSON 이 아니면 예전(#856) 글 그대로인 맞춤 코칭이다 — 글만 붙고 바꿔 끼우는 것은 없다. */
    public static ActorCoaching parse(String stored) {
        if (blank(stored)) return null;
        String text = stored.strip();
        if (!text.startsWith("{")) {
            return new ActorCoaching(null, null, null, List.of(), null, null, null, null, List.of(), null, null, text);
        }
        try {
            JsonNode node = JSON.readTree(text);
            return new ActorCoaching(
                    textOrNull(node, "stuck"), textOrNull(node, "first_question"), textOrNull(node, "closing"),
                    strings(node.path("never_say")), bool(node, "reasons_first"), bool(node, "answer_directly"),
                    node.path("max_questions").canConvertToInt() ? node.path("max_questions").asInt() : null,
                    textOrNull(node, "feedback_focus"), strings(node.path("skip")),
                    node.path("reply_length").canConvertToInt() ? node.path("reply_length").asInt() : null,
                    textOrNull(node, "summary"), null);
        } catch (com.fasterxml.jackson.core.JsonProcessingException unreadable) {
            return null;
        }
    }

    /** 저장할 JSON. 비어 있는 칸은 싣지 않는다. */
    public String toJson() {
        ObjectNode node = JSON.createObjectNode();
        if (stuck != null) node.put("stuck", stuck);
        if (firstQuestion != null) node.put("first_question", firstQuestion);
        if (closing != null) node.put("closing", closing);
        if (!neverSay.isEmpty()) {
            ArrayNode list = node.putArray("never_say");
            neverSay.forEach(list::add);
        }
        if (reasonsFirst != null) node.put("reasons_first", reasonsFirst);
        if (answerDirectly != null) node.put("answer_directly", answerDirectly);
        if (maxQuestions != null) node.put("max_questions", maxQuestions);
        if (feedbackFocus != null) node.put("feedback_focus", feedbackFocus);
        if (!skip.isEmpty()) {
            ArrayNode list = node.putArray("skip");
            skip.forEach(list::add);
        }
        if (replyLength != null) node.put("reply_length", replyLength);
        if (summary != null) node.put("summary", summary);
        return node.toString();
    }

    /** 근거가 있어 정해진 칸이 하나라도 있는지. 없으면 저장하지 않는다. */
    public boolean decidesAnything() {
        return legacyText != null || stuck != null || firstQuestion != null || closing != null || !neverSay.isEmpty()
                || reasonsFirst != null || answerDirectly != null || maxQuestions != null || feedbackFocus != null
                || !skip.isEmpty() || replyLength != null;
    }

    private boolean avoidsChoice() {
        return "propose_one".equals(stuck) || "easier_open".equals(stuck);
    }

    // --- 2) 자문위원 파일 모양의 글 -------------------------------------------------

    /** 코치 성격 자리에 붙는 글. 맨 앞 {@code [길이] N} 은 답 길이 상한이 읽고 떼어 낸다. */
    public String personaText() {
        if (legacyText != null) return legacyText;
        List<String> out = new ArrayList<>();
        if (replyLength != null) out.add("[길이] " + replyLength);
        out.add(HEADER);
        out.add(INTRO);
        if (summary != null) out.add(summary);
        if (firstQuestion != null) {
            out.add("- 첫 응답의 <설계>에서 '첫 질문 모양' 칸에는 위 목록의 모양 대신 이 배우의 모양 \"" + firstQuestion
                    + "\"을 그대로 쓴다. <코치>는 반드시 그 모양으로 묻는다.");
        }
        if (closing != null) {
            out.add("- 마지막 정리는 위 정리 모양 대신 이 모양으로 말한다(맨 첫 줄의 숨은 <다음 테이크> 줄은 그대로 쓴다): " + closing);
        }
        if (!neverSay.isEmpty()) {
            out.add("- 이 배우에게는 다음 말을 한 번도 쓰지 않는다: " + quoted(neverSay) + ".");
        }
        if (Boolean.TRUE.equals(reasonsFirst)) {
            out.add("- 관찰과 제안에는 항상 이유를 한 문장 붙인다. 이유는 영상에서 본 것과 인물·상대의 관계로 댄다.");
        }
        if (Boolean.TRUE.equals(answerDirectly)) {
            out.add("- 배우가 \"왜요?\", \"어떻게 해요?\"처럼 이유나 방법을 물으면 질문으로 돌리지 않고 첫 문장에서 바로 답한다.");
        }
        if ("propose_one".equals(stuck)) {
            out.add("- 배우 답이 짧거나 막히면 둘 중 고르게 묻지 않는다. 코치가 하나를 이유와 함께 제안한다.");
        } else if ("easier_open".equals(stuck)) {
            out.add("- 배우 답이 짧거나 막히면 둘 중 고르게 묻지 않는다. 같은 것을 더 쉬운 열린 질문으로 한 번만 묻는다.");
        }
        if ("root".equals(feedbackFocus)) {
            out.add("- 이 배우는 표현 기술보다 인물이 상대에게 하는 일(근본) 쪽 피드백을 원한다. 짚을 거리와 제안을 그쪽에서 고른다.");
        } else if ("method".equals(feedbackFocus)) {
            out.add("- 이 배우는 바로 해 볼 수 있는 구체적인 방법을 원한다. 제안은 다음 테이크에 바로 할 수 있는 행동 하나로 준다.");
        } else if ("both".equals(feedbackFocus)) {
            out.add("- 이 배우는 인물이 상대에게 하는 일과 그걸 해 볼 구체적인 방법을 함께 원한다. 제안에는 둘을 함께 담는다.");
        }
        if (!skip.isEmpty()) {
            out.add("- 이 배우에게는 다음을 짚지 않는다: " + String.join(", ", skip) + ".");
        }
        if (maxQuestions != null) {
            out.add("- 정리 전에 묻는 질문은 " + maxQuestions + "개까지다. 그보다 길게 묻지 않는다.");
        }
        out.add("- 칭찬, 감상을 하지 않는다.");
        out.add("- 시키는 말(\"~하세요\", \"~보세요\", \"~마세요\")을 쓰지 않는다. 방향은 \"~해 봐도 좋아요\"로 말한다.");
        out.add("- 제안은 상대에게 하는 일로 하되, \"확인하며\", \"살피며\", \"흔들리는지\"를 쓰지 않는다.");
        if (replyLength != null) {
            out.add("- 한 번에 하는 말은 공백 포함 " + replyLength + "자 안쪽이다.");
        }
        return String.join("\n", out);
    }

    // --- 1) 단계 지시 바꿔 끼우기 ---------------------------------------------------

    /** 쉽게 묻기 바꿔 끼우기: 코치가 하나 제안. */
    static final String EASY_PROPOSE = """
            역할: 너는 말이 막힌 배우에게 길 하나를 먼저 보여 주는 코치다.
            이번 목표: 아래 "이번에 알아낼 것"을 코치가 하나로 정해 이유와 함께 제안하고, 배우가 그걸로 답하게 한다.
            왜 중요한가: 이 배우는 막혔을 때 고를 거리보다 코치의 제안 하나를 받을 때 다음 말을 꺼냈다.
            도움이 되는 말:
            - 받는 말 없이 바로 말한다.
            - 대사 하나를 짚고, 인물이 상대에게 하는 일 하나를 "~해 봐도 좋아요"로 제안한다.
            - 이유는 영상에서 본 것과 인물·상대의 관계로 한 문장 댄다.
            피할 말:
            - 둘 중 고르게 묻기("~할래요, ~할래요?", "~중에 골라")
            - 바로 앞 질문을 그대로 다시 묻기, 긴 설명
            모양: 제안 한 문장과 이유 한 문장. 60자 안쪽. 질문으로 끝내지 않는다.""";

    /** 쉽게 묻기 바꿔 끼우기: 더 쉬운 열린 질문 한 번. */
    static final String EASY_OPEN = """
            역할: 너는 말이 막힌 배우가 쉽게 다음 말을 꺼내게 돕는 코치다.
            이번 목표: 아래 "이번에 알아낼 것"을 더 쉬운 열린 질문 하나로 다시 묻는다.
            왜 중요한가: 이 배우는 고를 거리를 받으면 말이 줄었다. 대사 하나로 데려가는 쉬운 질문에 더 잘 답했다.
            도움이 되는 말:
            - 받는 말 없이 바로 묻는다.
            - 대사 하나를 짚고, 그 순간 상대가 어떻게 해 주길 바랐는지처럼 바로 그릴 수 있는 말로 묻는다.
            피할 말:
            - 둘 중 고르게 묻기("~할래요, ~할래요?", "~중에 골라"), 보기 주기
            - 바로 앞 질문을 그대로 다시 묻기, 긴 설명
            모양: 열린 질문 한 문장. 40자 안쪽.""";

    /**
     * 자문위원 7명 파일에 공통으로 적힌 말투 금지(SOMA-795). 공통 지시에도 비슷한 줄이 있지만 맞춤 코칭 배우 재생에서 "~해 보세요"가
     * 늘었다(2026-10-22 재생 v2: 2→6). 자문위원 파일처럼 그 배우의 단계 지시 "피할 말"에 직접 넣는다.
     */
    static final String COMMON_BANS = "- 이 배우에게는 시키는 말(\"~하세요\", \"~보세요\", \"~마세요\")을 쓰지 않는다. 방향은 \"~해 봐도 좋아요\"로 말한다."
            + " 칭찬, 감상을 하지 않는다. \"확인하며\", \"살피며\", \"흔들리는지\"를 쓰지 않는다.";
    /** 공통 금지 표현이 든 줄. 따옴표 안(배우가 한 말·경고 대상 낱말)은 보지 않는다. */
    private static final java.util.regex.Pattern BANNED = java.util.regex.Pattern.compile(
            "확인하며|살피며|흔들리는지|(하|해|봐|보|주|마|지)세요");
    private static final java.util.regex.Pattern QUOTED = java.util.regex.Pattern.compile("\"[^\"]*\"|“[^”]*”");

    private static final String FIND_CHOICE = "- 배우가 막힐 것 같으면 둘 중 고르게 묻는다(멈추기, 상대를 끝까지 보기, 따지기, 달래기 같은 행동 중 둘).";
    private static final String GAP_CHOICE = " 고르게 하고 싶으면 한 질문 안에 둘을 넣는다.";
    private static final String WRAP_SHAPE_PREFIX = "- 장면 전체를 꿰는 행동 하나와 그게 되는지 확인할 대사 하나로 말한다.";

    /**
     * 할 일 파일(단계 지시)을 이 배우용으로 바꾼다. 바꿀 칸이 없으면 받은 그대로 돌려준다(바이트 단위로 같다).
     *
     * @param doing {@link PracticeLoopRouter} 의 할 일 이름("쉽게 묻기", "스스로 찾기" …)
     */
    public String stepTask(String doing, String task) {
        if (task == null || legacyText != null) return task;
        String out = afterAvoidHeader(task, COMMON_BANS);
        if (avoidsChoice()) {
            if (PracticeLoopRouter.EASY.equals(doing)) {
                out = "propose_one".equals(stuck) ? EASY_PROPOSE : EASY_OPEN;
            }
            out = out.replace(FIND_CHOICE, "propose_one".equals(stuck)
                    ? "- 배우가 막힐 것 같아도 둘 중 고르게 묻지 않는다. 쉬운 말로 한 번만 묻고, 그래도 막히면 다음 응답에서 코치가 하나를 제안한다."
                    : "- 배우가 막힐 것 같아도 둘 중 고르게 묻지 않는다. 대사 하나로 데려가는 쉬운 열린 질문으로 묻는다.");
            out = out.replace(GAP_CHOICE, " 둘 중 고르게 묻지 않는다.");
        }
        if (closing != null && PracticeLoopRouter.WRAP_UP.equals(doing)) {
            out = withClosing(out);
        }
        if (Boolean.TRUE.equals(answerDirectly) && "답하기".equals(doing)) {
            out = afterHelpHeader(out, "- 이 배우에게는 이유·방법을 물으면 첫 문장에서 바로 답한다. 끝 질문은 붙이지 않는다.");
        }
        if (Boolean.TRUE.equals(reasonsFirst) && (PracticeLoopRouter.GAP.equals(doing) || PracticeLoopRouter.PROPOSE.equals(doing)
                || PracticeLoopRouter.WRAP_UP.equals(doing) || "답하기".equals(doing))) {
            out = afterHelpHeader(out, "- 이 배우에게는 관찰이나 제안에 이유 한 문장을 꼭 붙인다.");
        }
        if (!skip.isEmpty() && (PracticeLoopRouter.GAP.equals(doing) || "짚어주기".equals(doing)
                || PracticeLoopRouter.POINT_OUT_OTHER.equals(doing))) {
            out = afterAvoidHeader(out, "- 이 배우에게 짚지 않는 것: " + String.join(", ", skip));
        }
        return out;
    }

    /** 정리 모양을 이 배우의 틀로 바꾼다. 공통 모양 줄과 좋은 예를 빼고 틀 한 줄을 넣는다. */
    private String withClosing(String task) {
        List<String> kept = new ArrayList<>();
        for (String line : task.split("\n", -1)) {
            if (line.startsWith(WRAP_SHAPE_PREFIX) || line.startsWith("좋은 예")) continue;
            kept.add(line);
        }
        return afterHelpHeader(String.join("\n", kept),
                "- 이 배우에게는 정리를 이 모양으로 말한다(자리표시는 이번 대화의 행동과 실제 대사로 채운다): " + closing);
    }

    /**
     * 첫 응답 지시(연습 루프 프롬프트)를 이 배우용으로 바꾼다 — 첫 질문 모양을 틀로 고정하고, 짚지 않을 것을 피할 말에 넣는다.
     * 바꿀 칸이 없으면 받은 그대로다.
     */
    public String firstTask(String task) {
        if (task == null || legacyText != null) return task;
        String out = afterAvoidHeader(task, COMMON_BANS);
        if (firstQuestion != null) {
            List<String> kept = new ArrayList<>();
            for (String line : out.split("\n", -1)) {
                if (line.matches("^- [1-5] .+→.+")) continue; // 근본 문제별 첫 질문 모양 목록
                if (line.startsWith("첫 질문은 <설계>의 근본 문제에 맞춰 고른다.")) {
                    kept.add("첫 질문은 이 배우에게 맞춘 모양 \"" + firstQuestion + "\"으로 묻는다. 근본 문제는 <설계>에 그대로 찾아 적는다."
                            + " 장면 전체에 대해 묻고, 특정 대사를 따오지 않는다. [인물]은 배우가 적은 인물 이름이 있으면 그 이름, 없으면 \"이 사람\"이라고 한다.");
                    continue;
                }
                if (line.startsWith("- 위의 모양을 그대로 쓴다.")) {
                    kept.add("- 이 배우의 첫 질문 모양을 그대로 쓴다. 배우가 바로 떠올릴 수 있게 한 문장으로 짧게 묻는다.");
                    continue;
                }
                if (line.startsWith("[속으로 먼저 정한 근본 문제에 맞는 첫 질문 모양으로")) {
                    kept.add("[이 배우의 첫 질문 모양 \"" + firstQuestion + "\"으로, 장면 전체에 대해 묻는 질문 한 문장]");
                    continue;
                }
                if (line.startsWith("첫 질문 모양: [")) {
                    kept.add("첫 질문 모양: [이 배우의 첫 질문 모양 \"" + firstQuestion + "\"을 [인물]·[상대]만 채워 그대로 옮긴다. <코치>는 반드시 이 모양으로 묻는다]");
                    continue;
                }
                kept.add(line);
            }
            out = String.join("\n", kept);
        }
        if (!skip.isEmpty()) {
            out = afterAvoidHeader(out, "- 이 배우에게 짚지 않는 것: " + String.join(", ", skip));
        }
        return out;
    }

    /**
     * 쓰지 않을 말이 든 줄을 공통 지시·예문에서 뺀다(자문위원의 {@code withoutHowAbout} 과 같은 까닭). "피할 말" 아래 줄과
     * "나쁜 예"는 그 말을 쓰지 말라는 줄이라 남긴다.
     */
    public String withoutNeverSay(String task) {
        if (task == null || neverSay.isEmpty()) return task;
        List<String> kept = new ArrayList<>();
        boolean inAvoid = false;
        boolean inMaterial = false;
        for (String line : task.split("\n", -1)) {
            String trimmed = line.strip();
            inMaterial = material(trimmed, inMaterial);
            if (trimmed.endsWith(":") && !trimmed.startsWith("-")) inAvoid = trimmed.startsWith("피할 말");
            else if (trimmed.startsWith("모양") || trimmed.startsWith("좋은 예") || trimmed.startsWith("[")) inAvoid = false;
            boolean warns = inAvoid || inMaterial || trimmed.startsWith("나쁜 예");
            if (!warns && neverSay.stream().anyMatch(trimmed::contains)) continue;
            kept.add(line);
        }
        return String.join("\n", kept);
    }

    /**
     * 공통 금지 표현(시키는 말, "확인하며/살피며/흔들리는지")이 든 줄을 공통 지시·예문에서 뺀다. 따옴표 안의 말(배우 말 예시, 쓰지 말라는
     * 낱말)과 "피할 말"·"나쁜 예" 줄은 남긴다. 예전 글 형식의 맞춤 코칭에는 쓰지 않는다.
     */
    public String withoutCommonBans(String task) {
        if (task == null || legacyText != null) return task;
        List<String> kept = new ArrayList<>();
        boolean inAvoid = false;
        boolean inMaterial = false;
        for (String line : task.split("\n", -1)) {
            String trimmed = line.strip();
            inMaterial = material(trimmed, inMaterial);
            if (trimmed.endsWith(":") && !trimmed.startsWith("-")) inAvoid = trimmed.startsWith("피할 말");
            else if (trimmed.startsWith("모양") || trimmed.startsWith("좋은 예") || trimmed.startsWith("[")) inAvoid = false;
            boolean warns = inAvoid || inMaterial || trimmed.startsWith("나쁜 예") || trimmed.equals(COMMON_BANS.strip());
            if (!warns && BANNED.matcher(QUOTED.matcher(trimmed).replaceAll("\"\"")).find()) continue;
            kept.add(line);
        }
        return String.join("\n", kept);
    }

    /**
     * [이번 응답]의 "재료" 칸(배우가 한 말·지난 답)은 거르지 않는다 — 배우 말에 "~해 주세요"나 쓰지 않을 말이 들어 있어도 재료다.
     * 칸은 "재료" 줄에서 시작해 빈 줄에서 끝난다.
     */
    private static boolean material(String trimmed, boolean inMaterial) {
        if (trimmed.equals("재료") || trimmed.equals("Material")) return true;
        return inMaterial && !trimmed.isEmpty();
    }

    private static String afterHelpHeader(String task, String line) {
        int at = task.indexOf("도움이 되는 말:");
        if (at < 0) return task + "\n" + line;
        int end = task.indexOf('\n', at);
        if (end < 0) return task + "\n" + line;
        return task.substring(0, end + 1) + line + "\n" + task.substring(end + 1);
    }

    private static String afterAvoidHeader(String task, String line) {
        int at = task.indexOf("피할 말:");
        if (at < 0) return task + "\n" + line;
        int end = task.indexOf('\n', at);
        if (end < 0) return task + "\n" + line;
        return task.substring(0, end + 1) + line + "\n" + task.substring(end + 1);
    }

    private static String quoted(List<String> values) {
        return String.join(", ", values.stream().map(v -> "\"" + v + "\"").toList());
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static String textOrNull(JsonNode node, String key) {
        JsonNode value = node.path(key);
        return value.isTextual() && !value.asText().isBlank() ? value.asText().strip() : null;
    }

    private static Boolean bool(JsonNode node, String key) {
        JsonNode value = node.path(key);
        return value.isBoolean() ? value.asBoolean() : null;
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        if (array != null && array.isArray()) {
            for (JsonNode item : array) {
                if (item.isTextual() && !item.asText().isBlank()) out.add(item.asText().strip());
            }
        }
        return out;
    }
}
