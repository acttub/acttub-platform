package com.acttub.actingapi.feature.reading.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.IntUnaryOperator;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.reading.domain.CocreateRules;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Conditions;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Experience;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Issue;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Slot;
import com.acttub.actingapi.feature.reading.domain.CocreatedScript;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateRepository.Row;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 찍을 대사 같이 만들기(SOMA-721) — 감정·상황·원하는 방향으로 AI 가 대본을 만들고, 배우가 고치고(성공한 수정만 무료 3회),
 * 확정하면 기존 「내 대본」(reading.script)에 저장한다. 프롬프트 셋(생성·수정·걸린 줄 고치기)과 검사는 2026-10-19 인계본을
 * 그대로 쓰고, 코칭용 1인 독백만 더했다.
 *
 * <p>생성: 같은 요청 id 는 모델을 한 번만 부른다(먼저 만드는 중 줄을 넣는다). 모델 답은 코드가 검사하고, 특정 줄 문제는 고치기
 * 프롬프트로 한 번 고친다. 구조·안전 문제가 남으면 다른 결말·소품으로 한 번 더 만들고, 그래도 안 되면 실패다(줄 길이 같은
 * 가벼운 경고는 보인다). 대본은 생성한 글만 쓴다 — 사용자 대본이나 기존 작품을 프롬프트에 넣지 않는다.
 *
 * <p>모델 호출은 트랜잭션 밖이다. 수정은 지금 버전을 표시로 잡고(겹친 수정은 409) 성공했을 때만 횟수를 센다.
 */
public class ScriptCocreateService {

    private static final Logger LOGGER = Logger.getLogger(ScriptCocreateService.class.getName());
    private static final Duration STALE = Duration.ofMinutes(5);
    private static final int RECENT = 3;
    private static final int ATTEMPTS = 2;
    private static final String PROMPT_DIR = "/reading/sample-script/";

    private final ScriptCocreateRepository cocreations;
    private final ScriptCocreateModel model;
    private final ScriptService scripts;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final IntUnaryOperator random;
    private final Map<String, String> prompts = new LinkedHashMap<>();

    public ScriptCocreateService(ScriptCocreateRepository cocreations, ScriptCocreateModel model, ScriptService scripts,
            ObjectMapper mapper, Clock clock, IntUnaryOperator random) {
        this.cocreations = cocreations;
        this.model = model;
        this.scripts = scripts;
        this.mapper = mapper;
        this.clock = clock;
        this.random = random;
        for (String name : List.of("generate.txt", "generate-monologue.txt", "revise.txt", "fix.txt")) {
            prompts.put(name, load(name));
        }
    }

    /**
     * @param age 만 나이. 모르면 {@code null}
     * @param gender {@code female}·{@code male}·그 밖(모름)
     * @param goal {@code hobby}·{@code audition}·{@code professional}·{@code null}
     * @param emotion 비었거나 「잘 모르겠어요」면 서버가 고른다
     * @param situation 비었거나 「아무거나 좋아요」면 서버가 고른다
     */
    public record Request(
            Experience experience,
            Integer age,
            String gender,
            String goal,
            String emotion,
            String situation,
            String direction,
            int characterCount,
            int minutes) {
    }

    /** @param text 비면 배역 수·분량만 바꾼다. @param characterCount·@param minutes {@code null} 이면 그대로 */
    public record Revision(int baseVersion, String text, Integer characterCount, Integer minutes) {
    }

    /**
     * @param version 1부터 센 지금 버전
     * @param versionCount 지금까지 쌓인 버전 수
     * @param note 이 버전을 만든 수정의 한 줄 설명. 첫 버전은 {@code null}
     * @param scriptId 확정해 저장한 「내 대본」. 아직이면 {@code null}
     */
    public record View(
            UUID id,
            int version,
            int versionCount,
            CocreatedScript script,
            int minutes,
            int characterCount,
            int estimatedSeconds,
            String emotion,
            String situation,
            int revisionsUsed,
            int revisionsLeft,
            String note,
            UUID scriptId,
            Instant createdAt,
            boolean created) {
    }

    public record Saved(UUID id, UUID scriptId, boolean created) {
    }

