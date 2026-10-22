package com.acttub.actingapi.feature.memory.app;

import com.acttub.actingapi.feature.coach.app.ActorCoaching;
import com.acttub.actingapi.integration.llm.TextValidator;
import com.acttub.actingapi.platform.web.PythonText;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 일반 배우의 "이 배우에게 맞춘 코칭"을 쓴다 (SOMA-795).
 *
 * <p>자문위원은 사람이 지난 대화를 보고 쓴 프롬프트({@code personas/advisors/<id>.txt})를 받는다. 그 수준을 일반 배우에게도
 * 주려고, 자문위원 파일에서 뽑은 칸(막혔을 때 방식·첫 질문 틀·정리 틀·쓰지 않을 말·이유 먼저·물으면 바로 답·질문 수 상한·
 * 원하는 피드백 쪽·짚지 않을 것·답 길이)을 대화가 끝날 때마다 다시 정해 JSON 으로 저장한다({@link ActorCoaching}). 코치는 이 칸으로
 * 단계 지시를 바꿔 끼우고, 자문위원 파일 모양의 글을 붙이고, 질문 수·길이를 서버에서 묶는다.
 *
 * <p><b>담지 않는 것.</b> 연기 문제 진단("혼자 감정에 빠진다" 같은 것)은 쓰지 않는다 — 10/13 운영에서 지난 진단을 기억으로
 * 넣었더니 "참고만" 규칙을 붙여도 새 진단이 그쪽으로 끌려갔고, 칸을 빼서야 멈췄다. 장면·대본 내용도 쓰지 않는다 — 이 글은
 * 다른 대본의 연습에도 실린다. 남기는 것은 코치가 <b>어떻게 말할지</b>(첫 질문·마지막 정리의 모양, 쓰지 않을 말, 이유를 먼저
 * 댈지, 물으면 바로 답할지, 길이)뿐이다.
 *
 * <p>근거가 모자라면 쓰지 않는다 — 배우가 두 번 이상 답한 대화가 둘 이상이거나, 노트 평가·정정이 하나라도 있어야 한다.
 */
public final class CoachingProfileWriter {

