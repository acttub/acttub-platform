package com.acttub.actingapi.feature.reading.app;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.GZIPInputStream;

import com.acttub.actingapi.feature.reading.domain.NumberedLine;
import com.acttub.actingapi.feature.reading.domain.RuleSplit;
import com.acttub.actingapi.feature.reading.domain.SplitResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import com.acttub.actingapi.platform.json.LenientJson;

/**
 * 규칙 나누기(SOMA-1090)의 하이브리드·풀규칙과 지금 운영 AI 결과를 SOMA-663 정답 셋(팀 위키, gpt-6.1-sol·Opus 대조로 만든 정답 지점)으로
 * 같이 채점한다. 정답 지점은 대표·문제 구간만 골라 둔 것이라 줄 전체 정확도가 아니다 — 같은 지점에서 세 방식을 나란히 견준다.
 *
 * <p>입력(전부 로컬, 저장소 밖 — 정답 지점에 실사용자 대본 줄이 들어 있다): {@code ACTTUB_SPLIT_GOLD}(gold-reference.json, 옆에
 * reference-adjudications.json 이 있으면 정책 의존 지점을 뺀다), {@code ACTTUB_SPLIT_GOLD_MATCH}(정답 index → 운영 대본 id 앞
 * 8자리 JSON), {@code ACTTUB_SPLIT_CORPUS}({@link ScriptSplitRuleCorpusTest} 와 같은 운영 대본 JSONL.gz). 글은 찍지 않는다.
 */
@EnabledIfEnvironmentVariable(named = "ACTTUB_SPLIT_GOLD", matches = ".+")
class ScriptSplitRuleGoldTest {
    private static final Set<String> NONE_KINDS = Set.of("ignore", "cast", "title");

    /** 지점 수와 방식별로 맞은 지점(종류+화자, 종류만). */
    private static final class Score {
        int anchors;
        int ai;
        int aiKind;
        int hybrid;
        int hybridKind;
        int full;
        int fullKind;
        int ruleAnswered;
        int rule;
        int aiOnRuleAnswered;
    }

    @Test
    void scoreRulesAndCurrentAiAgainstTheGoldAnchors() throws IOException {
        ObjectMapper json = new ObjectMapper();
        Path goldPath = Path.of(System.getenv("ACTTUB_SPLIT_GOLD"));
        JsonNode gold = json.readTree(goldPath.toFile());
        JsonNode match = json.readTree(Path.of(System.getenv("ACTTUB_SPLIT_GOLD_MATCH")).toFile());
        Set<String> policy = new HashSet<>();
        Path adjudications = goldPath.resolveSibling("reference-adjudications.json");
        if (Files.exists(adjudications)) {
            json.readTree(adjudications.toFile()).path("policyDependentAnchors")
                    .forEach(a -> policy.add(LenientJson.asInt(a.path("index")) + ":" + LenientJson.asInt(a.path("sourceLine"))));
        }
        Map<String, JsonNode> corpus = corpus(json, match);

        Map<String, Score> scores = new TreeMap<>();
        Map<String, Integer> misses = new TreeMap<>();
        int scripts = 0;
        for (JsonNode item : gold) {
            String id = LenientJson.asText(match.path(LenientJson.asText(item.path("index"))), null);
            JsonNode script = id == null ? null : corpus.get(id);
            if (script == null) continue;
            scripts++;
            List<NumberedLine> numbered = NumberedLine.of(LenientJson.asText(script.path("raw"), ""));
            RuleSplit.Result rule = RuleSplit.of(numbered);
            RuleSplit.Result full = RuleSplit.full(numbered);
            List<String> storedCast = new ArrayList<>();
            script.path("chars").forEach(c -> storedCast.add(LenientJson.asText(c)));
            Map<Integer, String> ai = ScriptSplitRuleCorpusTest.storedLabels(numbered, script.path("lines"), storedCast);
            String bucket = rule.confident() ? "규칙 맡음 " + rule.format() : "규칙 못 맡음";
            for (JsonNode anchor : item.path("anchors")) {
                int no = LenientJson.asInt(anchor.path("sourceLine"));
                if (policy.contains(LenientJson.asInt(item.path("index")) + ":" + no)) continue;
                Gold expected = Gold.of(anchor);
                boolean[] aiOk = expected.check(ai.getOrDefault(no, "none"));
                boolean[] fullOk = expected.check(label(full.rows().get(no)));
                SplitResponse.Row ruleRow = rule.confident() ? rule.rows().get(no) : null;
                boolean[] hybridOk = ruleRow == null ? aiOk : expected.check(label(ruleRow));
                if (!fullOk[0]) {
                    misses.merge("풀규칙 " + (fullOk[1] ? "화자" : "종류") + " 틀림" + (aiOk[0] ? " · AI는 맞음" : " · AI도 틀림"), 1, Integer::sum);
                }
                for (String key : List.of(bucket, "전체")) {
                    Score s = scores.computeIfAbsent(key, k -> new Score());
                    s.anchors++;
                    if (aiOk[0]) s.ai++;
                    if (aiOk[1]) s.aiKind++;
                    if (hybridOk[0]) s.hybrid++;
                    if (hybridOk[1]) s.hybridKind++;
                    if (fullOk[0]) s.full++;
                    if (fullOk[1]) s.fullKind++;
                    if (ruleRow != null) {
                        s.ruleAnswered++;
                        if (hybridOk[0]) s.rule++;
                        if (aiOk[0]) s.aiOnRuleAnswered++;
                    }
                }
            }
        }
        System.out.printf("[gold] 운영 대본과 이은 정답 대본 %d편%n", scripts);
        System.out.println("[gold] 묶음  지점 | 지금AI(종류+화자/종류) | 하이브리드 | 풀규칙 | 규칙이 답한 지점: 수 규칙 같은지점AI");
        scores.forEach((key, s) -> System.out.printf("[gold] %-18s %4d | %5.1f %5.1f | %5.1f %5.1f | %5.1f %5.1f | %4d %5.1f %5.1f%n", key,
                s.anchors, pct(s.ai, s.anchors), pct(s.aiKind, s.anchors), pct(s.hybrid, s.anchors), pct(s.hybridKind, s.anchors),
                pct(s.full, s.anchors), pct(s.fullKind, s.anchors), s.ruleAnswered, pct(s.rule, s.ruleAnswered), pct(s.aiOnRuleAnswered, s.ruleAnswered)));
        misses.forEach((k, v) -> System.out.printf("[gold-miss] %-28s %d%n", k, v));
    }

