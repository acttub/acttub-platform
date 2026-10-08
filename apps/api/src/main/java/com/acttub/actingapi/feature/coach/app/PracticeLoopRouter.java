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
        CHOICE("choice", "선택 설명"), INSIGHT("insight", "스스로 알아챔"), SHORT("short", "짧은 답"),
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

    /** 분류 호출에 넘기는 값. 종류 열한 개와, 배우가 그 버릇을 지키고 싶어 하는지 표시하는 {@code keep}. */
    static final String KEEP = "keep";
    static final List<String> SIGNALS;
    static {
        var ids = new ArrayList<String>();
        for (Kind kind : Kind.values()) ids.add(kind.id);
        ids.add(KEEP);
        SIGNALS = List.copyOf(ids);
    }

    /** 분류 결과. {@code by}는 model(분류 AI) / fallback(분류 실패, 보통 답으로 이어감). */
    record Classified(Kind kind, boolean keep, String by) {}

    /** 분류 호출의 응답 {@code {"signals":[...]}}을 읽는다. 여러 개면 보기 순서가 앞선 것. 형식이 틀리면 예외. */
    static Classified parse(String output) {
        var root = com.acttub.actingapi.integration.llm.StructuredJson.parse(output);
        if (!root.isObject() || !root.path("signals").isArray()) throw new IllegalArgumentException("invalid practice loop classification");
        Kind picked = null;
        boolean keep = false;
        for (JsonNode value : root.path("signals")) {
            if (!value.isTextual() || !SIGNALS.contains(value.asText())) {
                throw new IllegalArgumentException("unknown practice loop classification");
            }
            if (KEEP.equals(value.asText())) {
                keep = true;
                continue;
            }
            Kind kind = Arrays.stream(Kind.values()).filter(k -> k.id.equals(value.asText())).findFirst().orElseThrow();
            if (picked == null || kind.ordinal() < picked.ordinal()) picked = kind;
        }
        if (picked == null) throw new IllegalArgumentException("empty practice loop classification");
        return new Classified(picked, keep, "model");
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
     */
    record Before(int reply, String lastDoing, Kind lastKind, Tally tally, List<String> avoid,
            boolean habitDropped, boolean choiceExplained, boolean keep) {}

    static Before before(JsonNode loop, int coachTurns) {
        JsonNode statuses = loop == null ? null : loop.path("statuses");
        Tally tally = new Tally(0, 0, 0);
        String lastDoing = "비추기";
        Kind lastKind = null;
        var avoid = new LinkedHashSet<String>();
        boolean dropped = false;
        boolean choice = false;
        boolean keep = false;
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
            String avoided = DirectVideoPracticeLoop.statusField(status, "피할 것");
            if (!avoided.isEmpty() && !avoided.startsWith("없음")) {
                for (String part : avoided.split("\\s*[,·/]\\s*")) if (!part.isBlank()) avoid.add(part.strip());
            }
        }
        return new Before(coachTurns + 1, lastDoing, lastKind, tally, List.copyOf(avoid), dropped, choice, keep);
    }

    /** 응답 상한. {@link ConversationService#THREE_LAYERS_REPLY_LIMIT}과 같다. */
    static final int LAST_REPLY = ConversationService.THREE_LAYERS_REPLY_LIMIT;

    /** 할 일 표. 위에서부터 먼저 맞는 줄 하나. */
    static String route(Kind kind, Before b) {
        String pointOut = b.habitDropped() ? "짚어주기(다른 쪽)" : "짚어주기";
        if (kind == Kind.STOP) return "끝";
        if (b.lastDoing().startsWith("마무리2") || b.lastDoing().startsWith("끝")) return "끝";
        if (b.reply() >= LAST_REPLY) return "마무리2";
        if (kind == Kind.SELF_LINE) return "마무리2";
        if (b.lastDoing().startsWith("마무리1")) return "마무리2";
        if (b.reply() >= LAST_REPLY - 1) return "마무리1";
        if (kind == Kind.CORRECTION) return "내려놓기";
        if (kind == Kind.PUSHBACK) return "짚어주기(다른 쪽)";
        if (kind == Kind.METHOD) return b.tally().methods() >= 2 ? "마무리2" : "방법 주기";
        if (kind == Kind.EVALUATION) {
            if (b.tally().pointOuts() < 2) return pointOut;
            return b.tally().methods() >= 2 ? "마무리1" : "방법 주기";
        }
        if (kind == Kind.CHOICE) return b.tally().habitQuestions() <= 2 ? "이어보기(선택)" : "마무리1";
        if (kind == Kind.INSIGHT) return b.reply() >= 5 ? "마무리1" : "이어보기";
        if (kind == Kind.SHORT) {
            if (b.lastKind() != Kind.SHORT) return "파고들기(쉬운)";
            return b.tally().pointOuts() >= 2 ? "마무리1" : pointOut;
        }
        if (kind == Kind.QUESTION) return "답하기";
        if (b.tally().habitQuestions() >= 3) return "마무리1";
        return b.lastDoing().startsWith("비추기") ? "파고들기" : "이어보기";
    }

    /** 이번 응답 뒤의 피할 것. 정정·반박이면 지금 버릇을 더한다. */
    static List<String> avoidAfter(Before b, Kind kind, String habit) {
        var avoid = new LinkedHashSet<>(b.avoid());
        if ((kind == Kind.CORRECTION || kind == Kind.PUSHBACK) && habit != null && !habit.isBlank()) avoid.add(habit.strip());
        return List.copyOf(avoid);
    }

    /** 이번 응답이 마무리2일 때 다음 테이크 쪽. 배우가 그 버릇을 선택이라 했거나 지키겠다고 했으면 지키며. */
    static boolean keepsHabit(Before b, Classified classified) {
        return b.choiceExplained() || b.keep() || classified.keep();
    }

    /**
     * 서버가 정한 이번 응답을 모델에 알리는 칸. 공통 지시 맨 아래에 붙는다.
     *
     * @param selfLine 마무리2에서 옮길 배우의 한 줄. 없으면 {@code null}
     * @param designNext 설계의 다음 테이크(반대로일 때 건넬 행동)
     */
    static String instruction(java.util.Locale language, String doing, Classified classified, Before b, String goal,
            List<String> avoid, String observed, String dialogue, String selfLine, String designNext, String task) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        var lines = new ArrayList<String>();
        lines.add(korean ? "[이번 응답]" : "[This reply]");
        lines.add("할 일: " + doing);
        lines.add("배우의 말: " + classified.kind().label);
        lines.add("지금까지: 같은 버릇 질문 " + b.tally().habitQuestions() + "번 · 짚어주기 " + b.tally().pointOuts()
                + "번 · 방법 주기 " + b.tally().methods() + "번 · 이번이 응답 " + b.reply() + "번째");
        if (goal != null && !goal.isBlank()) lines.add("이번 목표: " + goal);
        lines.add("피할 것: " + (avoid.isEmpty() ? "없음" : String.join(", ", avoid)));
        if (!observed.isBlank()) lines.add("관찰 근거: " + observed);
        if (!dialogue.isBlank()) lines.add("대사 확인: " + dialogue);
        if (doing.startsWith("마무리2")) {
            lines.add("배우의 한 줄: " + (selfLine == null || selfLine.isBlank() ? "없음" : selfLine.strip()));
            lines.add("다음 테이크: " + (keepsHabit(b, classified) ? "지키며"
                    : "반대로: " + (designNext == null || designNext.isBlank() ? "없음" : designNext)));
        }
        lines.add("");
        lines.add(korean ? "쓰는 법:" : "How to write it:");
        lines.add(task);
        return String.join("\n", lines);
    }

    /**
     * 이번 응답의 상태 칸. 모델이 쓰던 것과 같은 칸 이름이다 — 노트·기억이 그대로 읽는다.
     * {@code 분류:} 줄은 이 분류를 누가 했는지(code/model/fallback) 남긴다.
     */
    static String status(String observed, String dialogue, Classified classified, Before b, String doing,
            String goal, List<String> avoid, String nextTake) {
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
        lines.add("분류: " + classified.by());
        return String.join("\n", lines);
    }
}