    private static final Logger LOG = LoggerFactory.getLogger(CoachingProfileWriter.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 저장 칸 상한(V52 의 coaching_profile 2,000자)보다 여유를 둔다. */
    static final int MAX_CHARS = 1800;
    static final int MAX_SUMMARY_CHARS = 420;
    /** 쓰지 않을 말은 어느 대본에서도 나오는 짧은 표현만 — 긴 문장은 장면의 질문이기 쉽다. */
    static final int MAX_NEVER_SAY_CHARS = 16;
    static final int MAX_NEVER_SAY = 6;
    static final int MAX_FIRST_QUESTION_CHARS = 60;
    static final int MAX_CLOSING_CHARS = 140;
    static final int MAX_SKIP = 4;
    static final int MAX_SKIP_CHARS = 24;
    /** 모델에 넘기는 대화 수와 한 턴의 길이 — 입력을 묶어 둔다. */
    public static final int MAX_CONVERSATIONS = 8;
    public static final int MAX_TURNS_PER_CONVERSATION = 14;
    public static final int MAX_TURN_CHARS = 220;


    /** 연기 문제 진단으로 읽히는 말. 맞춤 코칭에는 코치가 말하는 방식만 남는다. */
    private static final Pattern DIAGNOSIS = Pattern.compile(
            "버릇|습관|약점|단점|고쳐야|감정에\\s*빠|뻣뻣|부자연|국어책|발음이|발성이|딕션이|호흡이|표정이\\s*(굳|없|어색)|"
                    + "말이\\s*빠르|톤이\\s*(높|낮|일정|단조)|몰입(이|을)\\s*(못|안)|연기가\\s*(어색|과하|약하|단조)|"
                    + "(이|그)\\s*배우(는|의)\\s*(문제|약점|단점)");
    /**
     * 자문위원 7명 공통 금지와 부딪치는 말(SOMA-795 검토). 둘 중 고르게 하는 질문, "확인하며/살피며/흔들리는지", 칭찬·감상,
     * 시키는 말이다. 금지를 권하는 줄("고르게 하지 않는다")은 남기고, 권하거나 쓰는 줄만 버린다 — 부정은 같은 마디 안에서 본다.
     */
    private static final Pattern CHOICE = Pattern.compile(
            "선택형|양자택일|둘\\s*중|두\\s*가지\\s*(가능성|선택지|중|방향|안)|중에\\s*골|고르게|골라|선택지");
    private static final Pattern EITHER_TEMPLATE = Pattern.compile(
            "(래요|까요|예요|에요|어요|아요|요)\\s*[,，]\\s*[^\"”]{0,30}(래요|까요|예요|에요|어요|아요)\\?");
    private static final Pattern CHECKING = Pattern.compile("확인하며|확인하면서|살피며|살피면서|살펴|흔들리는지");
    private static final Pattern PRAISE = Pattern.compile(
            "칭찬|감상(을|평)|잘했다고|잘했어요|좋았다고|좋았어요");
    private static final Pattern COMMAND = Pattern.compile("세요|명령형|지시형으로\\s*말");
    /** 부정·금지, 그리고 "그게 안 통했다"는 근거 문장(문단에서 "선택지가 이어지면 그만이라고 끝냈다")도 권하는 말이 아니다. */
    private static final Pattern NEGATED = Pattern.compile(
            "않|말고|말 것|금지|없이|대신|피한다|빼고|쓰지\\s*말|못하|못했|끝냈|그만|싫어|불편");
    /** 마디: 문장 끝과 연결 어미("~고", "~며", "~지만")로 자른다. 쉼표로는 자르지 않는다 — "칭찬, 감상을 하지 않는다"는 한 마디다. */
    private static final Pattern CLAUSE = Pattern.compile(
            "(?<=[.!?。])\\s+|;\\s*|(?<=[^않]고)[,，]?\\s+|(?<=며)[,，]?\\s+|(?<=지만)[,，]?\\s+");
    /**
     * 한 장면의 인물 해석(SOMA-795 검토). "상대의 반응을 끌어내려는 것이 아니다", "특정 반응을 얻어 내고 싶다" 처럼 인물이 무엇을
     * 하려 했는지는 그 장면의 것이라 배우 단위 글에 남기지 않는다.
     */
    private static final Pattern SCENE_INTERPRETATION = Pattern.compile(
            "(반응|대답|사과|인정|위로|관심|교훈)[을를이가]?\\s*(끌어\\s*내|얻어\\s*내|받아\\s*내|얻으려|얻고\\s*싶)|"
                    + "(의도|목적|마음|감정)[은는이가]\\s*[^.]{0,30}(아니라|아니다|아니었)|"
                    + "(놀리|매달리|따지|달래|위로하|사과하)(려는|려고|려던)\\s*(것|거|의도|마음)|"
                    + "(라고|다고)\\s*정정했(으므로|으니|기\\s*때문)");

    /** 코치 말투를 반말로 바꾸라는 줄. 코치는 누구에게나 존댓말이다. */
    private static final Pattern INFORMAL = Pattern.compile("반말(을|로|도)\\s*(사용|쓴|써|말하|답하)");
    private static final Pattern QUOTED = Pattern.compile("\"[^\"]*\"|“[^”]*”|'[^']*'|‘[^’]*’|「[^」]*」");
    private static final Pattern FENCED_JSON = Pattern.compile("^```(?:json)?\\s*(.*?)\\s*```$", Pattern.DOTALL);
    /** 장면 글과 이만큼(공백 뺀 글자) 겹치면 장면 내용이 샜다고 본다. */
    static final int SCENE_OVERLAP = 9;

    static final String SYSTEM_PROMPT = """
            너는 연기 코치 AI 의 설정을 배우 한 사람에게 맞추는 사람이다.
            아래에 이 배우와 코치 AI 가 나눈 최근 대화, 배우가 코칭 노트에 남긴 평가, 배우가 "아니다"라고 정정한 것이 있다.
            이것만 보고, 다음 대화에서 코치가 **이 배우에게 어떻게 말해야 하는지**를 아래 칸으로 정한다.

            코치 AI 의 대화: 첫 응답에서 영상을 보고 <설계>의 "첫 질문 모양"으로 장면 전체에 대해 하나를 묻는다. 그 뒤 배우 답에 따라
            보여 주기 → 스스로 찾기 → 마지막 정리로 간다. 배우 답이 짧거나 막히면 지금은 코치가 하나를 이유와 함께 제안한다. 마지막 정리의
            첫 줄은 숨은 <다음 테이크> 줄이고 그 아래가 배우가 보는 정리 말이다.

            칸마다 **근거가 있을 때만** 값을 정한다. 근거는 배우가 한 말, 배우가 답한 방식(길이, 바로 끝냈는지, 되물었는지, "몰라"
            뒤에 무엇이 통했는지), 노트 평가와 그 한 줄, 정정이다. 근거가 없는 칸은 빼라(null). 칸을 빼면 그 칸은 공통 동작 그대로다.
            - stuck: 배우가 막혔을 때 무엇이 통했는가. "choice"(둘 중 고르기에 잘 답했다) / "propose_one"(코치가 하나를 제안했을 때
              움직였다, 고르기에는 "몰라"·"그만") / "easier_open"(쉬운 열린 질문에 답했다). 근거 없으면 null.
            - first_question: 이 배우에게 통한 첫 질문의 틀 한 문장. [인물], [상대] 자리표시만 쓰고 장면 내용은 쓰지 않는다. 물음표로
              끝난다. 둘 중 고르는 질문은 안 된다. 근거 없으면 null.
            - closing: 이 배우가 받아들인 정리의 틀. [행동1], [행동2], [대사] 자리표시를 쓰고 "~해 봐도 좋아요"로 말한다(예:
              처음엔 [행동1], "[대사]"부터는 [행동2]해 봐도 좋아요. [이유 한 문장]). 근거 없으면 null.
            - never_say: 코치가 실제로 썼고 배우가 싫어했거나 납득하지 못한 짧은 표현(15자 안쪽, 어느 대본에서도 나올 수 있는 말).
              인물 이름이 든 말이나 장면의 질문 문장은 안 된다. 없으면 [].
            - reasons_first: 배우가 이유를 원했으면 true, 이유가 길어 싫어했으면 false, 근거 없으면 null.
            - answer_directly: 배우가 "왜요?", "어떻게 해요?"처럼 물었는데 질문으로 돌려받아 불만이었거나, 바로 답을 받았을 때 움직였으면 true.
            - max_questions: 배우가 질문이 길게 이어질 때 "그만"으로 끊거나 지쳐 했으면 정리 전 질문 수 2~4. 근거 없으면 null.
            - feedback_focus: 배우가 원한 피드백 쪽. "root"(인물이 상대에게 하는 일, 근본) / "method"(바로 해 볼 구체적 방법) /
              "both". 배우의 말·평가로만 정한다. 근거 없으면 null.
            - skip: 배우가 싫어했거나 무시한 관찰 종류(예: "시선·입 모양 같은 작은 겉모습", "카메라 시선"). 상대 배우 없음·대본 보며
              촬영 같은 영상 환경은 배우가 말했을 때만. 없으면 [].
            - reply_length: 이 배우에게 맞는 한 번의 말 길이 60~160. 배우가 길게 묻고 이유를 원하면 길게, 짧게 답하고 빨리 끝내면
              짧게. 근거 없으면 null.
            - summary: 이 배우가 어떤 말에서 얻었고 어떤 때 납득하지 못했는지, 근거로 두세 문장.

            지킬 것:
            - **연기 문제를 진단하지 않는다.** "감정에 빠진다", "말이 빠르다", 버릇·습관·약점 같은 말은 어디에도 쓰지 않는다.
            - **장면·대본 내용과 한 장면의 해석을 쓰지 않는다.** 인물 이름, 대사, 상황, 인물의 의도·감정 해석은 쓰지 않는다. 정정은
              대화 방식으로만 일반화한다.
            - **공통 금지를 넘지 않는다.** 칭찬·감상, 시키는 말("~하세요"), "확인하며/살피며/흔들리는지"를 틀에 넣지 않는다. 둘 중
              고르는 질문은 stuck 이 "choice" 일 때만 코치가 쓴다 — 틀에는 넣지 않는다. 코치는 늘 존댓말("~해요")이다.
            - [지금 쓰여 있는 맞춤 코칭]이 있으면 그것을 고쳐 쓴다. 새 대화가 그와 다르면 새 대화를 따른다.

            아래 JSON 만 출력한다. 근거가 전체적으로 모자라면 {} 를 출력한다.
            {"stuck": null, "first_question": null, "closing": null, "never_say": [], "reasons_first": null,
             "answer_directly": null, "max_questions": null, "feedback_focus": null, "skip": [], "reply_length": null,
             "summary": "..."}
            """;

    public CoachingProfileWriter() {
    }

    /** 맞춤 코칭을 쓸 만큼 근거가 있는가. */
    public static boolean enoughEvidence(ProfileMaterial material) {
        long answered = material.conversations().stream().filter(c -> c.actorReplies() >= 2).count();
        boolean rated = material.conversations().stream().anyMatch(c -> c.rating() != null);
        boolean corrected = material.conversations().stream().anyMatch(c -> !c.corrections().isEmpty());
        return answered >= 2 || rated || corrected;
    }

    /**
     * @return 저장할 글. 근거가 모자라거나, 모델이 아무것도 못 냈거나, 검사에서 다 걸렀으면 비어 있다 — 그때 지금 값은 그대로 둔다
     */
    public Optional<String> write(ProfileMaterial material, BiFunction<String, String, String> generate) {
        if (!enoughEvidence(material)) return Optional.empty();
        String raw = generate.apply(SYSTEM_PROMPT, buildPrompt(material));
        return render(parse(raw), material);
    }

    static String buildPrompt(ProfileMaterial material) {
        List<String> lines = new ArrayList<>();
        String tone = material.actorMemory().get("tone");
        String wants = material.actorMemory().get("wants");
        if (present(tone) || present(wants)) {
            lines.add("[배우 기억에 있는 것]");
            if (present(wants)) lines.add("- 코치에게 바라는 것: " + wants);
            if (present(tone)) lines.add("- 말투: " + tone);
            lines.add("");
        }
        lines.add("[지금 쓰여 있는 맞춤 코칭]");
        lines.add(present(material.previousProfile()) ? material.previousProfile().strip() : "(아직 없음)");
        int index = 0;
        for (ProfileMaterial.Conversation conversation : material.conversations()) {
            if (++index > MAX_CONVERSATIONS) break;
            lines.add("");
            lines.add("[대화 " + index + " · " + conversation.day() + " · 배우 답 " + conversation.actorReplies() + "번 · "
                    + closeLabel(conversation.closeReason()) + "]");
            int turns = 0;
            for (ProfileMaterial.Turn turn : conversation.turns()) {
                if (++turns > MAX_TURNS_PER_CONVERSATION) {
                    lines.add("(뒤 턴 생략)");
                    break;
                }
                lines.add(("actor".equals(turn.role()) ? "배우: " : "코치: ") + clip(turn.text(), MAX_TURN_CHARS));
            }
            if (!conversation.corrections().isEmpty()) {
                lines.add("배우가 아니라고 한 것: " + String.join(" / ", conversation.corrections()));
            }
            if (conversation.rating() != null) {
                lines.add("코칭 노트 평가: " + ("helpful".equals(conversation.rating()) ? "도움됨" : "도움 안 됨")
                        + (present(conversation.ratingComment()) ? " — \"" + conversation.ratingComment().strip() + "\"" : ""));
            }
        }
        lines.add("");
        lines.add("배우 말 앞의 괄호(\"(정정)\", \"(평가 요청)\" 등)는 코치가 대화 중에 붙인 분류다. 배우의 말이 아니다.");
        lines.add("JSON 만 출력하라.");
        return String.join("\n", lines);
    }

    private static String closeLabel(String reason) {
        if (reason == null) return "열린 채 끝남";
        return switch (reason) {
            case "user_ended" -> "배우가 끝냄";
            case "exhausted" -> "코치가 정리하고 끝냄";
            default -> reason;
        };
    }

    private static JsonNode parse(String raw) {
        String text = PythonText.strip(raw == null ? "" : raw);
        Matcher fenced = FENCED_JSON.matcher(text);
        if (fenced.matches()) text = PythonText.strip(fenced.group(1));
        try {
            JsonNode node = MAPPER.readTree(text);
            return node != null && node.isObject() ? node : MAPPER.createObjectNode();
        } catch (JsonProcessingException notJson) {
            LOG.info("맞춤 코칭 응답이 JSON 이 아니다");
            return MAPPER.createObjectNode();
        }
    }

    /**
     * 모델 응답을 맞춤 코칭 설정({@link ActorCoaching})으로 만든다. 칸마다 검사를 못 넘으면 그 칸만 비운다(공통 동작). 정해진 칸이
     * 하나도 없거나 근거 문단이 비면 쓰지 않는다.
     *
     * @return 저장할 JSON
     */
    static Optional<String> render(JsonNode node, ProfileMaterial material) {
        Map<String, String> dropped = new LinkedHashMap<>();
        Set<String> scene = sceneGrams(material.sceneTexts());
        // 문단은 문장마다 본다 — 한 문장이 걸렸다고 근거 문단 전체를 버리지 않는다.
        List<String> sentences = new ArrayList<>();
        for (String sentence : text(node, "summary").split("(?<=[.!?。])\\s+")) {
            String kept = PythonText.strip(sentence);
            if (kept.isEmpty()) continue;
            Optional<String> problem = problem(kept, scene);
            // 둘 중 고르기가 통했다는 근거 문장은 stuck=choice 의 근거라 남긴다 — 그 배우에게는 고르기가 공통 동작 그대로다.
            if (problem.isPresent() && "choice".equals(text(node, "stuck")) && problem.get().contains("선택형")) problem = Optional.empty();
            if (problem.isPresent()) {
                dropped.put("summary:" + clip(kept, 30), problem.get());
            } else {
                sentences.add(kept);
            }
        }
        String summary = String.join(" ", sentences);
        if (summary.codePointCount(0, summary.length()) > MAX_SUMMARY_CHARS) {
            dropped.put("summary", "너무 김");
            summary = "";
        }
        String first = template(node, "first_question", MAX_FIRST_QUESTION_CHARS, scene, dropped);
        if (first != null && !first.endsWith("?")) {
            dropped.put("first_question", "질문이 아님");
            first = null;
        }
        String closing = template(node, "closing", MAX_CLOSING_CHARS, scene, dropped);
        if (closing != null && !closing.contains("해 봐도 좋아요")) {
            dropped.put("closing", "제안 말투가 아님");
            closing = null;
        }
        List<String> never = new ArrayList<>();
        for (JsonNode phrase : node.path("never_say")) {
            String value = phrase.isTextual() ? stripQuotes(phrase.asText()) : "";
            if (value.isEmpty() || value.codePointCount(0, value.length()) > MAX_NEVER_SAY_CHARS || never.size() >= MAX_NEVER_SAY) {
                if (!value.isEmpty()) dropped.put("never_say:" + clip(value, 20), "길거나 많음");
                continue;
            }
            // 코치가 실제로 이 배우에게 쓴 말만 남긴다 — 근거 없는 금지어 목록은 코치를 어색하게 만든다.
            if (!saidByCoach(material, value)) {
                dropped.put("never_say:" + value, "코치가 쓴 적 없음");
                continue;
            }
            if (overlapsScene(value, scene)) {
                dropped.put("never_say:" + value, "장면 내용");
                continue;
            }
            never.add(value);
        }
        List<String> skip = new ArrayList<>();
        for (JsonNode item : node.path("skip")) {
            String value = item.isTextual() ? PythonText.strip(item.asText()) : "";
            if (value.isEmpty() || skip.size() >= MAX_SKIP || value.codePointCount(0, value.length()) > MAX_SKIP_CHARS) continue;
            Optional<String> problem = problem(value, scene);
            if (problem.isPresent()) {
                dropped.put("skip:" + clip(value, 20), problem.get());
                continue;
            }
            skip.add(value);
        }
        ActorCoaching coaching = new ActorCoaching(
                text(node, "stuck"), first, closing, never,
                node.path("reasons_first").isBoolean() ? node.path("reasons_first").asBoolean() : null,
                node.path("answer_directly").isBoolean() ? node.path("answer_directly").asBoolean() : null,
                node.path("max_questions").canConvertToInt() ? node.path("max_questions").asInt() : null,
                text(node, "feedback_focus"), skip,
                node.path("reply_length").canConvertToInt() ? node.path("reply_length").asInt() : null,
                summary, null);
        if (!dropped.isEmpty()) LOG.info("맞춤 코칭에서 걸러낸 칸: {}", dropped.keySet());
        // 근거 문단이 걸러져 비어도 정해진 칸이 있으면 쓴다 — 바꿔 끼우기는 칸이 하고, 문단은 설명일 뿐이다.
        if (!coaching.decidesAnything()) return Optional.empty();
        String json = coaching.toJson();
        return json.codePointCount(0, json.length()) > MAX_CHARS ? Optional.empty() : Optional.of(json);
    }

    /** 틀 문장 칸(첫 질문·정리). 길이와 진단·장면·공통 금지 검사를 넘어야 한다. */
    private static String template(JsonNode node, String key, int max, Set<String> scene, Map<String, String> dropped) {
        String value = text(node, key);
        if (value.isEmpty()) return null;
        if (value.codePointCount(0, value.length()) > max) {
            dropped.put(key, "너무 김");
            return null;
        }
        Optional<String> problem = problem(value, scene);
        if (problem.isPresent()) {
            dropped.put(key + ":" + clip(value, 30), problem.get());
            return null;
        }
        return value;
    }

    /** 진단·장면 내용·대화 검사(판정 어휘·타임코드)를 본다. 따옴표 안은 배우나 코치가 한 말이라 판정 어휘 검사에서 뺀다. */
    static Optional<String> problem(String value, Set<String> scene) {
        if (value.isBlank()) return Optional.of("빈 값");
        String outsideQuotes = QUOTED.matcher(value).replaceAll("\"\"");
        if (DIAGNOSIS.matcher(outsideQuotes).find()) return Optional.of("연기 문제 진단");
        if (INFORMAL.matcher(outsideQuotes).find()) return Optional.of("코치 반말");
        Optional<String> common = commonBan(value);
        if (common.isPresent()) return common;
        if (SCENE_INTERPRETATION.matcher(value).find()) return Optional.of("장면 해석");
        if (overlapsScene(value, scene)) return Optional.of("장면 내용");
        if (!TextValidator.validateTurn(outsideQuotes).failures().isEmpty()) return Optional.of("대화 검사 실패");
        return Optional.empty();
    }

    /** 공통 금지와 부딪치는지. 그 표현을 금지하는 마디("~를 쓰지 않는다")는 괜찮다. */
    static Optional<String> commonBan(String value) {
        String outsideQuotes = QUOTED.matcher(value).replaceAll("\"\"");
        if (CHECKING.matcher(outsideQuotes).find()) return Optional.of("공통 금지 표현(확인하며 등)");
        boolean negatedLine = NEGATED.matcher(value).find();
        if (EITHER_TEMPLATE.matcher(value).find() && !negatedLine) return Optional.of("공통 금지(양자택일 질문)");
        for (String clause : CLAUSE.split(value)) {
            boolean negated = NEGATED.matcher(clause).find();
            if (negated) continue;
            if (CHOICE.matcher(clause).find()) return Optional.of("공통 금지(선택형 질문)");
            if (PRAISE.matcher(clause).find()) return Optional.of("공통 금지(칭찬·감상)");
            if (COMMAND.matcher(clause).find()) return Optional.of("공통 금지(시키는 말)");
        }
        return Optional.empty();
    }

    private static boolean saidByCoach(ProfileMaterial material, String phrase) {
        String needle = compact(phrase);
        if (needle.isEmpty()) return false;
        return material.conversations().stream().flatMap(c -> c.turns().stream())
                .anyMatch(turn -> !"actor".equals(turn.role()) && compact(turn.text()).contains(needle));
    }

    private static Set<String> sceneGrams(List<String> texts) {
        Set<String> grams = new HashSet<>();
        for (String text : texts) {
            String compact = compact(text);
            int[] points = compact.codePoints().toArray();
            for (int i = 0; i + SCENE_OVERLAP <= points.length; i++) {
                grams.add(new String(points, i, SCENE_OVERLAP));
            }
        }
        return grams;
    }

    private static boolean overlapsScene(String value, Set<String> scene) {
        if (scene.isEmpty()) return false;
        int[] points = compact(value).codePoints().toArray();
        for (int i = 0; i + SCENE_OVERLAP <= points.length; i++) {
            if (scene.contains(new String(points, i, SCENE_OVERLAP))) return true;
        }
        return false;
    }

    private static String compact(String text) {
        return text == null ? "" : text.replaceAll("[\\s\\p{Punct}“”‘’「」·…]", "");
    }

    private static String stripQuotes(String text) {
        String stripped = PythonText.strip(text);
        return stripped == null ? "" : stripped.replaceAll("(?:^[\"“‘'「]+)|(?:[\"”’'」]+$)", "").strip();
    }

    private static String text(JsonNode node, String key) {
        JsonNode value = node.path(key);
        return value.isTextual() ? PythonText.strip(value.asText()) : "";
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }

    private static String clip(String text, int max) {
        String value = text == null ? "" : text.strip().replaceAll("\\s*\\n\\s*", " ");
        if (value.codePointCount(0, value.length()) <= max) return value;
        return value.substring(0, value.offsetByCodePoints(0, max)).stripTrailing() + "…";
    }
}