    /** 한 버전 — 대본과 그 버전의 배역 수·분량·내 대사 수. */
    record Version(CocreatedScript script, int characterCount, int minutes, int myLines, String note) {
    }

    /** 만들기. 같은 요청 id 로 다시 오면 먼저 만든 것을 준다({@code created=false}). */
    public View generate(UUID userId, UUID requestId, Request request) {
        if (!CocreateRules.allowedCount(request.characterCount()) || !CocreateRules.allowedLength(request.minutes())) {
            throw new ApiException(422, "sample_script_invalid_options");
        }
        Instant now = clock.instant();
        Row existing = cocreations.findByRequest(userId, requestId);
        if (existing != null) {
            if (existing.ready()) {
                return view(existing, false);
            }
            if (existing.createdAt().isAfter(now.minus(STALE))) {
                throw new ApiException(409, "sample_script_in_progress");
            }
            cocreations.deletePending(existing.id());
        }
        if (cocreations.countSince(userId, now.minus(Duration.ofDays(1))) >= CocreateRules.DAILY_LIMIT) {
            throw new ApiException(429, "sample_script_daily_limit");
        }
        UUID id = UUID.randomUUID();
        if (!cocreations.insertPending(id, userId, requestId, now)) {
            throw new ApiException(409, "sample_script_in_progress");
        }
        boolean done = false;
        try {
            Produced produced = produce(base(request), recent(userId));
            Version first = new Version(produced.script(), request.characterCount(), request.minutes(),
                    produced.script().myLines(), null);
            cocreations.complete(id, writeConditions(produced.conditions()), writeVersions(List.of(first)),
                    produced.model(), clock.instant());
            done = true;
        } finally {
            if (!done) {
                cocreations.deletePending(id);
            }
        }
        return view(cocreations.find(userId, id), true);
    }

    public View find(UUID userId, UUID id) {
        return view(ready(userId, id), false);
    }

    /** 고치기. 실패하면 원본과 횟수는 그대로다. */
    public View revise(UUID userId, UUID id, Revision revision) {
        Row row = ready(userId, id);
        if (row.scriptId() != null) {
            throw new ApiException(409, "sample_script_saved");
        }
        if (row.revisionsUsed() >= CocreateRules.FREE_REVISIONS) {
            throw new ApiException(429, "sample_script_revision_limit");
        }
        if (revision.baseVersion() != row.currentVersion()) {
            throw new ApiException(409, "sample_script_version_conflict");
        }
        List<Version> versions = readVersions(row.versions());
        Version current = versions.get(row.currentVersion() - 1);
        int count = revision.characterCount() == null ? current.characterCount() : revision.characterCount();
        int minutes = revision.minutes() == null ? current.minutes() : revision.minutes();
        if (!CocreateRules.allowedCount(count) || !CocreateRules.allowedLength(minutes)) {
            throw new ApiException(422, "sample_script_invalid_options");
        }
        String text = revision.text() == null ? "" : revision.text().strip();
        boolean resized = count != current.characterCount() || minutes != current.minutes();
        if (!resized && text.isEmpty()) {
            throw new ApiException(422, "sample_script_no_change");
        }
        Instant now = clock.instant();
        if (!cocreations.claim(userId, id, row.currentVersion(), CocreateRules.FREE_REVISIONS, now, now.minus(STALE))) {
            throw new ApiException(409, "sample_script_busy");
        }
        boolean done = false;
        try {
            Conditions was = readConditions(row.conditions())
                    .resized(current.characterCount(), current.minutes())
                    .withMyLines(current.myLines());
            Conditions target = resized ? was.resized(count, minutes) : was;
            Revised revised = reviseOnce(current.script(), target, request(target, current, text, resized));
            List<Version> next = new ArrayList<>(versions);
            next.add(new Version(revised.script(), count, minutes, revised.script().myLines(), revised.note()));
            cocreations.appendVersion(id, writeVersions(next), next.size(), clock.instant());
            done = true;
        } finally {
            if (!done) {
                cocreations.release(id);
            }
        }
        return view(cocreations.find(userId, id), false);
    }

