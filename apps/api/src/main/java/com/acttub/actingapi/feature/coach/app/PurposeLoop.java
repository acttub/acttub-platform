package com.acttub.actingapi.feature.coach.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 목적별 코칭(SOMA-719). 앱이 코칭을 시작할 때 고른 세션 목적(평가 받기·막힌 곳 풀기·인물 이해하기)마다 대화 단계와
 * 프롬프트가 다르다. 목적이 없는 회차(옛 앱)는 이 갈래를 타지 않고 지금 연습 루프 그대로다.
 *
 * <p>단계는 <b>코드가</b> 정한다. 배우가 직전 코치 답의 버튼을 그대로 눌렀으면 분류 AI 없이 단계 답으로 보고(속도·비용),
 * 직접 썼으면 지금 분류 AI({@link PracticeLoopRouter#parse})가 나눈 종류로 정한다. 모델은 정해진 단계의 말과 숨은 칸만 쓴다.
 *
 * <p>모델 출력의 숨은 칸: {@code <보기>}(답 버튼, 최대 3개, 줄 머리에 영상 시간을 붙일 수 있다), {@code <카드>}(평가 결과),
 * {@code <인물 카드>}(인물 여섯 칸), {@code <장면>}(배우가 바로잡은 장면), {@code <다음 테이크>}(정리의 행동 한 줄).
 * 서버가 걷어 내 상태 {@code purpose_loop} 에 두고 응답의 {@code purpose} 로 내보낸다. 코치 말에는 남지 않는다.
 */
final class PurposeLoop {
    private PurposeLoop() {}

    static final String STATE_KEY = "purpose_loop";
    /** 한 단계에서 머문(물음에 답하기·정정 받기·쉽게 다시 묻기) 응답이 이만큼 쌓이면 다음 단계로 넘긴다. */
    static final int MAX_STAYS = 2;
    /** 목적 대화의 코치 응답 상한(시작 응답 포함). 상한을 채우는 응답은 정리다. */
    static final int REPLY_CAP = 9;
    /** 인물 카드에서 빈 칸을 묻는 응답의 최대 수. */
    static final int MAX_CELLS = 3;
    /** 막힌 곳·인물에서 코치가 묻는 응답의 최대 수(시작 질문 포함). 넘으면 코치가 방향을 정해 주며 정리한다(10/20 사용자 결정). */
    static final int MAX_QUESTIONS = 2;

    /**
     * 영상 없이 말로 하는 회차(SOMA-745)의 목적 앞 표시. 저장소가 영상 없는 회차의 목적에 붙여 넘긴다({@code talk:stuck}).
     * API·화면의 목적 값은 붙이지 않은 그대로다({@link Purpose#id}).
     */
    static final String TALK_PREFIX = "talk:";

    /**
     * 목적. 영상 없이 말로 하는 갈래(TALK_STUCK·TALK_CHARACTER·CONCERN, SOMA-745)는 같은 단계 기계를 쓰되, 영상을 보는 단계(그곳에서
     * 본 것)가 없고 프롬프트는 {@code purpose/talk/} 에서 읽는다. 공통 지시({@code turn}·{@code first-common})에는 영상 없는 모드
     * 지시({@code talk/mode})를 덧붙인다.
     */
    enum Purpose {
        EVALUATE("evaluate", "evaluate", List.of("card", "method", "wrap")),
        STUCK("stuck", "stuck", List.of("reason", "line", "seen", "method", "wrap")),
        CHARACTER("character", "character", List.of("view", "cell", "wrap")),
        TALK_STUCK("stuck", "talk/stuck", List.of("reason", "line", "method", "wrap")),
        TALK_CHARACTER("character", "talk/character", List.of("view", "cell", "wrap")),
        CONCERN("concern", "talk/concern", List.of("concern", "need", "wrap"));

        final String id;
        /** 프롬프트 폴더({@code coaching/direct-video/purpose/<dir>}). */
        final String dir;
        final List<String> steps;

        Purpose(String id, String dir, List<String> steps) {
            this.id = id;
            this.dir = dir;
            this.steps = steps;
        }

        /** 영상 없이 말로 하는 갈래인가. */
        boolean talk() {
            return dir.startsWith("talk/");
        }

        /** 인물 이해하기(영상 있음·없음). 인물 카드를 채운다. */
        boolean character() {
            return this == CHARACTER || this == TALK_CHARACTER;
        }

        /** 코치가 읽는 목적 값으로 찾는다. 말 표시({@link #TALK_PREFIX})가 있으면 말로 하는 갈래에서만 찾는다. */
        static Purpose of(String value) {
            if (value == null) return null;
            String key = value.strip();
            boolean talk = key.startsWith(TALK_PREFIX);
            if (talk) key = key.substring(TALK_PREFIX.length());
            for (Purpose purpose : values()) if (purpose.talk() == talk && purpose.id.equals(key)) return purpose;
            return null;
        }
    }

    /** 이 회차의 목적. 목적이 없으면 {@code null}. */
    static Purpose of(CoachSessionSnapshot session) {
        return session == null ? null : Purpose.of(session.sessionPurpose());
    }

    /** 서버가 늘 같은 뜻으로 읽는 버튼. */
    static final String DONT_KNOW = "잘 모르겠어요";
    static final String FIX_TOGETHER = "코치와 같이 고치기";
    static final String ANOTHER = "다른 것도 봐 주세요";

    private static final Map<String, String> STEP_NAMES = Map.ofEntries(
            Map.entry("card", "결과 카드"), Map.entry("intent", "하려던 것"), Map.entry("method", "방법 고르기"),
            Map.entry("reason", "어떻게 막혔는지"), Map.entry("line", "어느 대사인지"), Map.entry("seen", "그곳에서 본 것"),
            Map.entry("view", "어떤 사람으로 봤는지"), Map.entry("cell", "인물 카드 채우기"), Map.entry("wrap", "정리"),
            Map.entry("concern", "어떤 고민인지"), Map.entry("need", "무엇이 필요한지"));

    // ---- 이번 응답 정하기 ----

    /**
     * 이번 응답. {@code step} 은 응답 뒤의 단계, {@code doing} 은 이번 응답이 할 일(단계 이름, 또는 머무는 말
     * answer·accept·easy·propose·another)이다. {@code end} 면 모델을 부르지 않고 닫는다. {@code answeredStep} 은 배우의
     * 이번 말이 답한 단계(재료로 남긴다), 없으면 {@code null}.
     */
    record Turn(Purpose purpose, String step, String doing, boolean advanced, boolean end, String kindLabel,
            boolean chip, String answeredStep, boolean asked, boolean direct, boolean dontKnow) {
        Turn(Purpose purpose, String step, String doing, boolean advanced, boolean end, String kindLabel,
                boolean chip, String answeredStep) {
            this(purpose, step, doing, advanced, end, kindLabel, chip, answeredStep, false, false, false);
        }

        Turn asking() {
            return new Turn(purpose, step, doing, advanced, end, kindLabel, chip, answeredStep, true, direct, dontKnow);
        }

        Turn notKnowing() {
            return new Turn(purpose, step, doing, advanced, end, kindLabel, chip, answeredStep, asked, direct, true);
        }

        /** 배우가 방향을 원한다 — 더 묻지 않고 코치가 직접 정해 주는 정리. */
        static Turn directing(Purpose purpose, String label, boolean chip, String answeredStep, boolean dontKnow) {
            return new Turn(purpose, "wrap", "wrap", true, false, label, chip, answeredStep, false, true, dontKnow);
        }

        boolean wrap() {
            return "wrap".equals(doing);
        }
    }

    /** 직전 코치 답이 내준 버튼 중 배우 말과 글이 같은 것(줄 머리의 영상 시간은 빼고 비교한다). 없으면 {@code null}. */
    static String pressed(JsonNode state, String actorText) {
        if (actorText == null) return null;
        String text = actorText.strip();
        if (text.isEmpty()) return null;
        for (JsonNode choice : loop(state).path("choices")) {
            String label = choice.path("label").asText("");
            if (!label.isEmpty() && (label.equals(text) || withoutTime(label).equals(withoutTime(text)))) return label;
        }
        return null;
    }

    /** 배우가 그만하겠다고 했을 때. */
    static Turn ended(Purpose purpose, JsonNode state) {
        return new Turn(purpose, current(purpose, loop(state)), "end", false, true, PracticeLoopRouter.Kind.STOP.label, false, null);
    }

    /**
     * 다음 응답을 정한다. {@code classified} 는 버튼을 누르지 않았을 때만 있는 분류 결과다. {@code replies} 는 지금까지의
     * 코치 응답 수(시작 응답 포함)다.
     */
    static Turn decide(Purpose purpose, JsonNode state, String actorText, String pressed,
            PracticeLoopRouter.Classified classified, int replies) {
        ObjectNode loop = loop(state);
        int index = index(purpose, loop);
        String current = purpose.steps.get(index);
        int stays = loop.path("stays").asInt(0);
        boolean chip = pressed != null;
        PracticeLoopRouter.Kind kind = classified == null ? PracticeLoopRouter.Kind.ANSWER : classified.kind();
        String label = chip ? "버튼" : kind.label;
        if (!chip && kind == PracticeLoopRouter.Kind.STOP) {
            return new Turn(purpose, current, "end", false, true, label, false, null);
        }
        boolean answerLike = chip ? !DONT_KNOW.equals(pressed) && !FIX_TOGETHER.equals(pressed) && !ANOTHER.equals(pressed)
                : switch (kind) {
                    case ANSWER, SELF_LINE, CHOICE, INSIGHT -> true;
                    default -> false;
                };
        // 대화 이어하기(SOMA-782): 다시 연 뒤에는 그때부터 센다 — 상한이 이어 가는 말마다 곧바로 정리를 만들지 않게 한다.
        if (resumedAt(loop) >= 0) replies = Math.max(0, replies - resumedAt(loop));
        // 상한을 채우는 응답은 무엇을 말했든 정리다.
        if (replies >= REPLY_CAP - 1) {
            return new Turn(purpose, "wrap", "wrap", true, false, label, chip, answerLike ? current : null);
        }
        // 영상 없이 말로: 정리한 뒤 이어 간 대화에서 배우가 물으면 정리를 다시 하지 않고 물음에만 답한다. 대화는 열어 둔다.
        // 2026-10-25·26 운영: 정리 뒤 "예시로 읽어줄 수 있어?", "드라마 연기를 따라 하고 싶으면 어떻게 하나요?"에 정리를 한 번 더 하고 닫았다.
        if (purpose.talk() && !chip && "wrap".equals(current) && asksAfterWrap(kind, actorText)) {
            return new Turn(purpose, current, "answer", false, false, label, false, null);
        }
        // 스무고개 막기(10/20 페르소나 시험): "잘 모르겠어요"가 대화에서 두 번째이거나, 배우가 "그래서 어떻게 해요?"처럼
        // 방법을 달라고 하면 더 묻지 않고 코치가 영상에서 본 것으로 직접 방향을 정해 주며 끝낸다.
        boolean dontKnow = chip ? DONT_KNOW.equals(pressed)
                : (kind == PracticeLoopRouter.Kind.MISSED || kind == PracticeLoopRouter.Kind.SHORT)
                        && actorText != null && actorText.contains("모르");
        boolean wantsMethod = !chip && (kind == PracticeLoopRouter.Kind.METHOD
                || classified != null && "method".equals(classified.respond()));
        if (dontKnow && loop.path("dont_knows").asInt(0) >= 1 || wantsMethod) {
            return Turn.directing(purpose, label, chip, answerLike ? current : null, dontKnow);
        }
        if (chip) {
            // "잘 모르겠어요" 버튼 처음: 코치가 자기 생각을 내놓는다.
            if (DONT_KNOW.equals(pressed)) {
                return new Turn(purpose, current, "propose", false, false, label, true, null).notKnowing();
            }
            if (ANOTHER.equals(pressed) && "card".equals(current) && loop.path("another").asInt(0) < 1) {
                return new Turn(purpose, current, "another", false, false, label, true, null);
            }
            return advance(purpose, loop, index, label, true, answerLike ? current : null, actorText);
        }
        Turn turn = switch (kind) {
            case QUESTION, EVALUATION -> stays >= MAX_STAYS ? advance(purpose, loop, index, label, false, null, actorText).asking()
                    : new Turn(purpose, current, "answer", false, false, label, false, null);
            case CORRECTION, PUSHBACK -> stays >= MAX_STAYS ? advance(purpose, loop, index, label, false, null, actorText)
                    : new Turn(purpose, current, "accept", false, false, label, false, null);
            case MISSED, SHORT -> stays >= MAX_STAYS ? advance(purpose, loop, index, label, false, null, actorText)
                    : stay(purpose, current, stays, label, false);
            default -> advance(purpose, loop, index, label, false, current, actorText);
        };
        // 답하면서 함께 물은 것이 있으면(왜요? 그래서 어떻게 해요?) 단계 일을 하기 전에 먼저 답하게 한다.
        boolean answering = "answer".equals(turn.doing()) || turn.end();
        // 질문 상한: 막힌 곳·인물은 코치가 두 번 물었으면 더 묻지 않고 정해 준다. 배우가 물은 것은 정리 첫 문장에서 답한다.
        // 영상 없이 말로는 배우가 물은 말이면 상한이어도 정리로 덮지 않고 답한다 — 영상이 없어 배우 물음이 코칭의 재료다. 응답 상한(REPLY_CAP)은 그대로 정리한다.
        boolean talkAnswer = purpose.talk() && "answer".equals(turn.doing());
        if (purpose != Purpose.EVALUATE && !turn.wrap() && !turn.end() && !talkAnswer && loop.path("questions").asInt(0) >= MAX_QUESTIONS) {
            turn = Turn.directing(purpose, label, false, turn.answeredStep(), dontKnow);
            if (kind == PracticeLoopRouter.Kind.QUESTION || kind == PracticeLoopRouter.Kind.EVALUATION) turn = turn.asking();
        }
        if (dontKnow) turn = turn.notKnowing();
        // 분류가 놓쳐도 배우 말에 물음("왜요?", "무슨 뜻이에요?")이 있으면 먼저 답하게 한다.
        boolean asks = classified != null && classified.alsoAsked() || asksSomething(actorText);
        return asks && !answering ? turn.asking() : turn;
    }

    /** 대화를 다시 연 시점의 코치 응답 수. 다시 연 적이 없으면 -1. */
    static int resumedAt(JsonNode loop) {
        return loop == null ? -1 : loop.path(PracticeLoopRouter.RESUMED_AT).asInt(-1);
    }

    /** 영상 없이 말로: 정리한 뒤 배우가 물어 답만 하는 응답. */
    static boolean answersAfterWrap(Turn turn) {
        return turn != null && turn.purpose().talk() && "wrap".equals(turn.step()) && "answer".equals(turn.doing());
    }

    private static final Pattern SENTENCE = Pattern.compile("[^.!?\\n]+[.!?~]*");

    /**
     * 결과를 장담하는 문장("꽁트의 재미가 훨씬 더 잘 느껴질 거예요.")을 뗀다. 영상 없이 말로 하는 회차 규칙(talk/mode)이 금지하는데
     * 모델이 정리 뒤 답 끝에 붙였다(10/27 dev 재생). 물음은 두고, 문장이 하나뿐이거나 모두 장담이면 그대로 둔다.
     */
    static String withoutPromises(String text) {
        if (text == null || text.isBlank()) return text;
        Matcher m = SENTENCE.matcher(text);
        var kept = new StringBuilder();
        int last = 0;
        int total = 0;
        int dropped = 0;
        while (m.find()) {
            String sentence = m.group();
            if (sentence.isBlank()) continue;
            total++;
            String gap = text.substring(last, m.start());
            last = m.end();
            if (promises(sentence)) {
                dropped++;
                continue;
            }
            kept.append(gap).append(sentence);
        }
        kept.append(text.substring(last));
        if (dropped == 0 || dropped == total) return text;
        return kept.toString().replaceAll("\\n{3,}", "\n\n").strip();
    }

    /** "~ㄹ 거예요."로 끝나는 평서문(앞 글자에 ㄹ 받침). 물음과 따옴표로 끝나는 대사는 아니다. */
    static boolean promises(String sentence) {
        String s = sentence.strip();
        if (s.endsWith("?")) return false;
        s = s.replaceAll("[.!~]+$", "");
        if (!s.endsWith("거예요")) return false;
        String before = s.substring(0, s.length() - 3).stripTrailing();
        if (before.isEmpty()) return false;
        char c = before.charAt(before.length() - 1);
        return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 == 8;
    }

    /** 정리 뒤 배우 말이 코치에게 묻는 말인가(물음·평가 요청·방법 요청, 또는 물음표·"어떻게 해요"). */
    static boolean asksAfterWrap(PracticeLoopRouter.Kind kind, String actorText) {
        return kind == PracticeLoopRouter.Kind.QUESTION || kind == PracticeLoopRouter.Kind.EVALUATION
                || kind == PracticeLoopRouter.Kind.METHOD || asksSomething(actorText);
    }

    /** 배우 말에 코치에게 묻는 말이 있는가. */
    static boolean asksSomething(String actorText) {
        if (actorText == null) return false;
        String text = actorText.replaceAll("\\s+", "");
        return text.contains("?") || text.contains("왜요") || text.contains("왜그래") || text.contains("무슨뜻") || text.contains("뭔뜻")
                || text.contains("어떻게해요") || text.contains("어떻게하는") || text.contains("어케");
    }

    /** 처음 막히면 쉽게 다시 묻고, 또 막히면 코치가 답 하나를 내놓는다. */
    private static Turn stay(Purpose purpose, String current, int stays, String label, boolean chip) {
        return new Turn(purpose, current, stays >= 1 ? "propose" : "easy", false, false, label, chip, null);
    }

    private static Turn advance(Purpose purpose, ObjectNode loop, int index, String label, boolean chip,
            String answeredStep, String actorText) {
        String current = purpose.steps.get(index);
        if (purpose.character() && ("view".equals(current) || "cell".equals(current))) {
            int cells = loop.path("cells").asInt(0);
            if (cells < MAX_CELLS && filledCells(loop) < CELLS.size()) {
                return new Turn(purpose, "cell", "cell", true, false, label, chip, answeredStep);
            }
            return new Turn(purpose, "wrap", "wrap", true, false, label, chip, answeredStep);
        }
        // 막힌 곳을 말하면서 대사까지 짚었으면 어느 대사인지 다시 묻지 않는다.
        if (purpose == Purpose.STUCK && "reason".equals(current) && mentionsLine(loop.path("lines"), actorText)) {
            return new Turn(purpose, "seen", "seen", true, false, label, chip, answeredStep);
        }
        // 영상 없이: 막힌 곳을 말하면서 대사를 따왔으면 어느 대사인지 다시 묻지 않고 방법으로 간다.
        if (purpose == Purpose.TALK_STUCK && "reason".equals(current) && QUOTED_BY_ACTOR.matcher(actorText == null ? "" : actorText).find()) {
            return new Turn(purpose, "method", "method", true, false, label, chip, answeredStep);
        }
        String next = purpose.steps.get(Math.min(index + 1, purpose.steps.size() - 1));
        return new Turn(purpose, next, next, true, false, label, chip, answeredStep);
    }

    private static int index(Purpose purpose, JsonNode loop) {
        return Math.max(0, Math.min(purpose.steps.size() - 1, loop.path("step").asInt(0)));
    }

    private static String current(Purpose purpose, JsonNode loop) {
        return purpose.steps.get(index(purpose, loop));
    }

    /** 배우가 따옴표로 대사를 따왔거나(받아 적은 대사에 없어도) 받아 적은 대사를 그대로 말했는가. */
    static boolean mentionsLine(JsonNode lines, String actorText) {
        if (actorText == null) return false;
        if (QUOTED_BY_ACTOR.matcher(actorText).find()) return true;
        if (lines == null || !lines.isArray()) return false;
        String said = compact(actorText);
        for (JsonNode line : lines) {
            String text = compact(line.path("text").asText(""));
            // 받아 적은 대사와 배우가 쓴 말이 조금 달라도("좀 가르쳐 줘" / "가르쳐 줘 비결이 뭐야") 네 글자 이상 겹치면 짚은 것이다.
            if (text.length() >= 2 && (said.contains(text) || commonRun(text, said) >= Math.min(4, text.length()))) return true;
        }
        return false;
    }

    /** 두 글에 함께 있는 가장 긴 연속 글자 수. */
    static int commonRun(String a, String b) {
        int best = 0;
        int[] prev = new int[b.length() + 1];
        for (int i = 1; i <= a.length(); i++) {
            int[] cur = new int[b.length() + 1];
            for (int j = 1; j <= b.length(); j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) {
                    cur[j] = prev[j - 1] + 1;
                    if (cur[j] > best) best = cur[j];
                }
            }
            prev = cur;
        }
        return best;
    }

    private static final Pattern QUOTED_BY_ACTOR = Pattern.compile("[\"“'‘「『][^\"”'’」』]{2,}[\"”'’」』]");

    private static String compact(String text) {
        return text.replaceAll("[\\s\"“”「」『』'‘’.,!?~…·]", "");
    }

    private static int filledCells(JsonNode loop) {
        return loop.path("character_card").path("cells").size();
    }

    // ---- 모델 출력 ----

    private static final Pattern CHOICES = Pattern.compile("(?s)<보기>\\s*(.*?)\\s*(?:</보기>|$)");
    private static final Pattern CARD = Pattern.compile("(?s)<카드>\\s*(.*?)\\s*(?:</카드>|$)");
    private static final Pattern CHARACTER_CARD = Pattern.compile("(?s)<인물 카드>\\s*(.*?)\\s*(?:</인물 카드>|$)");
    private static final Pattern SCENE = Pattern.compile("(?s)<장면>\\s*(.*?)\\s*(?:</장면>|$)");
    private static final Pattern BULLET = Pattern.compile("^\\s*(?:[-•*·]|\\d+[.)])\\s*");
    private static final Pattern TIMED_LINE = Pattern.compile("(\\d{1,2}):(\\d{2})\\s*[\"“「『]([^\"”」』]{1,40})[\"”」』]");
    private static final int CHOICE_MAX = 3;
    private static final int CHOICE_LENGTH = 30;
    private static final int LINES_MAX = 8;

    /** 걷어 낸 숨은 칸. 없는 칸은 {@code null}(버튼은 빈 목록). */
    record Output(List<PurposeView.Choice> choices, ObjectNode card, ObjectNode characterCard, ObjectNode scene) { }

    static Output extract(String raw) {
        String text = raw == null ? "" : raw;
        var choices = new ArrayList<PurposeView.Choice>();
        Matcher m = CHOICES.matcher(text);
        if (m.find()) {
            for (String line : m.group(1).split("\\R")) {
                String label = BULLET.matcher(line).replaceFirst("").strip();
                Integer at = null;
                Lead lead = leadTime(label);
                if (lead != null) {
                    at = lead.seconds();
                    label = label.substring(lead.end()).strip();
                }
                if (label.isEmpty() || "직접 쓰기".equals(label) || DONT_KNOW.equals(label)) continue;
                if (label.length() > CHOICE_LENGTH) label = label.substring(0, CHOICE_LENGTH).strip();
                final String kept = label;
                if (choices.stream().noneMatch(c -> c.label().equals(kept))) choices.add(new PurposeView.Choice(kept, at));
                if (choices.size() == CHOICE_MAX) break;
            }
        }
        ObjectNode card = null;
        m = CARD.matcher(text);
        if (m.find()) card = card(m.group(1));
        ObjectNode character = null;
        m = CHARACTER_CARD.matcher(text);
        if (m.find()) character = characterCard(m.group(1));
        ObjectNode scene = null;
        m = SCENE.matcher(text);
        if (m.find()) scene = sceneLine(m.group(1));
        return new Output(List.copyOf(choices), card, character, scene);
    }

    /** 평가 결과 카드: 「잘 된 곳: 0:12 …」「아쉬운 곳: 0:31 …」「다음 테이크: …」. 없는 칸은 빠진다. */
    static ObjectNode card(String body) {
        ObjectNode card = JsonNodeFactory.instance.objectNode();
        for (String[] pair : new String[][] {{"잘 된 곳", "good"}, {"아쉬운 곳", "issue"}, {"다음 테이크", "next"}}) {
            String value = DirectVideoPracticeLoop.statusField(body, pair[0]);
            if (value.isBlank() || value.startsWith("없음")) continue;
            ObjectNode item = card.putObject(pair[1]);
            Lead lead = leadTime(value);
            if (lead != null) {
                item.put("at", lead.seconds());
                value = value.substring(lead.end()).strip();
            } else {
                item.putNull("at");
            }
            item.put("text", value);
        }
        return card.isEmpty() ? null : card;
    }

    /**
     * 새 결과 카드를 앞 카드에 합친다. 모델이 같은 줄을 시간 없이 다시 쓰면 앞 시간을 살린다. 정리에서는 잘 된 곳·아쉬운 곳을
     * 앞 카드 그대로 두고(정리가 고친 곳을 바꾸지 않는다) 다음 테이크만 받는다.
     */
    static ObjectNode mergeCard(JsonNode previous, ObjectNode fresh, boolean wrap) {
        if (!(previous instanceof ObjectNode old)) return fresh;
        ObjectNode merged = old.deepCopy();
        for (String key : List.of("good", "issue", "next")) {
            if (!fresh.has(key)) continue;
            ObjectNode item = ((ObjectNode) fresh.get(key)).deepCopy();
            JsonNode before = old.path(key);
            // 정리는 대화에서 배우가 바로잡은 것을 반영해 줄을 고쳐 쓸 수 있다. 같은 곳이므로 시간이 빠졌으면 앞 시간을 살린다.
            if (item.path("at").isNull() && before.path("at").isNumber()
                    && (wrap || before.path("text").asText("").equals(item.path("text").asText("")))) {
                item.put("at", before.path("at").asInt());
            }
            merged.set(key, item);
        }
        return merged;
    }

    /** 인물 카드 여섯 칸(우타 하겐의 질문 축). 순서가 화면 순서다. */
    static final List<String[]> CELLS = List.of(new String[] {"누구", "who"}, new String[] {"직전 상황", "before"},
            new String[] {"관계", "relation"}, new String[] {"바라는 것", "want"}, new String[] {"막는 것", "obstacle"},
            new String[] {"하는 일", "action"});
    private static final List<String> SOURCES = List.of("내 말", "대본", "같이 찾음", "영상");

    /** 인물 카드: 「누구: 상처 줄까 봐 망설이는 사람 (내 말)」 같은 줄. 빈 칸·없음·모름은 빠진다. */
    static ObjectNode characterCard(String body) {
        ObjectNode card = JsonNodeFactory.instance.objectNode();
        ArrayNode cells = card.putArray("cells");
        for (String[] cell : CELLS) {
            String value = DirectVideoPracticeLoop.statusField(body, cell[0]);
            if (value.isBlank() || value.startsWith("없음") || value.startsWith("모름") || value.startsWith("빈 칸")) continue;
            String[] split = splitSource(value);
            value = split[0];
            String source = split[1];
            if (value.isBlank()) continue;
            ObjectNode item = cells.addObject();
            item.put("key", cell[1]);
            item.put("label", cell[0]);
            item.put("value", value);
            item.put("source", source);
        }
        return cells.isEmpty() ? null : card;
    }

    /** 첫 응답 설계의 「장면: 상황 | 인물 | 상대」. 줄이 없으면 {@code null}. */
    static ObjectNode scene(String design) {
        String line = DirectVideoPracticeLoop.statusField(design, "장면");
        return line.isBlank() || line.startsWith("없음") ? null : sceneLine(line);
    }

    private static ObjectNode sceneLine(String line) {
        String[] parts = line.strip().split("\\|", -1);
        if (parts.length < 2) return null;
        ObjectNode scene = JsonNodeFactory.instance.objectNode();
        scene.put("situation", part(parts, 0));
        scene.put("character", part(parts, 1));
        scene.put("partner", part(parts, 2));
        return scene;
    }

    private static String part(String[] parts, int index) {
        if (index >= parts.length) return "";
        String value = unbracket(parts[index]);
        return value.startsWith("모름") || value.startsWith("없음") || value.startsWith("알 수 없") ? "" : value;
    }

    /** 첫 응답 설계의 「대사 시간: 0:03 "가르쳐 줘" / 0:12 "취소해"」. 대사가 확인되지 않았으면 빈 목록. */
    static ArrayNode lines(String design) {
        ArrayNode lines = JsonNodeFactory.instance.arrayNode();
        if (DirectVideoPracticeLoop.statusField(design, "대사 확인").startsWith("확인 안 됨")) return lines;
        String field = DirectVideoPracticeLoop.statusField(design, "대사 시간");
        Matcher m = TIMED_LINE.matcher(field);
        while (m.find() && lines.size() < LINES_MAX) {
            String text = m.group(3).strip();
            if (text.isEmpty()) continue;
            lines.addObject().put("at", Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2))).put("text", text);
        }
        return lines;
    }

    private static String withoutTime(String label) {
        if (label == null) return "";
        Lead lead = leadTime(label);
        return (lead == null ? label : label.substring(lead.end())).strip();
    }

    /** 줄 머리 영상 시간의 초와 그 뒤 위치. */
    record Lead(int seconds, int end) { }

    /**
     * 줄 머리의 영상 시간("0:12", "[0:12]", "(1:05)", "0:11-0:35")을 읽는다. 구간이면 시작 시간만 쓴다. 없으면 {@code null}.
     * 정규식 대신 앞에서부터 한 번만 읽는다(되짚기 없음).
     */
    static Lead leadTime(String text) {
        if (text == null) return null;
        int i = spaces(text, 0);
        if (i < text.length() && (text.charAt(i) == '[' || text.charAt(i) == '(')) i = spaces(text, i + 1);
        int[] first = clock(text, i);
        if (first == null) return null;
        i = first[1];
        int dash = spaces(text, i);
        if (dash < text.length() && "-~–".indexOf(text.charAt(dash)) >= 0) {
            int[] second = clock(text, spaces(text, dash + 1));
            if (second != null) i = second[1];
        }
        i = spaces(text, i);
        if (i < text.length() && (text.charAt(i) == ']' || text.charAt(i) == ')')) i++;
        return new Lead(first[0], spaces(text, i));
    }

    /** {@code at} 부터 "m:ss"·"mm:ss" 를 읽는다: {초, 끝 위치}. 없으면 {@code null}. */
    private static int[] clock(String text, int at) {
        int i = at;
        int minutes = 0;
        while (i < text.length() && i - at < 2 && digit(text.charAt(i))) minutes = minutes * 10 + (text.charAt(i++) - '0');
        if (i == at || i + 2 >= text.length() || text.charAt(i) != ':') return null;
        if (!digit(text.charAt(i + 1)) || !digit(text.charAt(i + 2))) return null;
        int end = i + 3;
        if (end < text.length() && digit(text.charAt(end))) return null;
        return new int[] {minutes * 60 + (text.charAt(i + 1) - '0') * 10 + (text.charAt(i + 2) - '0'), end};
    }

    private static boolean digit(char c) {
        return c >= '0' && c <= '9';
    }

    private static int spaces(String text, int at) {
        int i = at;
        while (i < text.length() && Character.isWhitespace(text.charAt(i))) i++;
        return i;
    }

    /** "한 구절 (내 말)" → {한 구절, 내 말}. 출처가 없거나 모르는 말이면 {그대로, 같이 찾음}. */
    static String[] splitSource(String value) {
        String text = value.strip();
        if (text.endsWith(")") || text.endsWith("）")) {
            int open = Math.max(text.lastIndexOf('('), text.lastIndexOf('（'));
            if (open >= 0) {
                String inner = text.substring(open + 1, text.length() - 1).strip();
                if (SOURCES.contains(inner)) return new String[] {text.substring(0, open).strip(), inner};
            }
        }
        return new String[] {text, "같이 찾음"};
    }

    /** 양식의 대괄호를 남겼으면 벗긴다. */
    private static String unbracket(String value) {
        String text = value.strip();
        if (text.startsWith("[")) text = text.substring(1);
        if (text.endsWith("]")) text = text.substring(0, text.length() - 1);
        return text.strip();
    }

    // ---- 상태 ----

    static ObjectNode loop(JsonNode state) {
        if (state instanceof ObjectNode object && object.get(STATE_KEY) instanceof ObjectNode loop) return loop;
        return JsonNodeFactory.instance.objectNode();
    }

    private static ObjectNode writable(ObjectNode state) {
        if (state.get(STATE_KEY) instanceof ObjectNode loop) return loop;
        return state.putObject(STATE_KEY);
    }

    /** 첫 응답 뒤: 목적·첫 단계·장면·대사·버튼·카드를 둔다. */
    static void rememberOpening(ObjectNode state, Purpose purpose, Output output, String design) {
        ObjectNode loop = writable(state);
        loop.put("purpose", purpose.id);
        loop.put("step", 0);
        loop.put("stays", 0);
        loop.put("cells", 0);
        loop.put("questions", purpose == Purpose.EVALUATE ? 0 : 1);
        ObjectNode scene = scene(design);
        if (scene != null) loop.set("scene", scene);
        loop.set("lines", lines(design));
        if (output.card() != null) loop.set("card", output.card());
        if (output.characterCard() != null) loop.set("character_card", output.characterCard());
        putChoices(loop, purpose == Purpose.EVALUATE ? cardChoices(loop) : withDontKnow(output.choices()));
    }

    /** 둘째 응답부터: 단계를 옮기고 이번 답의 버튼·카드·장면을 둔다. 정리의 행동 한 줄은 결과 카드의 다음 테이크가 된다. */
    static void remember(ObjectNode state, Turn turn, Output output, String take) {
        remember(state, turn, output);
        if (!turn.wrap() || take == null || take.isBlank() || turn.purpose().character()) return;
        ObjectNode loop = writable(state);
        ObjectNode card = loop.get("card") instanceof ObjectNode existing ? existing : loop.putObject("card");
        card.putObject("next").putNull("at").put("text", take.strip());
    }

    static void remember(ObjectNode state, Turn turn, Output output) {
        ObjectNode loop = writable(state);
        int index = turn.purpose().steps.indexOf(turn.step());
        if (index >= 0) loop.put("step", index);
        loop.put("stays", turn.advanced() ? 0 : loop.path("stays").asInt(0) + 1);
        if ("cell".equals(turn.doing())) loop.put("cells", loop.path("cells").asInt(0) + 1);
        if (turn.dontKnow()) loop.put("dont_knows", loop.path("dont_knows").asInt(0) + 1);
        if (!turn.wrap() && !turn.end()) loop.put("questions", loop.path("questions").asInt(0) + 1);
        if ("another".equals(turn.doing())) loop.put("another", loop.path("another").asInt(0) + 1);
        if (output.card() != null) loop.set("card", mergeCard(loop.get("card"), output.card(), turn.wrap()));
        if (output.characterCard() != null) loop.set("character_card", output.characterCard());
        if (output.scene() != null) loop.set("scene", output.scene());
        // 영상 없이 말로 정리 뒤 답(answerAfterWrap)은 묻지 않는 답이라 「잘 모르겠어요」도 붙이지 않는다(10/27 dev 재생).
        if (turn.wrap() || turn.end() || answersAfterWrap(turn)) putChoices(loop, List.of());
        else if ("card".equals(turn.step())) putChoices(loop, cardChoices(loop));
        else if ("method".equals(turn.step())) putChoices(loop, withDontKnow(untimed(output.choices())));
        else putChoices(loop, withDontKnow(output.choices()));
    }

    /** 배우가 단계 질문에 답한 말을 그 단계 이름으로 남긴다(다음 응답의 재료). */
    static void rememberAnswer(ObjectNode state, String step, String actorText) {
        if (step == null || actorText == null || actorText.isBlank()) return;
        ObjectNode loop = writable(state);
        ObjectNode answers = loop.get("answers") instanceof ObjectNode existing ? existing : loop.putObject("answers");
        answers.put(step, actorText.strip().replaceAll("\\s+", " "));
    }

    private static List<PurposeView.Choice> cardChoices(JsonNode loop) {
        var choices = new ArrayList<PurposeView.Choice>();
        choices.add(new PurposeView.Choice(FIX_TOGETHER, null));
        if (loop.path("another").asInt(0) < 1) choices.add(new PurposeView.Choice(ANOTHER, null));
        return choices;
    }

    /** 방법 버튼은 대사가 아니라 하는 일이라 영상 시간이 없다. */
    private static List<PurposeView.Choice> untimed(List<PurposeView.Choice> choices) {
        return choices.stream().map(choice -> new PurposeView.Choice(choice.label(), null)).toList();
    }

    private static List<PurposeView.Choice> withDontKnow(List<PurposeView.Choice> choices) {
        var all = new ArrayList<>(choices);
        all.add(new PurposeView.Choice(DONT_KNOW, null));
        return all;
    }

    private static void putChoices(ObjectNode loop, List<PurposeView.Choice> choices) {
        ArrayNode array = loop.putArray("choices");
        for (PurposeView.Choice choice : choices) {
            ObjectNode item = array.addObject();
            item.put("label", choice.label());
            if (choice.at() == null) item.putNull("at");
            else item.put("at", choice.at());
        }
    }

    /** 상태 칸. 노트·응답 상한이 읽는 「배우의 말」「할 일」「다음 테이크」 칸 이름은 연습 루프와 같다. */
    static String status(Turn turn, String nextTake) {
        var lines = new ArrayList<String>();
        lines.add("목적: " + turn.purpose().id);
        lines.add("배우의 말: " + turn.kindLabel());
        lines.add("단계: " + turn.step());
        lines.add("할 일: " + (turn.wrap() ? PracticeLoopRouter.WRAP_UP : turn.end() ? "끝" : turn.doing()));
        lines.add("다음 테이크: " + (nextTake == null || nextTake.isBlank() ? "없음" : nextTake));
        return String.join("\n", lines);
    }

    // ---- 프롬프트 ----

    static String firstPrompt(Purpose purpose) {
        return DirectVideoPrompts.purposeResource("first-common") + talkMode(purpose)
                + "\n\n" + DirectVideoPrompts.purposeResource(purpose.dir + "/first");
    }

    static String turnPrompt() {
        return DirectVideoPrompts.purposeResource("turn");
    }

    /** 목적에 맞는 둘째 응답부터의 공통 지시. 영상 없이 말로 하는 갈래면 영상 없는 모드 지시를 덧붙인다. */
    static String turnPrompt(Purpose purpose) {
        return turnPrompt() + talkMode(purpose);
    }

    private static final Pattern QUOTE = Pattern.compile("[\"“”「『]([^\"“”」』]{1,60})[\"“”」』]");
    private static final Pattern SENTENCE_END = Pattern.compile("(?<=[.!?。])\\s+|\\n+");

    /**
     * 배우가 이 대화에서 적지 않은 말을 큰따옴표로 따온 문장을 뗀다(SOMA-745, 영상 없이 말로). 영상도 받아 적은 대사도 없으니
     * 그 따옴표는 모델이 작품 기억이나 짐작으로 지어낸 대사다. 띄어쓰기는 보지 않는다. 전부 근거 밖이면 판단할 수 없다고 알린다.
     */
    static String withoutUngroundedQuotes(String shown, String actorWords) {
        if (shown == null || shown.isBlank()) return shown;
        String said = actorWords == null ? "" : actorWords.replaceAll("\\s+", "");
        var kept = new ArrayList<String>();
        boolean dropped = false;
        for (String sentence : SENTENCE_END.split(shown.strip())) {
            if (sentence.isBlank()) continue;
            Matcher quote = QUOTE.matcher(sentence);
            boolean grounded = true;
            while (quote.find()) {
                String inner = quote.group(1).replaceAll("\\s+", "");
                if (!inner.isEmpty() && !said.contains(inner)) grounded = false;
            }
            if (grounded) kept.add(sentence.strip());
            else dropped = true;
        }
        if (!dropped) return shown;
        return kept.isEmpty() ? "이 부분은 말해 준 내용만으로는 판단하기 어려워요." : String.join("\n", kept);
    }

    /** 말로 하는 회차의 모델 입력 맨 앞 한 줄(SOMA-745). 저장하지 않는다. */
    static String talkOpening(Purpose purpose) {
        return "(영상 없이 말로 코칭을 시작했어요. 고른 목적: " + label(purpose) + ")";
    }

    /** 영상 없는 모드 지시(SOMA-745). 영상이 있는 갈래면 빈 문자열이다 — 영상 있는 코치의 지시는 한 글자도 바뀌지 않는다. */
    private static String talkMode(Purpose purpose) {
        return purpose != null && purpose.talk() ? "\n\n" + DirectVideoPrompts.purposeResource("talk/mode") : "";
    }

    /** 이번 응답의 지시: 할 일, 목적의 길, 배우가 단계마다 한 말, 카드, 직전 버튼, 방금 한 말. */
    static String instruction(Turn turn, JsonNode state, String actorText) {
        ObjectNode loop = loop(state);
        var lines = new ArrayList<String>();
        lines.add("[이번 응답]");
        lines.add("목적: " + label(turn.purpose()));
        lines.add("이번 응답이 하는 단계: " + STEP_NAMES.getOrDefault(turn.step(), turn.step()));
        lines.add(DirectVideoPrompts.purposeResource(taskFile(turn)));
        lines.add("");
        lines.add(DirectVideoPrompts.purposeResource(turn.purpose().dir + "/path"));
        lines.add("");
        lines.add("재료");
        JsonNode answers = loop.path("answers");
        answers.fieldNames().forEachRemaining(step -> lines.add("- 배우가 「" + STEP_NAMES.getOrDefault(step, step)
                + "」 질문에 한 답: " + answers.path(step).asText()));
        if (loop.path("scene").isObject()) {
            JsonNode scene = loop.path("scene");
            lines.add("- 장면(AI가 본 것, 배우가 고쳤으면 고친 것): " + scene.path("situation").asText("") + " | "
                    + scene.path("character").asText("") + " | " + scene.path("partner").asText(""));
        }
        if (loop.path("card").isObject()) lines.add("- 지금 결과 카드: " + loop.path("card"));
        if (loop.path("character_card").isObject()) lines.add("- 지금 인물 카드: " + loop.path("character_card"));
        if (loop.path("choices").size() > 0) lines.add("- 직전에 내준 버튼: " + loop.path("choices"));
        if (turn.direct() && turn.purpose().talk()) {
            lines.add("- 배우가 방향을 달라고 했다(또는 거듭 모르겠다고 했다). 더 묻지 않는다. 배우가 아직 고르지 않은 것은 코치가 배우가 한 말과 "
                    + "배우가 적은 대사로 직접 정한다. 영상은 없다 — 본 것처럼 말하지 않는다. 배우가 물은 것이 있으면 첫 문장에서 그 물음에 답한다.");
        } else if (turn.direct()) {
            lines.add("- 배우가 방향을 달라고 했다(또는 거듭 모르겠다고 했다). 더 묻지 않는다. 배우가 아직 고르지 않은 것은 코치가 영상에서 본 것으로 "
                    + "직접 정한다: 어느 대사에서, 상대에게 무엇을 하는지. 배우가 물은 것이 있으면 첫 문장에서 그 물음에 답한다.");
        }
        if (turn.purpose() == Purpose.TALK_CHARACTER && turn.wrap()) {
            lines.add("- 인물 카드는 배우가 한 말(내 말)과 함께 찾은 것(같이 찾음)으로만 채운다. 영상이 없으므로 (영상) 칸은 쓰지 않는다. "
                    + "정리 둘째 문장은 배우 해석과 다른 가능성 하나를 배우가 말한 대사·상황에 기대어 말한다.");
        } else if (turn.purpose() == Purpose.CHARACTER && turn.wrap()) {
            lines.add("- 인물 카드에는 첫 응답 <설계>의 대본 단서·테이크 속 인물·다른 가능성에서 배우가 말하지 않은 칸을 둘 이상 (영상)으로 채운다. "
                    + "정리 둘째 문장은 배우 해석과 다른 가능성 하나를 그 단서 대사와 함께 말하고, 그 둘로 이 인물이 어떻게 더 입체적이 되는지 말한다.");
        }
        if (answersAfterWrap(turn)) {
            lines.add("- 정리는 이미 했다. 이번에는 배우가 정리 뒤에 물은 것에만 답한다. 정리를 다시 쓰거나 새 질문을 하지 않고, <보기>도 쓰지 않는다. "
                    + "할 수 없는 것을 물었으면 할 수 없다는 말로 끝내지 말고 배우가 지금 해 볼 수 있는 방법 하나를 함께 말한다. "
                    + "해 보면 어떻게 될지 장담하는 말(\"~느껴질 거예요\", \"~될 거예요\")로 끝내지 않는다.");
        }
        if (turn.asked()) {
            lines.add("- 배우가 이번 말에서 함께 물은 것이 있다. 이번 할 일을 하기 전에 그 물음에 먼저 한두 문장으로 솔직하게 답한다. "
                    + "물음을 넘기거나 질문으로 되돌리지 않는다.");
        }
        if (actorText != null && !actorText.isBlank()) {
            lines.add("- 배우가 방금 한 말: " + actorText.strip().replaceAll("\\s+", " ") + (turn.chip() ? " (버튼을 눌렀다)" : ""));
        }
        return String.join("\n", lines);
    }

    private static String taskFile(Turn turn) {
        return switch (turn.doing()) {
            case "answer", "accept", "easy", "propose", "method" -> "common/" + turn.doing();
            default -> turn.purpose().dir + "/" + turn.doing();
        };
    }

    static String label(Purpose purpose) {
        return switch (purpose) {
            case EVALUATE -> "평가 받기";
            case STUCK -> "막힌 곳 풀기";
            case CHARACTER -> "인물 이해하기";
            case TALK_STUCK -> "막힌 곳 풀기 (영상 없이 말로)";
            case TALK_CHARACTER -> "인물 이해하기 (영상 없이 말로)";
            case CONCERN -> "고민 상담 (영상 없이 말로)";
        };
    }

    /** 이번 응답의 글자 상한을 설명 길이로 늘리는가. 평가 첫 답·정리·물음에 답하기·코치 제안은 한 문장으로 줄이면 뜻이 빠진다. */
    static boolean explains(Purpose purpose, Turn turn) {
        if (turn == null) return purpose == Purpose.EVALUATE;
        if (turn.asked()) return true;
        return switch (turn.doing()) {
            case "wrap", "answer", "another", "propose", "seen" -> true;
            default -> false;
        };
    }

    /** 코치가 묻지 않는 목적. 평가 받기는 답을 먼저 준다(10/20 사용자 결정): 결과 카드 → 방법 버튼 → 정리. */
    static boolean asksNothing(Purpose purpose) {
        return purpose == Purpose.EVALUATE;
    }

    /** 첫 응답을 질문 한 줄로 줄이지 않는 목적. 평가 첫 답은 결과를 짧게 말한다. */
    static boolean keepsWholeOpening(Purpose purpose) {
        return purpose == Purpose.EVALUATE;
    }
}
