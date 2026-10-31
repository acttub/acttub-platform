package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;

/** Only tasks selected by application routing are sent to the coach. */
final class DirectVideoPrompts {
    private DirectVideoPrompts() {}
    static String common() { return resource("common"); }
    static String classifier() { return resource("classifier"); }
    /**
     * 얼굴 가리기 회차(practice.start)에 코치 지시문 앞에 붙이는 한 줄 사실. 프롬프트 파일은 바꾸지 않는다 — 소리 없는 영상의
     * 서버 사실({@link #withAudioFacts})과 같은 자리다.
     */
    static final String FACE_MOSAIC_FACT =
            "[서버 확인 영상 정보] 배우가 얼굴 가리기를 켜서 이 영상의 얼굴은 모자이크로 가려져 있다. 표정·눈빛·얼굴 근육은 판단하지 말고 말하지 않는다.";

    static String withFaceMosaicFact(String instruction, boolean faceMosaic) {
        return faceMosaic ? FACE_MOSAIC_FACT + "\n\n" + instruction : instruction;
    }

    static String withAudioFacts(String instruction, DirectVideoModel.Video video) {
        return video != null && Boolean.FALSE.equals(video.hasAudioTrack())
                ? resource("no-audio") + "\n\n" + instruction : instruction;
    }
    /** 분류·과제 조립 없이 대화 전체를 끄는 연습 루프 프롬프트. */
    static String practiceLoop() { return resource("practice-loop"); }

    /** {@code <설계>}에서 버릇 후보가 되는 네 칸. 모델은 맨 위 칸을 고르는 쪽으로 쏠리므로 연습마다 순서를 섞는다. */
    private static final List<String> HABIT_LINES = List.of("감정의 변화", "상대와 주고받기", "원하는 것과 행동", "몸·시선·표정");

    /**
     * 연습마다 {@code <설계>}의 버릇 후보 네 칸 순서를 섞은 연습 루프 프롬프트.
     *
     * <p>순서를 고정하면 모델이 맨 위 칸을 버릇으로 고르는 쪽으로 쏠린다(실험: 맨 위 칸 73%).
     * 같은 연습은 매 턴 기록을 다시 보내므로 연습 id로 순서를 고정한다.
     * 칸을 다 찾지 못하면(프롬프트가 바뀐 경우) 섞지 않고 그대로 돌려준다.
     */
    static String practiceLoop(UUID practiceId) {
        return practiceLoop(practiceId, null);
    }

    /** 영어판 연습 루프. 숨은 칸 이름·할 일 이름은 한국어판과 같다(서버가 읽는다). */
    static String practiceLoopEnglish() { return resource("practice-loop.en"); }