    /** 지난 버전으로 되돌린다. 사용한 수정 횟수는 돌려주지 않는다. */
    public View restore(UUID userId, UUID id, int version) {
        Row row = ready(userId, id);
        if (row.scriptId() != null) {
            throw new ApiException(409, "sample_script_saved");
        }
        int count = readVersions(row.versions()).size();
        if (version < 1 || version > count) {
            throw new ApiException(422, "sample_script_version_not_found");
        }
        if (!cocreations.restore(userId, id, version, clock.instant())) {
            throw new ApiException(409, "sample_script_busy");
        }
        return view(cocreations.find(userId, id), false);
    }

    /**
     * 확정 — 지금 버전을 「내 대본」에 저장한다. 이미 저장했으면 그 대본을 준다. 생성 기록 id 를 대본 저장의 요청 id 로
     * 써서 끊긴 뒤 다시 와도 대본이 둘 생기지 않는다.
     */
    public Saved save(UUID userId, boolean guest, UUID id) {
        return cocreations.withSaveLock(userId, id, row -> {
            if (row == null || !row.ready()) {
                throw new ApiException(404, "sample_script_not_found");
            }
            if (row.scriptId() != null) {
                return new Saved(id, row.scriptId(), false);
            }
            if (row.busySince() != null) {
                throw new ApiException(409, "sample_script_busy");
            }
            Version current = readVersions(row.versions()).get(row.currentVersion() - 1);
            ScriptService.Created created = scripts.create(userId, guest, id, current.script().toDraft());
            cocreations.linkScript(userId, id, created.script().id(), clock.instant());
            return new Saved(id, created.script().id(), created.created());
        });
    }

    // ---------------------------------------------------------------- 생성

    record Produced(Conditions conditions, CocreatedScript script, String model) {
    }

    record Revised(CocreatedScript script, String note) {
    }