    /** 정답 지점 하나 — 종류(제목·소개·무시는 하나로)와, 대사면 화자(허용 표기 포함). 여러 발화·동시 말하기 지점은 종류만 본다. */
    private record Gold(String kind, List<String> speakers) {
        static Gold of(JsonNode anchor) {
            String kind = LenientJson.asText(anchor.path("expectedKind"));
            kind = NONE_KINDS.contains(kind) ? "none" : kind;
            List<String> speakers = new ArrayList<>();
            if (kind.equals("dialogue") && anchor.hasNonNull("expectedSpeaker") && !anchor.has("expectedSegments") && !anchor.has("mode")) {
                speakers.add(LenientJson.asText(anchor.path("expectedSpeaker")));
                anchor.path("sourceSpeakerAliases").forEach(a -> speakers.add(LenientJson.asText(a)));
            }
            return new Gold(kind, speakers);
        }

        /** [종류+화자 맞음, 종류 맞음]. */
        boolean[] check(String label) {
            String[] parts = label.split("\\|", -1);
            boolean kindOk = parts[0].equals(kind);
            return new boolean[] {kindOk && (speakers.isEmpty() || sameSpeaker(parts.length > 1 ? parts[1] : "")), kindOk};
        }

        /** 표기 차이는 봐준다 — 공백 무시 같음, 또는 두 글자 이상이 서로 포함(「은서」↔「강은서」). 세 방식에 똑같이 쓴다. */
        private boolean sameSpeaker(String got) {
            String g = ScriptSplitRuleCorpusTest.norm(got);
            if (g.isEmpty()) return false;
            for (String e : speakers) {
                String n = ScriptSplitRuleCorpusTest.norm(e);
                if (n.equals(g) || n.length() >= 2 && g.length() >= 2 && (n.contains(g) || g.contains(n))) return true;
            }
            return false;
        }
    }

    private static String label(SplitResponse.Row row) {
        return row == null ? "none" : ScriptSplitRuleCorpusTest.ruleLabel(row);
    }

    private static Map<String, JsonNode> corpus(ObjectMapper json, JsonNode match) throws IOException {
        Set<String> wanted = new HashSet<>();
        match.forEach(id -> wanted.add(LenientJson.asText(id)));
        Map<String, JsonNode> corpus = new HashMap<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new GZIPInputStream(Files.newInputStream(Path.of(System.getenv("ACTTUB_SPLIT_CORPUS")))), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("{")) continue;
                JsonNode script = json.readTree(line);
                if (wanted.contains(LenientJson.asText(script.path("id")))) corpus.put(LenientJson.asText(script.path("id")), script);
            }
        }
        return corpus;
    }

    private static double pct(long a, long b) {
        return b == 0 ? 0 : 100.0 * a / b;
    }
}