    /**
     * 답할 말에 맞는 연습 루프 프롬프트. 말은 분류(코드)가 정하고 프롬프트는 그 말로 쓰인 것을 고른다.
     * 한국어(null 포함)는 한국어판 그대로, 그 밖의 말은 영어판을 쓴다. 영어가 아닌 말(일본어 등)은
     * 영어판 끝에 그 말로 답하라는 {@link com.acttub.actingapi.platform.web.OutputLanguage} 지시를 붙인다.
     */
    static String practiceLoop(UUID practiceId, java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        String base = korean ? practiceLoop() : practiceLoopEnglish();
        if (!korean && !"en".equals(language.getLanguage())) {
            base = base + com.acttub.actingapi.platform.web.OutputLanguage.directiveFor(language);
        }
        if (practiceId == null) return base;
        var lines = new ArrayList<>(List.of(base.split("\n", -1)));
        var at = new ArrayList<Integer>();
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            if (HABIT_LINES.stream().anyMatch(name -> line.startsWith(name + ": ["))) at.add(i);
        }
        if (at.size() != HABIT_LINES.size()) return base;
        var picked = new ArrayList<String>();
        for (int i : at) picked.add(lines.get(i));
        Collections.shuffle(picked, new Random(practiceId.getMostSignificantBits() ^ practiceId.getLeastSignificantBits()));
        for (int k = 0; k < at.size(); k++) lines.set(at.get(k), picked.get(k));
        return String.join("\n", lines);
    }
    /**
     * 같은 장면을 이어서 찍은 회차의 첫 응답에 붙이는 지시. 지난 회차가 없으면 빈 문자열이다.
     *
     * <p>2026-10-14 23:17 운영(자문 최윤희 2차): 1차 끝에서 배우가 "초반부터 한번 웃어볼게"라고 정했고 코치도
     * 2차 영상의 미소를 <설계>에 적었다. 그런데 첫 응답은 1단계 첫 질문(1차와 글자까지 같은 질문)으로 다시 시작했고,
     * 배우는 "이거 아까 답변했던 건데"라고 했다. 지난 맥락은 앞쪽 "배우에 대해 지금까지 알고 있는 것"에도 있지만
     * 그 칸은 1,200자에서 잘리고 맨 뒤가 대화 발췌라, 지난 시도를 여기서 잘리지 않게 한 번 더 붙인다.
     */
    static String continuation(PriorContext prior, java.util.Locale language) {
        if (prior == null || prior.earlierConversation() == null || prior.earlierConversation().isBlank()) return "";
        boolean korean = language == null || "ko".equals(language.getLanguage());
        var text = new StringBuilder("\n\n").append(resource(korean ? "practice-loop-continue" : "practice-loop-continue.en"));
        if (!prior.sceneHistory().isEmpty()) {
            text.append(korean ? "\n\n### 지난 회차 요약\n- " : "\n\n### Previous round summary\n- ")
                    .append(prior.sceneHistory().getLast());
        }
        text.append(korean ? "\n\n### 지난 회차 마지막 대화\n" : "\n\n### Last exchange from the previous round\n")
                .append(prior.earlierConversation());
        return text.toString();
    }

    /** 긴 코치 말을 줄이기만 하는 지시. 한국어가 아니면 그 말로 줄이라는 말을 덧붙인다. */
    /** 비유·반복 질문만 고치는 다듬기 호출의 지시. */
    static String practiceLoopPolish(java.util.Locale language) {
        String base = resource("practice-loop-polish");
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean ? base : base + com.acttub.actingapi.platform.web.OutputLanguage.directiveFor(language);
    }

    static String practiceLoopShorten(java.util.Locale language) {
        String base = resource("practice-loop-shorten");
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean ? base : base + com.acttub.actingapi.platform.web.OutputLanguage.directiveFor(language);
    }

    /** 연습 루프 둘째 응답부터 배우의 말 종류를 묻는 분류 지시. 출력은 {@code {"signals":[...]}}. */
    static String practiceLoopClassifier() { return resource("practice-loop-classify"); }

    /** 연습 루프 둘째 응답부터의 공통 지시(첫 응답 지시·분기 표 없음). 할 일 칸은 {@link #practiceLoopTask}가 붙인다. */
    static String practiceLoopTurn() { return resource("practice-loop-turn"); }

    static String practiceLoopTurnEnglish() { return resource("practice-loop-turn.en"); }

    /** 근거·방법 비교(SOMA-955) 실험 쪽의 한국어 파일이 있는 할 일. 나머지 할 일과 영어는 지금 파일을 쓴다. */
    private static final java.util.Set<String> EVIDENCE_TASKS = java.util.Set.of("answer", "gap", "point-out", "wrap-up");

    /** 실험 쪽(SOMA-955) 한국어 대화는 {@code evidence/practice-loop-turn}을 쓴다. */
    static String practiceLoopTurn(java.util.Locale language, boolean evidence) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return evidence && korean ? resource("evidence/practice-loop-turn") : practiceLoopTurn(language);
    }

    /** 실험 쪽(SOMA-955) 한국어 대화의 답하기·어긋남 보기·짚어주기·정리하기는 {@code evidence/tasks/ko}를 쓴다. B 흐름의 tell 은 그대로다. */
    static String practiceLoopTask(String doing, java.util.Locale language, String flow, boolean evidence) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        String id = TASK_FILES.get(doing);
        boolean tell = CoachFlows.B.equals(flow) && PracticeLoopRouter.GAP.equals(doing);
        if (evidence && korean && !tell && id != null && EVIDENCE_TASKS.contains(id)) return resource("evidence/tasks/ko/" + id);
        return practiceLoopTask(doing, language, flow);
    }

    /** 답할 말에 맞는 둘째 응답부터의 공통 지시. 말을 고르는 규칙은 {@link #practiceLoop(UUID, java.util.Locale)}와 같다. */
    static String practiceLoopTurn(java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        String base = korean ? practiceLoopTurn() : practiceLoopTurnEnglish();
        if (!korean && !"en".equals(language.getLanguage())) {
            base = base + com.acttub.actingapi.platform.web.OutputLanguage.directiveFor(language);
        }
        return base;
    }

    /** 할 일 이름과 상황별 프롬프트 파일. 할 일마다 파일 하나다({@code coaching/direct-video/tasks/<말>/<id>.txt}). */
    private static final java.util.Map<String, String> TASK_FILES = java.util.Map.ofEntries(
            java.util.Map.entry(PracticeLoopRouter.WANT, "want"),
            java.util.Map.entry(PracticeLoopRouter.GAP, "gap"),
            java.util.Map.entry(PracticeLoopRouter.FIND, "find"),
            java.util.Map.entry(PracticeLoopRouter.EASY, "easy"),
            java.util.Map.entry(PracticeLoopRouter.REASK, "reask"),
            java.util.Map.entry(PracticeLoopRouter.PROPOSE, "propose"),
            java.util.Map.entry(PracticeLoopRouter.WRAP_UP, "wrap-up"),
            java.util.Map.entry("짚어주기", "point-out"),
            java.util.Map.entry("짚어주기(다른 쪽)", "point-out-other"),
            java.util.Map.entry("내려놓기", "let-go"),
            java.util.Map.entry("답하기", "answer"),
            java.util.Map.entry(PracticeLoopRouter.ASK_DONE, "ask-done"),
            java.util.Map.entry(PracticeLoopRouter.WRAP_DONE, "wrap-done"));

    /**
     * 할 일 하나의 상황별 프롬프트. 한국어는 {@code tasks/ko}, 그 밖의 말은 {@code tasks/en}에서 읽는다.
     * 파일이 없는 할 일이면 예외 — 서버가 정한 할 일과 파일이 어긋난 것이다.
     */
    /** 첫 응답 <설계>의 근본 문제 칸(번호나 이름)으로 고르는 "이 문제를 푸는 길" 파일. */
    private static final java.util.List<String[]> ROOTS = java.util.List.of(
            new String[] {"1", "집중", "focus"}, new String[] {"2", "목적", "purpose"}, new String[] {"3", "캐릭터", "character"},
            new String[] {"4", "상황", "situation"}, new String[] {"5", "관계", "relationship"});

    /** 근본 문제 칸을 읽어 그 길을 돌려준다. 칸이 비었거나 모르는 값이면 빈 문자열(예전 대화). */
    static String practiceLoopRoot(String rootField, java.util.Locale language) {
        if (rootField == null || rootField.isBlank()) return "";
        String value = rootField.strip();
        boolean korean = language == null || "ko".equals(language.getLanguage());
        for (String[] root : ROOTS) {
            if (value.startsWith(root[0]) || value.contains(root[1])) {
                return resource("roots/" + (korean ? "ko" : "en") + "/" + root[2]);
            }
        }
        return "";
    }

    /**
     * 흐름(SOMA-636 A/B)을 따르는 할 일 파일. B의 어긋남 보기는 질문으로 떠보지 않고 코치가 본 것을 말하는 {@code tell}이다.
     * 그 밖의 할 일은 A와 같은 파일이다.
     */
    static String practiceLoopTask(String doing, java.util.Locale language, String flow) {
        if (CoachFlows.B.equals(flow) && PracticeLoopRouter.GAP.equals(doing)) {
            boolean korean = language == null || "ko".equals(language.getLanguage());
            return resource("tasks/" + (korean ? "ko" : "en") + "/tell");
        }
        return practiceLoopTask(doing, language);
    }

    /** 첫 코칭 첫 말 B의 첫 응답 지시. 한국어 B 대화의 첫 응답 시스템 프롬프트 맨 끝에 붙는다. */
    static String openingBlock(String opening, java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return CoachOpenings.B.equals(opening) && korean ? "\n\n" + resource("openings/b") : "";
    }

    /** 이 장면에서 배우가 아니라고 한 진단이 이만큼 쌓이면 첫 응답에서 그 진단을 피하라고 맨 끝에 붙인다. */
    static final int REJECTED_MIN = 2;

    /**
     * 배우가 여러 번 아니라고 한 진단을 첫 응답 지시 맨 끝에 붙인다. 운영 10/26~29: 한 배우가 같은 장면 40회 동안
     * "설득보다 내 감정·답답함·설명"을 말만 바꿔 계속 들었다(공통 지시의 "다시 고르지 않는다" 한 줄은 지켜지지 않았다).
     */
    static String rejectedBlock(PriorContext prior, java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        if (!korean || prior == null) return "";
        String avoid = prior.memory().get("avoid");
        if (avoid == null || avoid.isBlank()) return "";
        java.util.LinkedHashSet<String> keys = new java.util.LinkedHashSet<>();
        int count = 0;
        for (String line : avoid.split("\\R")) {
            String t = line.strip();
            if (!t.startsWith("-")) continue;
            count++;
            int colon = t.indexOf(':');
            String key = (colon > 0 ? t.substring(1, colon) : t.substring(1)).strip();
            if (!key.isEmpty()) keys.add(key);
        }
        if (count < REJECTED_MIN) return "";
        StringBuilder list = new StringBuilder();
        keys.stream().limit(6).forEach(k -> list.append("- ").append(k).append('\n'));
        return "\n\n" + resource("openings/rejected").replace("{{count}}", String.valueOf(count)).replace("{{list}}", list.toString().strip());
    }

    /** 첫 코칭 첫 말 B 대화의 둘째 응답부터의 지시. 연습 루프 턴 조립 맨 끝에 붙는다. */
    static String openingTurnBlock(String opening, java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return CoachOpenings.B.equals(opening) && korean ? "\n\n" + resource("openings/b-turn") : "";
    }

    /** B 흐름에서 [이번 응답] 끝에 붙는 흐름 안내. 공통 지시의 네 단계 순서 대신 세 단계를 따르게 한다. 한국어 대화에만 붙는다. */
    static String flowBlock(String flow, java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return CoachFlows.B.equals(flow) && korean ? "\n\n" + resource("flows/b") : "";
    }

    static String practiceLoopTask(String doing, java.util.Locale language) {
        String id = TASK_FILES.get(doing);
        if (id == null) throw new IllegalStateException("practice loop task is missing: " + doing);
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return resource("tasks/" + (korean ? "ko" : "en") + "/" + id);
    }

    /**
     * 개인 프롬프트를 쓰는 대화(자문위원, 그리고 SOMA-795 부터 맞춤 코칭 배우)에서는 할 일 파일 예문 끝의 "어때요?"를 뺀다. 개인 프롬프트가 "어때요?"를 금지해도
     * 할 일 파일 예문을 따라 제안 끝에 붙였다(2026-10-22 로컬 재생: 수정판 7건 중 3건). 성격이 없는 배우의 할 일 파일은 그대로다.
     */
    static String withoutHowAbout(String task) {
        return task == null ? null : task.replace(" 어때요?", "").replace("한 뒤 \"어때요?\"로 묻는다", "한다");
    }

    /**
     * 프롬프트 id 로 덧붙일 글(SOMA-622). 기본("a")·빈 값·모르는 id 면 빈 문자열.
     * 자문위원 id 는 {@code personas/advisors/<id>.txt}(한국어 대화), {@code <id>.en.txt}(그 밖의 말, 있을 때만)를 쓴다.
     * 예전 대화에 저장된 "b1" 은 한국어 대화에서만 그대로 붙는다. 맨 앞의 길이 줄({@code [길이] 90})은 떼고 준다.
     */
    static String persona(String id, java.util.Locale language) {
        return persona(id, language, null);
    }

    /**
     * 자문위원 id 면 그 파일을, {@link #ACTOR_PROFILE} 이면 기억 갱신이 쓴 맞춤 코칭({@code profile})을 같은 자리에 붙인다
     * (SOMA-795). 맞춤 코칭은 한국어로 쓰므로 한국어 대화에만 붙는다.
     */
    static String persona(String id, java.util.Locale language, String profile) {
        return personaFile(id, language, profile).map(DirectVideoPrompts::withoutLengthLine).orElse("");
    }

    /** 이 프롬프트를 받은 대화에서 코치 말을 줄이기 시작하는 길이. 길이 줄이 없으면 공용 상한이다. */
    static int personaReplyLimit(String id, java.util.Locale language) {
        return personaReplyLimit(id, language, null);
    }

    /** 맞춤 코칭의 길이 줄은 모델이 정한 값이라 {@link #PROFILE_MIN_REPLY}~{@link #PROFILE_MAX_REPLY} 안으로 묶는다. */
    static int personaReplyLimit(String id, java.util.Locale language, String profile) {
        java.util.Optional<Integer> length = personaFile(id, language, profile).flatMap(DirectVideoPrompts::lengthLine);
        if (ACTOR_PROFILE.equals(id)) {
            return length.map(n -> Math.max(PROFILE_MIN_REPLY, Math.min(PROFILE_MAX_REPLY, n)))
                    .orElse(DirectVideoPracticeLoop.LONG_REPLY);
        }
        return length.orElse(DirectVideoPracticeLoop.LONG_REPLY);
    }

    /** 프롬프트를 받은 대화에서 줄이기가 말투와 길이를 공용 코치 쪽으로 되돌리지 않게 하는 줄. */
    static String personaShortenNote(String id, java.util.Locale language) {
        return personaShortenNote(id, language, null);
    }

    static String personaShortenNote(String id, java.util.Locale language, String profile) {
        if (persona(id, language, profile).isEmpty()) return "";
        if ("b1".equals(id)) {
            return "\n- 말투는 원래 말의 말투를 그대로 둔다. 원래 말이 \"~해요.\"로 방향을 줬으면 \"~해 봐도 좋아요\"로 바꾸지 않는다. 쿠션어나 칭찬을 더하지 않는다.";
        }
        int target = personaReplyLimit(id, language, profile) - 10;
        return "\n- 이 배우에게는 위의 50자 대신 공백 포함 " + target + "자 안쪽이 목표다. 이유를 말하는 한 문장은 지우지 않는다. 말투는 원래 말의 말투를 그대로 둔다.";
    }

    /** 자문위원 파일이 없는 배우에게 기억 갱신이 쓴 맞춤 코칭을 붙이는 프롬프트 id(SOMA-795). 대화 상태에 이 id 로 남는다. */
    static final String ACTOR_PROFILE = "actor-profile";
    static final int PROFILE_MIN_REPLY = 60;
    static final int PROFILE_MAX_REPLY = 160;

    private static java.util.Optional<String> personaFile(String id, java.util.Locale language, String profile) {
        if (id == null || id.isBlank() || CoachPersonas.DEFAULT.equals(id)) return java.util.Optional.empty();
        boolean korean = language == null || "ko".equals(language.getLanguage());
        if (ACTOR_PROFILE.equals(id)) {
            ActorCoaching coaching = korean ? ActorCoaching.parse(profile) : null;
            return coaching == null ? java.util.Optional.empty() : java.util.Optional.of(coaching.personaText());
        }
        if ("b1".equals(id)) return korean ? java.util.Optional.of(resource("personas/b1")) : java.util.Optional.empty();
        if (!id.matches("[a-z][a-z-]*")) return java.util.Optional.empty();
        return optionalResource("personas/advisors/" + id + (korean ? "" : ".en"));
    }

    private static final java.util.regex.Pattern LENGTH_LINE = java.util.regex.Pattern.compile("\\A\\[(?:길이|length)\\]\\s*(\\d{2,3})\\s*\\R?");

    private static String withoutLengthLine(String text) {
        return LENGTH_LINE.matcher(text).replaceFirst("").strip();
    }

    private static java.util.Optional<Integer> lengthLine(String text) {
        var match = LENGTH_LINE.matcher(text);
        return match.find() ? java.util.Optional.of(Integer.parseInt(match.group(1))) : java.util.Optional.empty();
    }

    private static java.util.Optional<String> optionalResource(String name) {
        String path = "/coaching/direct-video/" + name + ".txt";
        return StructuredJson.class.getResource(path) == null ? java.util.Optional.empty()
                : java.util.Optional.of(StructuredJson.textResource(path).strip());
    }

    static String forRoutes(List<DirectVideoRoute> routes) {
        return common() + "\n\n" + routes.stream().map(route -> resource(route.id))
                .collect(Collectors.joining("\n\n"));
    }
    private static String resource(String name) {
        return StructuredJson.textResource("/coaching/direct-video/" + name + ".txt").strip();
    }

    /** 목적별 코칭 프롬프트(SOMA-719). coaching/direct-video/purpose/<이름>.txt */
    static String purposeResource(String name) {
        return resource("purpose/" + name);
    }
}
