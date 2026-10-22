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
     * 4) decided: 다음 테이크에 상대에게 할 행동 하나를 배우가 정해서 말했다 / ack: 새 내용 없이 맞장구·인사만 했다
     *    (2026-10-11 운영: 배우가 "고민이 된다", "이해가 안가요"라고 해도 answered라서 바로 정리로 넘어갔다)
     * 5) want: 배우가 상대(또는 자기)에게서 얻고 싶은 것을 새로 말하거나 고쳐 말했다 / line_fix: 코치가 짚은 대사가 다른 장면이라고 바로잡았다
     *    (2026-10-13 18:59 운영: 4단계에서 "위로받고 싶어"는 행동이 아니라 저장되지 않았고, 정리는 첫 답만 보고 "상대를 비웃어 봐도"로 끝났다.
     *     배우가 "그건 교수 흉내 부분"이라고 한 대사를 정리가 세 번 다시 썼다)
     */
    static final List<String> STEP = List.of("answered", "missed", "not_yet");
    // why: 코치가 왜 그렇게 봤는지·어디서 그렇게 보였는지 근거를 묻는 말. 정정·반박보다 먼저 본다 — 동의하지 않으면서 근거를 물으면 근거부터 답해야 한다
    // (2026-10-20~21 운영: "어떤부분이 그렇게 보였을까", "왜 제가 한대로 하면 안되는건가요?"에 근거 없이 제안만 했다).
    static final List<String> RESPOND = List.of("why", "correction", "pushback", "method", "evaluation", "question");
    /** 근거를 묻는 말. 종류는 물음이고 {@code respond}에 이 값이 남아 재료에서 근거부터 답하게 한다. */
    static final String WHY = "why";
    static final String STOP_SIGNAL = "stop";
    static final String DECIDED_SIGNAL = "decided";
    static final String ACK_SIGNAL = "ack";
    static final String WANT_SIGNAL = "want";
    static final String LINE_FIX_SIGNAL = "line_fix";
    static final List<String> SIGNALS;
    static {
        var ids = new ArrayList<String>(STEP);
        ids.addAll(RESPOND);
        ids.add(STOP_SIGNAL);
        ids.add(DECIDED_SIGNAL);
        ids.add(ACK_SIGNAL);
        ids.add(WANT_SIGNAL);
        ids.add(LINE_FIX_SIGNAL);
        SIGNALS = List.copyOf(ids);
    }

    /**
     * 분류 결과. {@code kind}는 코드가 분기에 쓰는 종류, {@code respond}는 단계 질문에 답하면서 함께 물은 것
     * (question / evaluation / method, 없으면 빈 문자열). {@code by}는 model / fallback.
     */
    record Classified(Kind kind, boolean keep, String by, String respond, boolean decided, boolean ack, boolean want, boolean lineFix) {
        Classified(Kind kind, boolean keep, String by, String respond, boolean decided, boolean ack) {
            this(kind, keep, by, respond, decided, ack, false, false);
        }

        Classified(Kind kind, boolean keep, String by) {
            this(kind, keep, by, "");
        }

        /** 스스로 찾기 판단이 없는 분류(버튼·예전 상태 칸·분류 실패)는 예전처럼 답이면 행동을 정한 것으로 본다. */
        Classified(Kind kind, boolean keep, String by, String respond) {
            this(kind, keep, by, respond, true, false);
        }

        boolean alsoAsked() {
            return !respond.isEmpty();
        }

        /** 바람·대사 정정 표시를 붙인다. 종류와 상관없이 붙는다(정정하면서 바람을 고쳐 말하는 일이 흔하다). */
        Classified with(boolean want, boolean lineFix) {
            return new Classified(kind, keep, by, respond, decided, ack, want, lineFix);
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
        boolean decided = false;
        boolean ack = false;
        boolean want = false;
        boolean lineFix = false;
        for (JsonNode value : root.path("signals")) {
            String id = value.isTextual() ? value.asText() : "";
            if (!SIGNALS.contains(id)) throw new IllegalArgumentException("unknown practice loop classification");
            if (STOP_SIGNAL.equals(id)) stop = true;
            else if (DECIDED_SIGNAL.equals(id)) decided = true;
            else if (ACK_SIGNAL.equals(id)) ack = true;
            else if (WANT_SIGNAL.equals(id)) want = true;
            else if (LINE_FIX_SIGNAL.equals(id)) lineFix = true;
            else if (STEP.contains(id)) { if (step == null) step = id; }
            else if (respond == null || RESPOND.indexOf(id) < RESPOND.indexOf(respond)) respond = id;
        }
        if (stop) return new Classified(Kind.STOP, false, "model");
        if (step == null && respond == null) throw new IllegalArgumentException("empty practice loop classification");
        return kindOf(step, respond, decided, ack).with(want, lineFix);
    }

    private static Classified kindOf(String step, String respond, boolean decided, boolean ack) {
        if (WHY.equals(respond)) return new Classified(Kind.QUESTION, false, "model", WHY, decided, ack);
        if ("correction".equals(respond)) return new Classified(Kind.CORRECTION, false, "model");
        if ("pushback".equals(respond)) return new Classified(Kind.PUSHBACK, false, "model");
        if ("answered".equals(step)) return new Classified(Kind.ANSWER, false, "model", respond == null ? "" : respond, decided, ack);
        if ("missed".equals(step)) return new Classified(Kind.MISSED, false, "model");
        if ("method".equals(respond)) return new Classified(Kind.METHOD, false, "model");
        if ("evaluation".equals(respond)) return new Classified(Kind.EVALUATION, false, "model");
        if ("question".equals(respond)) return new Classified(Kind.QUESTION, false, "model");
        return new Classified(Kind.SHORT, false, "model");
    }

    /** 정리한 뒤의 말은 단계가 없으니, 함께 물은 게 있으면 그 물음으로 본다(답해 주고 다음 말에서 닫는다). 정리 뒤 답한 다음 말도 같다. */
    static Classified forRouting(Classified c, Before b) {
        if (WHY.equals(c.respond())) return c; // 이미 물음이다. 근거 표시를 지우지 않는다
        if (!(b.lastDoing().startsWith(WRAP_UP) || b.closeNext()) || !c.alsoAsked()) return c;
        Kind asked = switch (c.respond()) {
            case "evaluation" -> Kind.EVALUATION;
            case "method" -> Kind.METHOD;
            default -> Kind.QUESTION;
        };
        return new Classified(asked, c.keep(), c.by()).with(c.want(), c.lineFix());
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
     * 정리한 다음 배우 말이 맞장구면 닫고, 그 밖이면 한 번 받아 준 뒤 닫는다. 받아 준 다음에도 배우가 또 물으면 답하고,
     * 묻지 않은 말에서 닫는다. 그만과 상한(24번째)은 바로 닫는다.
     */
    static String route(Kind kind, Before b) {
        return route(kind, b, 0);
    }

    /** 단계를 넘기지 않고 머문 할 일. 같은 단계에서 몇 번째 묻는지 셀 때 쓴다. */
    static final String PROPOSE = "답 제안하기";
    static final String LET_GO = "내려놓기";
    static final String POINT_OUT_OTHER = "짚어주기(다른 쪽)";

    /** 단계 질문에 답한 말(정리 뒤 다시 정리할 재료가 되는 말). */
    private static boolean answeredStep(Kind kind) {
        return kind == Kind.ANSWER || kind == Kind.CHOICE || kind == Kind.INSIGHT || kind == Kind.SELF_LINE;
    }
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
        return route(new Classified(kind, false, "code"), b, stayed);
    }

    /**
     * 흐름(SOMA-636 A/B)을 따르는 할 일. B는 "스스로 찾기"를 건너뛴다 — 코치가 본 것을 말한 다음(어긋남 보기 자리)
     * 배우가 받으면 바로 정리에서 코치가 행동 하나를 제안한다. 물음·정정·반박·제안 같은 나머지 표는 A와 같다.
     */
    static String route(Classified c, Before b, int stayed, String flow) {
        String doing = route(c, b, stayed);
        return CoachFlows.B.equals(flow) && FIND.equals(doing) ? WRAP_UP : doing;
    }

    /** 묻는 할 일 — 맞춤 코칭의 질문 수 상한이 세는 것. 물음·정정에 답하는 말(답하기·내려놓기)은 세지도 막지도 않는다. */
    static final java.util.Set<String> ASKING = java.util.Set.of(WANT, GAP, FIND, EASY, "다시 묻기", PROPOSE, POINT_OUT_OTHER);

    /**
     * 맞춤 코칭의 정리 전 질문 수 상한(SOMA-795). 상한만큼 물었으면 더 묻는 할 일 대신 정리로 넘긴다. 배우가 묻거나 고쳐 말한
     * 것에는 그대로 답한다(답하기·내려놓기·짚어주기). 상한이 없으면 지금 그대로다.
     *
     * @param asked 지금까지 코치가 물은 수(첫 질문 포함, {@link #questionsAsked})
     */
    static String route(Classified c, Before b, int stayed, String flow, Integer maxQuestions, int asked) {
        String doing = route(c, b, stayed, flow);
        if (maxQuestions == null || asked < maxQuestions || !ASKING.contains(doing)) return doing;
        return WRAP_UP;
    }

    /** 지금까지 코치가 물은 수. 첫 응답(첫 질문)과 그 뒤 묻는 할 일({@link #ASKING})을 센다. */
    static int questionsAsked(JsonNode loop, int coachTurns) {
        if (coachTurns <= 0) return 0;
        JsonNode statuses = loop == null ? null : loop.path("statuses");
        int asked = 1;
        for (int i = 1; i < coachTurns; i++) {
            String status = statuses == null || !statuses.isArray() ? "" : statuses.path(i).asText("");
            if (ASKING.contains(DirectVideoPracticeLoop.action(status))) asked++;
        }
        return asked;
    }

    static String route(Classified c, Before b, int stayed) {
        Kind kind = c.kind();
        if (kind == Kind.STOP || b.reply() >= LAST_REPLY) return END;
        // 정리 뒤 한 번 받아 준 다음 말: 또 물었으면(물음·방법·판단 요청·반박·정정) 답하고, 그 밖이면 닫는다.
        // 2026-10-11 17:56 운영: 받아 준 뒤 배우가 "?반응을 어케봐?"라고 물었는데 대꾸 없이 "오늘은 여기까지 해요"로 닫혔다.
        // 정리 뒤 배우가 아니라고 해서 배우 해석을 물었으면(내려놓기), 배우가 말한 해석으로 한 번 더 정리한다.
        // 2026-10-20 23:35 운영(자문): 정리 뒤 정정 네 번에 코치가 매번 새 해석을 제안했다("그 해석이면 ~해 봐도 좋아요").
        if (b.closeNext() && b.lastDoing().startsWith(LET_GO) && answeredStep(kind) && !c.ack()) return WRAP_UP;
        if (b.closeNext()) return asksAgain(c) ? answerTo(c, b) : END;
        // 정리한 다음 말: 맞장구·짧은 말이면 닫는다. 그 밖(다른 해석, 덧붙인 생각, 물음, 반박)은 한 번 받아 주고 그다음 말에서 닫는다(closesNext).
        if (b.lastDoing().startsWith(WRAP_UP)) return endsAfterWrap(c) ? END : answerTo(c, b);
        if (b.lastDoing().startsWith("마무리") || b.lastDoing().startsWith("끝")) return END;
        if (b.reply() >= LAST_REPLY - 1) return WRAP_UP;
        // 코치가 답을 제안했으면, 배우가 받든(네) 다르게 답하든 다음 단계로 간다. 물음·정정은 먼저 받는다.
        if (b.lastDoing().startsWith(PROPOSE) && kind != Kind.CORRECTION && kind != Kind.PUSHBACK && kind != Kind.METHOD
                && kind != Kind.QUESTION && kind != Kind.EVALUATION) return next(b.stage());
        // 같은 단계에 두 번 머물렀으면 묻기만 하지 않고 코치가 답을 제안한다.
        // 배우가 묻거나 피드백을 달라는 말에는 몇 번째든 답한다 — 제안으로 대신하면 물음에 답하지 않은 게 된다(10/12 시험 세트: 물음 34개 중 20개만 답함).
        if (stayed >= 2 && (kind == Kind.MISSED || kind == Kind.SHORT)) return PROPOSE;
        // 평가 요청에는 버릇을 내려놓은 뒤에도 판단을 준다(내려놓은 주제는 피할 것으로 빠진다).
        // 2026-10-20 21:34 운영: 정정 뒤 "연기력이랑 목소리는 어때"에 다른 쪽 강점 질문("어디서 더 써 볼래요?")으로 답했다.
        String pointOut = "짚어주기";
        // 정리로 넘어가는 문턱: 스스로 찾기(4단계)에 답했어도 상대에게 할 행동 하나를 정하지 않았으면(고민 중, 헷갈림, 전제 반박,
        // 판단 요청) 정리하지 않는다. 물은 것이 있으면 먼저 답하고, 없으면 바꿔 묻기 → 보기 둘 → 코치가 제안 순서로 머문다.
        if (kind == Kind.ANSWER && b.stage() >= 4 && !c.decided()) {
            return switch (c.respond()) {
                case "evaluation" -> pointOut;
                case "question" -> "답하기";
                case "method" -> WRAP_UP;
                // 행동 대신 바람을 말했으면(위로받고 싶어) 그 바람이 답의 재료다. 다시 묻지 않고 정리에서 그 바람을 얻을 행동 하나를 제안한다.
                // 바람도 행동도 아닌 답이면 한 번만 바꿔 묻고, 그다음에는 보기 둘·"어때요?" 제안을 거치지 않고 정리에서 코치가 행동을 준다.
                // 2026-10-22 00:16 운영(자문): "화를 낼거같아", "쫄았으면 좋겠어"라고 답했는데 "장면 내내 뭘 해 볼래요?"를 말만 바꿔 네 번 물었다
                // (자문 평가: "질문을 반복적으로 하는데 … 차이를 못느끼겠습니다").
                default -> c.want() || stayed >= 1 ? WRAP_UP : REASK;
            };
        }
        return switch (kind) {
            case CORRECTION -> "내려놓기";
            // 반박이 이어지면 같은 방식(받고 강점 묻기)을 되풀이하지 않고 질문 없이 판단을 준다.
            // 2026-10-17 20:56 운영: "다른질문" → "너 내 대답 듣고잇니" → "너는 너 할말만 햇음"까지 반박 네 번에 같은 할 일이 네 번 나갔다.
            case PUSHBACK -> b.lastKind() == Kind.PUSHBACK || b.lastDoing().startsWith(POINT_OUT_OTHER) ? "짚어주기" : POINT_OUT_OTHER;
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

    /** 흐름을 따르는 단계 줄. B는 어긋남 보기 자리에서 코치가 본 것을 먼저 말하고, 스스로 찾기 없이 정리로 간다. */
    static String stageLine(String doing, Before b, String flow) {
        String line = stageLine(doing, b);
        if (!CoachFlows.B.equals(flow)) return line;
        if (line.startsWith("2/4 ")) return "2/4 코치가 본 것 — 근본 문제를 대사 두 곳과 이유로 코치가 먼저 말한다. 해결책은 아직 말하지 않는다";
        if (line.startsWith("4/4 ")) return "4/4 정리 — 배우가 말한 바람을 얻을 행동 하나를 코치가 제안해 확정한다";
        return line;
    }

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

    /** 4단계 답은 행동을 정했을 때만 "찾은 대안"으로 남긴다 — 고민·질문을 대안으로 저장하면 정리가 근거 없이 "맞아요"를 붙인다. */
    static String answerField(Classified c, Before b) {
        if (b.stage() >= 4 && !c.decided()) return null;
        return answerField(c.kind(), b);
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

    /** 배우가 바람을 새로 말하거나 고쳐 말한 말을 남기는 상태 칸. */
    static final String WANT_FIELD = "최신 바람";
    /** 배우가 코치가 짚은 대사를 다른 장면이라고 바로잡았다는 상태 칸. */
    static final String LINE_FIX_FIELD = "대사 정정";

    /** 지금까지 배우가 가장 나중에 말한 바람. 없으면 빈 문자열. */
    static String latestWant(JsonNode loop, int coachTurns) {
        String found = "";
        JsonNode statuses = loop == null ? null : loop.path("statuses");
        for (int i = 0; i < coachTurns; i++) {
            String status = statuses == null || !statuses.isArray() ? "" : statuses.path(i).asText("");
            String value = DirectVideoPracticeLoop.statusField(status, WANT_FIELD);
            if (!value.isEmpty()) found = value;
        }
        return found;
    }

    /** 배우가 이 대화에서 코치가 짚은 대사를 바로잡은 적이 있는지. */
    static boolean lineFixed(JsonNode loop, int coachTurns) {
        JsonNode statuses = loop == null ? null : loop.path("statuses");
        for (int i = 0; i < coachTurns; i++) {
            String status = statuses == null || !statuses.isArray() ? "" : statuses.path(i).asText("");
            if (DirectVideoPracticeLoop.statusField(status, LINE_FIX_FIELD).startsWith("예")) return true;
        }
        return false;
    }

    /** 예전 판의 "답한 뒤 다음에 닫기". 이제는 단계로 정리에 가므로 쓰지 않는다. */
    /** 정리한 뒤 배우가 물었으면 이번엔 답하고, 다음 배우 말에서 닫는다. 그 말에서 또 물었으면 또 답하고 그다음에 닫는다. */
    static boolean closesNext(Kind kind, Before b) {
        return closesNext(new Classified(kind, false, "code"), b);
    }

    static boolean closesNext(Classified c, Before b) {
        if (c.kind() == Kind.STOP || b.reply() >= LAST_REPLY) return false;
        if (b.closeNext()) return asksAgain(c);
        return b.lastDoing().startsWith(WRAP_UP) && !endsAfterWrap(c);
    }

    /** 정리 뒤 받아 준 다음에도 답해야 하는 말: 물음·방법 요청·판단 요청·반박·정정·코치 말을 못 알아들음. */
    private static boolean asksAgain(Classified c) {
        return switch (c.kind()) {
            case QUESTION, METHOD, EVALUATION, PUSHBACK, CORRECTION, MISSED -> true;
            default -> false;
        };
    }

    /** 정리 뒤 바로 닫을 말: 한두 마디 짧은 말("네", "몰라요")과 새 내용 없는 맞장구·인사("감사합니다, 해 볼게요"). */
    private static boolean endsAfterWrap(Classified c) {
        return c.kind() == Kind.SHORT || (c.kind() == Kind.ANSWER && c.ack());
    }

    private static String answerTo(Classified c, Before b) {
        Kind kind = c.kind();
        if (kind == Kind.EVALUATION) return "짚어주기";
        // 정리를 아니라고만 하고 자기 해석(바람)을 말하지 않았으면 코치가 새 해석을 짐작하지 않고 배우가 하려던 것을 묻는다
        // (다음 말에서 그 해석으로 다시 정리한다). 해석을 말했으면 예전처럼 그 해석을 따라 마지막 말을 한다.
        if (kind == Kind.CORRECTION && !c.want()) return LET_GO;
        return "답하기";
    }

    // 앱(0.1.4, #616)과 웹에서 "예시로 설명"·"나중에 연습" 고정 버튼을 없앴다(2026-10-14). 예전 앱에서 같은 문구가 와도
    // 배우가 직접 쓴 말처럼 분류 AI가 판단한다(예시 요청은 물음, 나중에 연습은 방법 요청).

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
        String field = answerField(classified, b);
        if (field != null && actorText != null && !actorText.isBlank()) lines.add(field + ": " + actorText.strip().replaceAll("\\s+", " "));
        if (classified.want() && actorText != null && !actorText.isBlank()) lines.add(WANT_FIELD + ": " + actorText.strip().replaceAll("\\s+", " "));
        if (classified.lineFix()) lines.add(LINE_FIX_FIELD + ": 예");
        lines.add("분류: " + classified.by());
        return String.join("\n", lines);
    }
}
