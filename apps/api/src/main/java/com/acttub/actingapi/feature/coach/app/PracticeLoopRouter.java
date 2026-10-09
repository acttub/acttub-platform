package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 연습 루프 둘째 응답부터의 분기. 배우의 말 종류를 받아 이번 응답의 할 일을 <b>코드가</b> 정한다.
 *
 * <p>예전에는 프롬프트 안의 "배우의 말 보기"와 "할 일 표"를 모델이 매 턴 읽고 스스로 골랐다. 모델은 반박을 못 알아듣거나
 * 같은 버릇을 네다섯 번 묻거나 횟수를 잘못 셌다. 이제 배우의 말은 분류만 하는 AI가 정하고({@link #parse}), 할 일·횟수·피할 것은
 * 여기서 정한다. 모델은 정해진 할 일 하나의 문장만 쓴다.
 *
 * <p>정한 결과는 예전과 같은 모양의 상태 칸({@code 배우의 말:}·{@code 할 일:}·{@code 피할 것:} …)으로 남긴다.
 * 노트·세션.md·유저.md 가 이 칸을 읽는다. 예전 대화(모델이 쓴 상태 칸)도 같은 칸이라 그대로 이어진다.
 */
final class PracticeLoopRouter {
    private PracticeLoopRouter() {}

    /** 배우의 말 종류. {@code label}은 상태 칸과 노트가 읽는 한국어 이름이다. */
    enum Kind {
        STOP("stop", "그만"), SELF_LINE("self_line", "자기 한 줄"), CORRECTION("correction", "정정"),
        PUSHBACK("pushback", "반박"), METHOD("method", "방법 요청"), EVALUATION("evaluation", "평가 요청"),
        MISSED("missed", "질문 오해"), CHOICE("choice", "선택 설명"), INSIGHT("insight", "스스로 알아챔"), SHORT("short", "짧은 답"),
        QUESTION("question", "질문·설명"), ANSWER("answer", "답");

        final String id;
        final String label;

        Kind(String id, String label) {
            this.id = id;
            this.label = label;
        }

        /** 상태 칸의 이름으로 찾는다. 긴 이름부터 본다 — "답"이 다른 이름을 먼저 잡지 않게. 없으면 {@code null}. */
        static Kind ofLabel(String label) {
            if (label == null || label.isBlank()) return null;
            return Arrays.stream(values()).sorted((a, b) -> b.label.length() - a.label.length())
                    .filter(kind -> label.startsWith(kind.label)).findFirst().orElse(null);
        }
    }

    /**
     * 분류 호출에 넘기는 값. 분류 AI는 세 가지를 따로 판단한다.
     * 1) 단계 질문에 답했나: answered / missed / not_yet (반드시 하나)
     * 2) 코치가 먼저 반응해야 할 것: correction / pushback / method / evaluation / question (있을 때만 하나)
     * 3) stop: 그만하겠다는 말
     */
    static final List<String> STEP = List.of("answered", "missed", "not_yet");
    static final List<String> RESPOND = List.of("correction", "pushback", "method", "evaluation", "question");
    static final String STOP_SIGNAL = "stop";
    static final List<String> SIGNALS;
    static {
        var ids = new ArrayList<String>(STEP);
        ids.addAll(RESPOND);
        ids.add(STOP_SIGNAL);
        SIGNALS = List.copyOf(ids);
    }

    /**
     * 분류 결과. {@code kind}는 코드가 분기에 쓰는 종류, {@code respond}는 단계 질문에 답하면서 함께 물은 것
     * (question / evaluation / method, 없으면 빈 문자열). {@code by}는 model / fallback.
     */
    record Classified(Kind kind, boolean keep, String by, String respond) {
        Classified(Kind kind, boolean keep, String by) {
            this(kind, keep, by, "");
        }

        boolean alsoAsked() {
            return !respond.isEmpty();
        }
    }

    /**
     * 분류 호출의 응답 {@code {"signals":[...]}}을 읽어 종류로 바꾼다. 형식이 틀리면 예외.
     * 그만 → 정정·반박 → (답했으면) 답 + 함께 물은 것 → 엇나감 → (답 안 했으면) 물음·평가·방법 → 짧은 답 순서다.
     */
    static Classified parse(String output) {
        var root = com.acttub.actingapi.integration.llm.StructuredJson.parse(output);
        if (!root.isObject() || !root.path("signals").isArray()) throw new IllegalArgumentException("invalid practice loop classification");
        String step = null;
        String respond = null;
        boolean stop = false;
        for (JsonNode value : root.path("signals")) {
            String id = value.isTextual() ? value.asText() : "";
            if (!SIGNALS.contains(id)) throw new IllegalArgumentException("unknown practice loop classification");
            if (STOP_SIGNAL.equals(id)) stop = true;
            else if (STEP.contains(id)) { if (step == null) step = id; }
            else if (respond == null || RESPOND.indexOf(id) < RESPOND.indexOf(respond)) respond = id;
        }
        if (stop) return new Classified(Kind.STOP, false, "model");
        if (step == null && respond == null) throw new IllegalArgumentException("empty practice loop classification");
        if ("correction".equals(respond)) return new Classified(Kind.CORRECTION, false, "model");
        if ("pushback".equals(respond)) return new Classified(Kind.PUSHBACK, false, "model");
        if ("answered".equals(step)) return new Classified(Kind.ANSWER, false, "model", respond == null ? "" : respond);
        if ("missed".equals(step)) return new Classified(Kind.MISSED, false, "model");
        if ("method".equals(respond)) return new Classified(Kind.METHOD, false, "model");
        if ("evaluation".equals(respond)) return new Classified(Kind.EVALUATION, false, "model");
        if ("question".equals(respond)) return new Classified(Kind.QUESTION, false, "model");
        return new Classified(Kind.SHORT, false, "model");
    }

    /** 정리한 뒤의 말은 단계가 없으니, 함께 물은 게 있으면 그 물음으로 본다(답해 주고 다음 말에서 닫는다). */
    static Classified forRouting(Classified c, Before b) {
        if (!b.lastDoing().startsWith(WRAP_UP) || !c.alsoAsked()) return c;
        Kind asked = switch (c.respond()) {
            case "evaluation" -> Kind.EVALUATION;
            case "method" -> Kind.METHOD;
            default -> Kind.QUESTION;
        };
        return new Classified(asked, c.keep(), c.by());
    }

    /** 지금까지 코치가 한 일의 횟수. */
    record Tally(int habitQuestions, int pointOuts, int methods) {
        Tally after(String doing) {
            if (doing.startsWith("비추기") || doing.startsWith("파고들기") || doing.startsWith("이어보기")) {
                return new Tally(habitQuestions + 1, pointOuts, methods);
            }
            if (doing.startsWith("짚어주기")) return new Tally(habitQuestions, pointOuts + 1, methods);
            if (doing.startsWith("방법 주기")) return new Tally(habitQuestions, pointOuts, methods + 1);
            return this;
        }
    }

    /**
     * 이번 응답 전의 흐름. 저장된 상태 칸에서 다시 센다 — 모델이 적어 둔 숫자를 믿지 않는다.
     *
     * @param reply 이번 응답이 몇 번째인지(첫 응답이 1)
     * @param lastDoing 직전 코치가 한 일(첫 응답은 비추기)
     * @param lastKind 직전 배우의 말 종류. 모르면 {@code null}
     * @param avoid 꺼내지 않을 주제
     * @param habitDropped 배우가 지금 버릇을 정정·반박해 내려놓았는지
     * @param choiceExplained 배우가 그 버릇을 인물의 선택이라고 설명했는지
     * @param keep 배우가 그 버릇을 지키고 싶다고 했는지
     * @param closeNext 예전 판의 "다음에 닫기" 표시. 있으면 이번 말에서 정리한다
     * @param stage 지금까지 물은 단계(1 보여 주기 · 2 원하는 것 · 3 어긋남 · 4 스스로 찾기)
     */
    record Before(int reply, String lastDoing, Kind lastKind, Tally tally, List<String> avoid,
            boolean habitDropped, boolean choiceExplained, boolean keep, boolean closeNext, int stage) {
        Before(int reply, String lastDoing, Kind lastKind, Tally tally, List<String> avoid,
                boolean habitDropped, boolean choiceExplained, boolean keep, boolean closeNext) {
            this(reply, lastDoing, lastKind, tally, avoid, habitDropped, choiceExplained, keep, closeNext, 1);
        }
    }

    static Before before(JsonNode loop, int coachTurns) {
        JsonNode statuses = loop == null ? null : loop.path("statuses");
        Tally tally = new Tally(0, 0, 0);
        String lastDoing = "비추기";
        Kind lastKind = null;
        var avoid = new LinkedHashSet<String>();
        boolean dropped = false;
        boolean choice = false;
        boolean keep = false;
        boolean closeNext = false;
        // 첫 응답이 버릇을 보여 주고(1) 원하는 것을 묻는다(2). 그래서 첫 답은 2단계 질문의 답이다.
        int stage = coachTurns >= 1 ? 2 : 1;
        for (int i = 0; i < coachTurns; i++) {
            String status = statuses == null || !statuses.isArray() ? "" : statuses.path(i).asText("");
            String doing = DirectVideoPracticeLoop.action(status);
            tally = tally.after(doing);
            lastDoing = doing;
            Kind kind = Kind.ofLabel(DirectVideoPracticeLoop.statusField(status, "배우의 말"));
            lastKind = kind;
            if (kind == Kind.CORRECTION || kind == Kind.PUSHBACK) dropped = true;
            if (kind == Kind.CHOICE) choice = true;
            if (DirectVideoPracticeLoop.statusField(status, "지키기").startsWith("예")) keep = true;
            closeNext = DirectVideoPracticeLoop.statusField(status, "다음에 닫기").startsWith("예");
            String stageText = DirectVideoPracticeLoop.statusField(status, "단계");
            if (!stageText.isEmpty()) {
                try { stage = Math.max(stage, Integer.parseInt(stageText.replaceAll("\\D.*", ""))); } catch (NumberFormatException ignored) { }
            } else if (doing.startsWith("파고들기") || doing.startsWith("이어보기")) {
                stage = Math.min(4, stage + 1); // 단계 칸이 없던 예전 대화는 질문 횟수로 짐작한다
            }
            String avoided = DirectVideoPracticeLoop.statusField(status, "피할 것");
            if (!avoided.isEmpty() && !avoided.startsWith("없음")) {
                for (String part : avoided.split("\\s*[,·/]\\s*")) if (!part.isBlank()) avoid.add(part.strip());
            }
        }
        return new Before(coachTurns + 1, lastDoing, lastKind, tally, List.copyOf(avoid), dropped, choice, keep, closeNext, stage);
    }

    /** 응답 상한. {@link ConversationService#THREE_LAYERS_REPLY_LIMIT}과 같다. */
    static final int LAST_REPLY = ConversationService.THREE_LAYERS_REPLY_LIMIT;

    /** 코치 AI를 부르지 않고 대화를 닫는 할 일. 마무리 말 없이 닫고 앱은 바로 노트로 넘어간다. */
    static final String END = "끝";

    /**
     * 할 일 표. 위에서부터 먼저 맞는 줄 하나.
     *
     * <p>예전의 마무리1(한 줄 청하기)·마무리2(정리 인사)·끝은 모두 {@link #END}다. 대화가 끝나면 앱이 바로 노트(3층)로
     * 넘어가 마지막 코치 말이 거의 보이지 않으므로, 마무리 말을 쓰지 않고 코치 AI 없이 닫는다.
     */
    /** 대화를 마칠 때 배우의 말을 다음 테이크 행동 하나로 이어 주는 마지막 응답. 그다음 배우 말에서 닫는다. */
    static final String WRAP_UP = "정리하기";

    /** 단계별 질문. 질의응답으로 좁혀 가서 고칠 방법을 배우 입에서 먼저 나오게 한다. */
    static final String WANT = "원하는 것 묻기";
    static final String GAP = "어긋남 보기";
    static final String FIND = "스스로 찾기";
    /** 짧은 답이 왔을 때, 다음 단계의 질문을 둘 중 고르는 모양으로 쉽게 묻는다. */
    static final String EASY = "쉽게 묻기";

    /**
     * 할 일 표. 대화는 다섯 단계로 간다: 1 보여 주기(첫 응답) → 2 원하는 것 묻기 → 3 어긋남 보기 → 4 스스로 찾기 → 정리하기.
     * 배우가 보통으로 답하면 다음 단계로 간다. 물음·정정·반박에는 먼저 답하고 단계는 그대로 둔다.
     * 정리한 다음 배우 말에서 닫는다. 그만과 16번째는 바로 닫는다.
     */
    static String route(Kind kind, Before b) {
        return route(kind, b, 0);
    }

    /** 단계를 넘기지 않고 머문 할 일. 같은 단계에서 몇 번째 묻는지 셀 때 쓴다. */
    static final String PROPOSE = "답 제안하기";
    static final java.util.Set<String> STAYS = java.util.Set.of("다시 묻기", EASY, PROPOSE, "답하기", "짚어주기", "짚어주기(다른 쪽)", "내려놓기");

    /** 지금 단계에서 연달아 머문 코치 응답 수. 단계를 넘긴 응답(첫 응답, 보여 주기, 스스로 찾기, 정리)에서 0으로 돌아간다. */
    static int stayed(JsonNode loop, int coachTurns) {
        JsonNode statuses = loop == null ? null : loop.path("statuses");
        int stayed = 0;
        for (int i = 1; i < coachTurns; i++) {
            String status = statuses == null || !statuses.isArray() ? "" : statuses.path(i).asText("");
            stayed = STAYS.contains(DirectVideoPracticeLoop.action(status)) ? stayed + 1 : 0;
        }
        return stayed;
    }

    /**
     * @param stayed 이 단계에서 이미 머문 횟수. 같은 단계에서 같은 방식으로 다시 묻지 않게, 횟수에 따라 묻는 법을 바꾼다:
     *               엇나감은 바꿔 묻기 → 보기 둘 → 코치가 답을 제안, 모름·짧은 답은 보기 둘 → 코치가 답을 제안.
     */
    static String route(Kind kind, Before b, int stayed) {
        if (kind == Kind.STOP || b.reply() >= LAST_REPLY || b.closeNext()) return END;
        // 정리한 다음 말에서 닫는다. 다만 배우가 물었으면 답하고, 그다음 말에서 닫는다(closesNext).
        if (b.lastDoing().startsWith(WRAP_UP)) return asked(kind) ? answerTo(kind, b) : END;
        if (b.lastDoing().startsWith("마무리") || b.lastDoing().startsWith("끝")) return END;
        if (b.reply() >= LAST_REPLY - 1) return WRAP_UP;
        // 코치가 답을 제안했으면, 배우가 받든(네) 다르게 답하든 다음 단계로 간다. 물음·정정은 먼저 받는다.
        if (b.lastDoing().startsWith(PROPOSE) && kind != Kind.CORRECTION && kind != Kind.PUSHBACK && kind != Kind.METHOD) return next(b.stage());
        // 같은 단계에 두 번 머물렀으면 묻기만 하지 않고 코치가 답을 제안한다.
        if (stayed >= 2 && (kind == Kind.MISSED || kind == Kind.SHORT || kind == Kind.QUESTION || kind == Kind.EVALUATION)) return PROPOSE;
        String pointOut = b.habitDropped() ? "짚어주기(다른 쪽)" : "짚어주기";
        return switch (kind) {
            case CORRECTION -> "내려놓기";
            case PUSHBACK -> "짚어주기(다른 쪽)";
            case EVALUATION -> pointOut;
            case QUESTION -> "답하기";
            // 질문이 잘못 전해졌다. 단계를 넘기지 않고 같은 것을 바꿔 묻는다. 두 번째면 보기 둘로 고르게 한다.
            case MISSED -> stayed >= 1 ? EASY : REASK;
            // 배우가 방법을 물었으면 질문으로 끌지 않고 정리에서 행동 하나를 준다.
            // 문제를 보여 주기 전(2단계)에 방법을 물으면, 먼저 문제를 보여 준다. 그 뒤로는 정리에서 행동을 준다.
            case METHOD -> b.stage() <= 2 ? GAP : WRAP_UP;
            // 스스로 알아챈 말은 그 단계의 답이다. 3단계에서 알아챘으면 4(스스로 찾기)로 간다.
            case INSIGHT, SELF_LINE -> next(b.stage());
            case SHORT -> stayed >= 1 ? PROPOSE : EASY;
            default -> next(b.stage());
        };
    }

    private static String next(int stage) {
        if (stage <= 1) return WANT;
        if (stage == 2) return GAP;
        if (stage == 3) return FIND;
        return WRAP_UP;
    }

    /** 이번 응답 뒤의 단계. 단계 질문을 했으면 그 단계로, 아니면 그대로. */
    static int stageAfter(String doing, Before b) {
        return switch (doing) {
            case WANT -> Math.max(b.stage(), 2);
            case GAP -> Math.max(b.stage(), 3);
            case FIND -> Math.max(b.stage(), 4);
            case EASY -> Math.max(b.stage(), 2);
            default -> b.stage();
        };
    }

    /** 쉽게 묻기에서 이번에 알아낼 것. 다음 단계의 목표다. */
    static String easyGoal(Before b) {
        // 짧게만 답한 그 단계 질문을 쉽게 다시 묻는다.
        return switch (Math.max(2, Math.min(4, b.stage()))) {
            case 2 -> "그 버릇이 나온 대사에서 인물이 상대에게서 무엇을 얻고 싶었는지";
            case 3 -> "그 버릇이 인물이 바라는 것을 돕는지, 가리는지";
            default -> "그 버릇 대신 무엇으로 그걸 상대에게 전할 수 있을지";
        };
    }

    /** 단계 이름과 이번 목표. [이번 응답]의 "지금 단계"에 실린다. */
    /** 배우가 단계 질문을 다르게 알아들었을 때. 같은 단계를 다른 말로 다시 묻는다. */
    static final String REASK = "다시 묻기";

    static String stageLine(String doing, Before b) {
        int target = switch (doing) {
            case WANT -> 2;
            case GAP -> 3;
            case FIND -> 4;
            case WRAP_UP -> 5;
            case EASY -> Math.max(2, b.stage());
            default -> Math.max(2, b.stage()); // 물음·정정·반박에 답한 뒤 돌아올 단계
        };
        String goal = switch (target) {
            case 2 -> "첫 질문 — 근본 문제를 풀 실마리를 배우 입에서 듣는다";
            case 3 -> "보여 주기와 어긋남 — 근본 문제를 배우의 첫 답에 비춰 처음 보여 주고, 배우가 어긋남을 스스로 보게 한다";
            case 4 -> "스스로 찾기 — 근본 문제를 풀 다음 테이크의 행동을 배우가 말하게 한다";
            default -> "정리 — 배우의 말을 다음 테이크에서 할 행동 하나로 확정한다";
        };
        // 첫 응답이 1단계(원하는 것)라 서버 단계 2~5를 배우 쪽 단계 1~4로 적는다.
        return (target - 1) + "/4 " + goal;
    }

    /** 배우가 단계 질문에 답한 말. 2단계 답은 첫 답(근본 문제에 따라 바람·인물 이해·직전 상황 등), 3단계는 알아챈 것, 4단계는 찾은 대안. */
    static final java.util.Map<Integer, String> ANSWER_FIELDS = java.util.Map.of(2, "첫 답", 3, "알아챈 것", 4, "찾은 대안");

    /** 이번 배우 말이 직전 단계 질문의 답이면 그 칸 이름. 짧은 답·물음·정정·반박·그만은 답으로 치지 않는다. */
    static String answerField(Kind kind, Before b) {
        boolean answered = kind == Kind.ANSWER || kind == Kind.CHOICE || kind == Kind.INSIGHT || kind == Kind.SELF_LINE;
        return answered ? ANSWER_FIELDS.get(b.stage()) : null;
    }

    /** 지금까지 저장된 단계 답(가장 최근 것). */
    static java.util.Map<String, String> answers(JsonNode loop, int coachTurns) {
        var found = new java.util.LinkedHashMap<String, String>();
        JsonNode statuses = loop == null ? null : loop.path("statuses");
        for (int i = 0; i < coachTurns; i++) {
            String status = statuses == null || !statuses.isArray() ? "" : statuses.path(i).asText("");
            for (String field : ANSWER_FIELDS.values()) {
                String value = DirectVideoPracticeLoop.statusField(status, field);
                if (!value.isEmpty()) found.put(field, value);
            }
        }
        return found;
    }

    /** 예전 판의 "답한 뒤 다음에 닫기". 이제는 단계로 정리에 가므로 쓰지 않는다. */
    /** 정리한 뒤 배우가 물었으면 이번엔 답하고, 다음 배우 말에서 닫는다. */
    static boolean closesNext(Kind kind, Before b) {
        if (kind == Kind.STOP || b.reply() >= LAST_REPLY || b.closeNext()) return false;
        return b.lastDoing().startsWith(WRAP_UP) && asked(kind);
    }

    private static boolean asked(Kind kind) {
        return kind == Kind.QUESTION || kind == Kind.EVALUATION || kind == Kind.METHOD;
    }

    private static String answerTo(Kind kind, Before b) {
        if (kind == Kind.EVALUATION) return b.habitDropped() ? "짚어주기(다른 쪽)" : "짚어주기";
        return "답하기";
    }

    /** 이번 응답 뒤의 피할 것. 정정·반박이면 지금 버릇을 더한다. */
    static List<String> avoidAfter(Before b, Kind kind, String habit) {
        var avoid = new LinkedHashSet<>(b.avoid());
        if ((kind == Kind.CORRECTION || kind == Kind.PUSHBACK) && habit != null && !habit.isBlank()) avoid.add(habit.strip());
        return List.copyOf(avoid);
    }

    /**
     * 서버가 정한 이번 응답을 모델에 알리는 칸. 공통 지시 맨 아래에 붙는다.
     * 할 일 이름·배우의 말 종류·횟수는 싣지 않는다 — 모델이 이름을 보고 틀에 맞춰 쓰지 않게, 그 상황의 설명만 준다.
     *
     * @param task 할 일 파일에서 고른 한 칸({@code "- 이름: …"}과 그 아래 들여 쓴 줄)
     */
    static String instruction(java.util.Locale language, String doing, List<String> avoid, String observed,
            String dialogue, String task) {
        return instruction(language, doing, avoid, observed, dialogue, task, null, List.of());
    }

    /**
     * @param stage 지금 단계 줄({@link #stageLine}). 없으면 싣지 않는다
     * @param materials 이번 응답의 재료 줄(처음 짚은 버릇, 버릇이 가리는 것, 배우가 단계마다 한 말, 방금 한 말)
     */
    static String instruction(java.util.Locale language, String doing, List<String> avoid, String observed,
            String dialogue, String task, String stage, List<String> materials) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        var lines = new ArrayList<String>();
        lines.add(korean ? "[이번 응답]" : "[This reply]");
        if (stage != null && !stage.isBlank()) lines.add((korean ? "지금 단계: " : "Current step: ") + stage);
        for (String line : task.split("\n")) {
            String body = line.startsWith("- " + doing + ":") ? line.substring(("- " + doing + ":").length()) : line;
            body = body.strip();
            if (!body.isEmpty()) lines.add(body);
        }
        if (!materials.isEmpty()) {
            lines.add("");
            lines.add(korean ? "재료" : "Material");
            materials.forEach(m -> lines.add("- " + m));
        }
        if (!avoid.isEmpty()) lines.add((korean ? "다시 꺼내지 않을 것: " : "Do not bring up again: ") + String.join(", ", avoid));
        if (!observed.isBlank()) lines.add("관찰 근거: " + observed);
        if (!dialogue.isBlank()) lines.add("대사 확인: " + dialogue);
        return String.join("\n", lines);
    }

    /**
     * 이번 응답의 상태 칸. 모델이 쓰던 것과 같은 칸 이름이다 — 노트·기억이 그대로 읽는다.
     * {@code 분류:} 줄은 이 분류를 누가 했는지(code/model/fallback) 남긴다.
     */
    static String status(String observed, String dialogue, Classified classified, Before b, String doing,
            String goal, List<String> avoid, String nextTake) {
        return status(observed, dialogue, classified, b, doing, goal, avoid, nextTake, false);
    }

    static String status(String observed, String dialogue, Classified classified, Before b, String doing,
            String goal, List<String> avoid, String nextTake, boolean closeNext) {
        return status(observed, dialogue, classified, b, doing, goal, avoid, nextTake, closeNext, null);
    }

    static String status(String observed, String dialogue, Classified classified, Before b, String doing,
            String goal, List<String> avoid, String nextTake, boolean closeNext, String actorText) {
        Tally after = b.tally().after(doing);
        var lines = new ArrayList<String>();
        if (!observed.isBlank()) lines.add("관찰 근거: " + observed);
        if (!dialogue.isBlank()) lines.add("대사 확인: " + dialogue);
        lines.add("배우의 말: " + classified.kind().label);
        lines.add("지금까지: 같은 버릇 질문 " + after.habitQuestions() + "번 · 짚어주기 " + after.pointOuts()
                + "번 · 방법 주기 " + after.methods() + "번 · 응답 " + b.reply() + "번째");
        lines.add("이번 목표: " + (goal == null || goal.isBlank() ? "없음" : goal));
        lines.add("피할 것: " + (avoid.isEmpty() ? "없음" : String.join(", ", avoid)));
        lines.add("할 일: " + doing);
        lines.add("다음 테이크: " + (nextTake == null || nextTake.isBlank() ? "없음" : nextTake));
        if (classified.keep()) lines.add("지키기: 예");
        if (closeNext) lines.add("다음에 닫기: 예");
        lines.add("단계: " + stageAfter(doing, b));
        String field = answerField(classified.kind(), b);
        if (field != null && actorText != null && !actorText.isBlank()) lines.add(field + ": " + actorText.strip().replaceAll("\\s+", " "));
        lines.add("분류: " + classified.by());
        return String.join("\n", lines);
    }
}