    private Produced produce(Conditions base, List<Conditions> recent) {
        Set<String> avoidEndings = new HashSet<>();
        Set<String> avoidProps = new HashSet<>();
        for (Conditions past : recent) {
            avoidEndings.add(past.ending().name());
            avoidProps.add(past.prop().name());
        }
        RuntimeException modelFailure = null;
        String reason = "no attempt";
        String feedback = "";
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            Slot ending = CocreateRules.pick(CocreateRules.ENDINGS, base.minor(), avoidEndings, random);
            Slot prop = CocreateRules.pick(CocreateRules.PROPS, base.minor(), avoidProps, random);
            avoidEndings.add(ending.name());
            avoidProps.add(prop.name());
            Conditions conditions = base.withSlot(ending, prop);
            ScriptCocreateModel.Reply reply;
            try {
                reply = model.generate(generatePrompt(conditions) + feedback, maxTokens(conditions.minutes()));
            } catch (RuntimeException failure) {
                modelFailure = failure;
                reason = "model: " + failure.getMessage();
                continue;
            }
            CocreatedScript script = parse(reply.text());
            List<Issue> issues = CocreateRules.check(script, conditions);
            if (issues.stream().anyMatch(Issue::structural)) {
                reason = "structure: " + issues;
                feedback = lengthFeedback(script, conditions);
                continue;
            }
            script = fix(script, issues, conditions);
            List<Issue> after = CocreateRules.check(script, conditions);
            if (after.stream().anyMatch(Issue::fatal)) {
                reason = "validation: " + after;
                continue;
            }
            if (!after.isEmpty()) {
                LOGGER.info("sample script kept light issues: " + after);
            }
            return new Produced(conditions.withMyLines(script.myLines()), script, reply.model());
        }
        LOGGER.warning("sample script generation failed: " + reason);
        throw modelFailure != null
                ? ApiException.external(502, "sample_script_failed", modelFailure)
                : ApiException.unexpected(502, "sample_script_failed", new IllegalStateException(reason));
    }

    /**
     * 직전 시도가 분량 때문에 막혔으면 다음 시도 프롬프트 끝에 붙일 안내. 같은 프롬프트를 그대로 다시 부르면 같은 길이로 또
     * 벗어나기 쉬워서, 실제 글자 수와 허용 범위를 알려 준다. 프롬프트 파일은 건드리지 않고 코드에서만 덧붙인다.
     */
    static String lengthFeedback(CocreatedScript script, Conditions conditions) {
        if (script == null) {
            return "";
        }
        int minutes = conditions.minutes();
        int chars = script.dialogueChars();
        int min = CocreateRules.minChars(minutes);
        int max = CocreateRules.maxChars(minutes);
        if (chars >= min && chars <= max) {
            return "";
        }
        return "\n\n[직전 시도 결과] 대사 텍스트 합계가 %d자여서 허용 %d~%d자를 %s. 이번에는 %d자 안팎(%d~%d자)으로 %s."
                .formatted(chars, min, max, chars < min ? "밑돌았다" : "넘었다", CocreateRules.targetChars(minutes), min, max,
                        chars < min ? "조금 더 길게 쓴다" : "더 짧게 줄여 쓴다");
    }

    private Revised reviseOnce(CocreatedScript script, Conditions target, String request) {
        String prompt = fill(prompts.get("revise.txt"), values(target))
                .replace("{cast_rule}", CocreateRules.castRule(target.characterCount(), target.myLines()))
                .replace("{script}", writeScript(script).toString())
                .replace("{request}", request);
        ScriptCocreateModel.Reply reply;
        try {
            reply = model.generate(prompt, maxTokens(target.minutes()));
        } catch (RuntimeException failure) {
            throw ApiException.external(502, "sample_script_revision_failed", failure);
        }
        JsonNode node = tree(reply.text());
        CocreatedScript revised = parse(node);
        CocreatedScript.Role was = script.mine();
        CocreatedScript.Role now = revised == null ? null : revised.mine();
        if (now == null || !Objects.equals(now.name(), was.name()) || !Objects.equals(now.gender(), was.gender())
                || !Objects.equals(now.ageBand(), was.ageBand())) {
            throw rejected("my role changed");
        }
        List<Issue> issues = CocreateRules.check(revised, target);
        if (issues.stream().anyMatch(Issue::structural)) {
            throw rejected("structure: " + issues);
        }
        revised = fix(revised, issues, target);
        List<Issue> after = CocreateRules.check(revised, target);
        if (after.stream().anyMatch(Issue::fatal)) {
            throw rejected("validation: " + after);
        }
        String note = node != null && node.path("note").isTextual() ? node.path("note").asText().strip() : "";
        return new Revised(revised, note.isEmpty() ? null : note);
    }

    private static ApiException rejected(String reason) {
        LOGGER.warning("sample script revision rejected: " + reason);
        return ApiException.unexpected(502, "sample_script_revision_failed", new IllegalStateException(reason));
    }

    static String request(Conditions target, Version current, String text, boolean resized) {
        if (!resized) {
            return text;
        }
        StringBuilder out = new StringBuilder("[설정 변경] 등장인물을 정확히 %d명으로 맞춘다. 내 배역 이름과 성별·나이대는 유지한다. "
                .formatted(target.characterCount()));
        if (target.characterCount() == 1) {
            out.append("상대역의 대사를 모두 없애고, 내 배역이 눈앞의 상대에게 직접 말하는 독백으로 바꾼다. 상대의 반응은 짧은 지문으로만 둔다. ");
        } else {
            out.append("원래 상대역을 가능한 한 유지한다. 늘릴 때 새 배역은 기존 사건에 자연스럽게 참여하고 대사 한 줄 이상을 준다. "
                    + "줄일 때는 내 배역을 없애지 말고 상대역을 줄인다. ");
        }
        out.append("핵심 관계·목표·감정·상황은 유지한다. 전체 분량은 약 %d분으로 맞춘다. ".formatted(target.minutes()))
                .append(CocreateRules.lengthRules(target.minutes(), target.characterCount()));
        if (target.minutes() != current.minutes()) {
            out.append(" 분량을 바꾸는 요청이므로 전체 대본을 재구성해도 된다. 단순히 같은 말을 늘여 쓰지 말고 새로운 정보와 시도를 추가한다.");
        }
        if (!text.isEmpty()) {
            out.append(" 추가 요청: ").append(text);
        }
        return out.toString();
    }

    /** 특정 줄 문제를 고치기 프롬프트로 한 번 고친다. 고치지 못하면 그대로 돌려준다. */
    private CocreatedScript fix(CocreatedScript script, List<Issue> issues, Conditions conditions) {
        Map<Integer, String> wrong = new LinkedHashMap<>();
        for (Issue issue : issues) {
            if (issue.index() != null) {
                wrong.merge(issue.index(), issue.why(), (a, b) -> a + ", " + b);
            }
        }
        if (wrong.isEmpty()) {
            return script;
        }
        StringBuilder list = new StringBuilder();
        wrong.forEach((index, why) -> list.append("- %d번 줄: %s / 현재: \"%s\"\n"
                .formatted(index, why, script.lines().get(index).text())));
        String prompt = prompts.get("fix.txt")
                .replace("{script}", writeScript(script).toString())
                .replace("{issues}", list.toString().strip())
                .replace("{line_len}", conditions.lineLen());
        JsonNode node;
        try {
            node = tree(model.generate(prompt, 4096).text());
        } catch (RuntimeException failure) {
            LOGGER.warning("sample script fix failed: " + failure.getMessage());
            return script;
        }
        CocreatedScript fixed = script;
        if (node != null) {
            for (JsonNode item : node.path("fixes")) {
                JsonNode index = item.path("index");
                JsonNode text = item.path("text");
                if (index.canConvertToInt() && wrong.containsKey(index.asInt()) && text.isTextual() && !text.asText().isBlank()) {
                    fixed = fixed.withText(index.asInt(), text.asText().strip());
                }
            }
        }
        return fixed;
    }

    private String generatePrompt(Conditions conditions) {
        String template = prompts.get(conditions.monologue() ? "generate-monologue.txt" : "generate.txt");
        return fill(template, values(conditions));
    }

    private static Map<String, String> values(Conditions c) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("experience", c.experience().label());
        values.put("actor", c.actor());
        values.put("purpose", c.purpose());
        values.put("emotion", c.emotion());
        values.put("situation", c.situation());
        values.put("direction", c.direction());
        values.put("character_count", String.valueOf(c.characterCount()));
        values.put("ending", c.ending().text());
        values.put("prop", c.prop().text());
        values.put("length_rules", CocreateRules.lengthRules(c.minutes(), c.characterCount()));
        values.put("my_lines", String.valueOf(c.myLines()));
        values.put("line_len", c.lineLen());
        values.put("characters_schema", CocreateRules.charactersSchema(c.characterCount()));
        return values;
    }

    static String fill(String template, Map<String, String> values) {
        String out = template;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            out = out.replace("{" + entry.getKey() + "}", entry.getValue());
        }
        return out;
    }

    private static int maxTokens(int minutes) {
        return minutes >= 10 ? 24_576 : 8_192;
    }

    private Conditions base(Request request) {
        boolean minor = request.age() != null && request.age() < 20;
        String emotion = blankOr(request.emotion(), CocreateRules.ANY_EMOTION)
                ? CocreateRules.EMOTIONS.get(Math.floorMod(random.applyAsInt(CocreateRules.EMOTIONS.size()), CocreateRules.EMOTIONS.size()))
                : request.emotion().strip();
        String situation = blankOr(request.situation(), CocreateRules.ANY_SITUATION)
                ? CocreateRules.SITUATIONS.get(Math.floorMod(random.applyAsInt(CocreateRules.SITUATIONS.size()), CocreateRules.SITUATIONS.size()))
                : request.situation().strip();
        String direction = request.direction() == null || request.direction().isBlank() ? "없음" : request.direction().strip();
        return new Conditions(request.experience() == null ? Experience.BEGINNER : request.experience(),
                actor(request.age(), request.gender()), purpose(request.goal()), minor, emotion, situation, direction,
                request.characterCount(), request.minutes(), CocreateRules.ENDINGS.getFirst(), CocreateRules.PROPS.getFirst(),
                CocreateRules.defaultMyLines(request.minutes(), request.characterCount()));
    }

    private static boolean blankOr(String value, String any) {
        return value == null || value.isBlank() || any.equals(value.strip());
    }

    static String actor(Integer age, String gender) {
        String band = age == null ? "" : Math.max(10, age / 10 * 10) + "대";
        String sex = "female".equals(gender) ? "여성" : "male".equals(gender) ? "남성" : "";
        String joined = (band + " " + sex).strip();
        return joined.isEmpty() ? "정하지 않음(장면에 맞게 정한다)" : joined;
    }

    static String purpose(String goal) {
        if ("audition".equals(goal)) {
            return "오디션·입시를 준비한다";
        }
        if ("professional".equals(goal)) {
            return "작품 속 연기를 완성하고 싶다";
        }
        return "취미로 연기를 즐기고 싶다";
    }

    private List<Conditions> recent(UUID userId) {
        List<Conditions> out = new ArrayList<>();
        for (String json : cocreations.recentConditions(userId, RECENT)) {
            try {
                out.add(readConditions(json));
            } catch (RuntimeException ignored) {
                // 옛 모양의 조건은 겹침 피하기에서 뺀다.
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- 보기·JSON

    private Row ready(UUID userId, UUID id) {
        Row row = cocreations.find(userId, id);
        if (row == null || !row.ready()) {
            throw new ApiException(404, "sample_script_not_found");
        }
        return row;
    }

    private View view(Row row, boolean created) {
        List<Version> versions = readVersions(row.versions());
        Version current = versions.get(row.currentVersion() - 1);
        Conditions conditions = readConditions(row.conditions());
        return new View(row.id(), row.currentVersion(), versions.size(), current.script(), current.minutes(),
                current.characterCount(), CocreateRules.estimatedSeconds(current.script()), conditions.emotion(),
                conditions.situation(), row.revisionsUsed(), Math.max(0, CocreateRules.FREE_REVISIONS - row.revisionsUsed()),
                current.note(), row.scriptId(), row.createdAt(), created);
    }

    private JsonNode tree(String text) {
        if (text == null) {
            return null;
        }
        String body = text.strip();
        if (body.startsWith("```")) {
            body = body.replaceFirst("^```(json)?", "").replaceFirst("```$", "").strip();
        }
        try {
            JsonNode node = mapper.readTree(body);
            return node != null && node.isObject() ? node : null;
        } catch (JsonProcessingException failure) {
            return null;
        }
    }

    CocreatedScript parse(String text) {
        return parse(tree(text));
    }

    /** 모델 답을 대본으로 읽는다. 모양이 아니면 {@code null}(검사가 구조 오류로 본다). */
    static CocreatedScript parse(JsonNode node) {
        if (node == null || !node.path("characters").isArray() || !node.path("lines").isArray()) {
            return null;
        }
        List<CocreatedScript.Role> roles = new ArrayList<>();
        for (JsonNode role : node.path("characters")) {
            roles.add(new CocreatedScript.Role(text(role, "name"), lower(role, "gender"), lower(role, "age_band"),
                    role.path("mine").asBoolean(false)));
        }
        List<CocreatedScript.Line> lines = new ArrayList<>();
        for (JsonNode line : node.path("lines")) {
            JsonNode character = line.path("character");
            lines.add(new CocreatedScript.Line(text(line, "kind"),
                    character.isTextual() && !character.asText().isBlank() ? character.asText().strip() : null,
                    text(line, "text")));
        }
        JsonNode design = node.path("design");
        CocreatedScript.Design parsed = design.isObject()
                ? new CocreatedScript.Design(orEmpty(design, "relation"), orEmpty(design, "incident"), orEmpty(design, "prop"),
                        orEmpty(design, "my_objective"), orEmpty(design, "other_reason"), list(design.path("tactics")),
                        list(design.path("beats")), orEmpty(design, "turn_action"), orEmpty(design, "ending_type"))
                : CocreatedScript.Design.EMPTY;
        return new CocreatedScript(parsed, text(node, "title"), orEmpty(node, "scene"), roles, lines);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() ? value.asText().strip() : null;
    }

    private static String lower(JsonNode node, String field) {
        String value = text(node, field);
        return value == null ? null : value.toLowerCase(java.util.Locale.ROOT);
    }

    private static String orEmpty(JsonNode node, String field) {
        String value = text(node, field);
        return value == null ? "" : value;
    }

    private static List<String> list(JsonNode node) {
        List<String> out = new ArrayList<>();
        for (JsonNode item : node) {
            if (item.isTextual()) {
                out.add(item.asText());
            }
        }
        return out;
    }

    ObjectNode writeScript(CocreatedScript script) {
        ObjectNode node = mapper.createObjectNode();
        ObjectNode design = node.putObject("design");
        CocreatedScript.Design d = script.design();
        design.put("relation", d.relation());
        design.put("incident", d.incident());
        design.put("prop", d.prop());
        design.put("my_objective", d.myObjective());
        design.put("other_reason", d.otherReason());
        d.tactics().forEach(design.putArray("tactics")::add);
        d.beats().forEach(design.putArray("beats")::add);
        design.put("turn_action", d.turnAction());
        design.put("ending_type", d.endingType());
        node.put("title", script.title());
        node.put("scene", script.scene());
        ArrayNode characters = node.putArray("characters");
        for (CocreatedScript.Role role : script.characters()) {
            characters.addObject().put("name", role.name()).put("gender", role.gender()).put("age_band", role.ageBand())
                    .put("mine", role.mine());
        }
        ArrayNode lines = node.putArray("lines");
        for (CocreatedScript.Line line : script.lines()) {
            lines.addObject().put("kind", line.kind()).put("character", line.character()).put("text", line.text());
        }
        return node;
    }

    String writeVersions(List<Version> versions) {
        ArrayNode array = mapper.createArrayNode();
        for (Version version : versions) {
            ObjectNode item = array.addObject();
            item.set("script", writeScript(version.script()));
            item.put("character_count", version.characterCount());
            item.put("minutes", version.minutes());
            item.put("my_lines", version.myLines());
            item.put("note", version.note());
        }
        return array.toString();
    }

    List<Version> readVersions(String json) {
        JsonNode array = readJson(json);
        List<Version> out = new ArrayList<>();
        for (JsonNode item : array) {
            JsonNode note = item.path("note");
            out.add(new Version(parse(item.path("script")), item.path("character_count").asInt(),
                    item.path("minutes").asInt(), item.path("my_lines").asInt(), note.isTextual() ? note.asText() : null));
        }
        return out;
    }

    String writeConditions(Conditions c) {
        ObjectNode node = mapper.createObjectNode();
        node.put("experience", c.experience().name());
        node.put("actor", c.actor());
        node.put("purpose", c.purpose());
        node.put("minor", c.minor());
        node.put("emotion", c.emotion());
        node.put("situation", c.situation());
        node.put("direction", c.direction());
        node.put("ending", c.ending().name());
        node.put("prop", c.prop().name());
        return node.toString();
    }

    /** 배역 수·분량·내 대사 수는 버전에서 다시 정한다 — 여기서는 1명·1분으로 둔다. */
    Conditions readConditions(String json) {
        JsonNode node = readJson(json);
        return new Conditions(Experience.valueOf(node.path("experience").asText()), node.path("actor").asText(),
                node.path("purpose").asText(), node.path("minor").asBoolean(), node.path("emotion").asText(),
                node.path("situation").asText(), node.path("direction").asText(), 1, 1,
                slot(CocreateRules.ENDINGS, node.path("ending").asText()), slot(CocreateRules.PROPS, node.path("prop").asText()),
                CocreateRules.defaultMyLines(1, 1));
    }

    private static Slot slot(List<Slot> slots, String name) {
        return slots.stream().filter(slot -> slot.name().equals(name)).findFirst()
                .orElseThrow(() -> new IllegalStateException("unknown slot " + name));
    }

    private JsonNode readJson(String json) {
        try {
            return mapper.readTree(json);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("broken sample script record", failure);
        }
    }

    private static String load(String name) {
        try (InputStream input = ScriptCocreateService.class.getResourceAsStream(PROMPT_DIR + name)) {
            if (input == null) {
                throw new IllegalStateException("sample script prompt is missing: " + name);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }
}
