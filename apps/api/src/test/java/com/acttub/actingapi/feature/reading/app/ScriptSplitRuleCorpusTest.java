package com.acttub.actingapi.feature.reading.app;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

import com.acttub.actingapi.feature.reading.domain.NumberedLine;
import com.acttub.actingapi.feature.reading.domain.RuleSplit;
import com.acttub.actingapi.feature.reading.domain.SplitResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import com.acttub.actingapi.platform.json.LenientJson;

/**
 * 운영 대본 묶음으로 규칙 나누기(SOMA-1090)를 저장된 AI 나누기 결과와 견준다. {@code ACTTUB_SPLIT_CORPUS} 에 뽑아 온 파일이 있을 때만
 * 돈다 — 운영 DB 에서 읽기 전용으로 대본마다 JSON 한 줄({@code id}·{@code raw} 원문·{@code chars} 배역·{@code lines} [종류, 배역, 글])을
 * 뽑은 것(.gz 가능)이고, 운영 글은 저장소에 두지 않는다.
 *
 * <p>원문 줄마다 저장된 AI 결과의 판정을 찾아(글 포함 정렬) 규칙 답과 종류·화자를 비교한다. 저장된 AI 결과도 틀린 데가 있으니 일치율은
 * 「AI와 같은 정도」이지 정확도가 아니다(정확도는 {@link ScriptSplitRuleGoldTest}). 판정은 하지 않고 표만 남긴다. 대본마다의 숫자는
 * {@code ACTTUB_SPLIT_CORPUS_OUT}(기본 corpus 옆 {@code rule-eval.tsv})에 쓴다 — 글은 쓰지 않는다.
 */
@EnabledIfEnvironmentVariable(named = "ACTTUB_SPLIT_CORPUS", matches = ".+")
class ScriptSplitRuleCorpusTest {
    private static final Pattern NOISE = Pattern.compile("[\\s\\u0000\\u200B-\\u200D\\uFEFF\\u2060\\u3164\\uFFA0\\u115F\\u1160\\u00A0\\u2007\\u202F]+");
    private static final String NONE = "none";

    static String norm(String s) {
        return NOISE.matcher(Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFC)).replaceAll("");
    }

    /**
     * 원문 줄마다 저장된 AI 결과의 판정을 찾는다 — 저장 줄은 원문 줄을 이어 붙이고 머리를 뗀 글이라, 원문 줄(또는 머리를 뗀 나머지, 괄호를
     * 뺀 나머지)이 들어 있는 저장 줄을 순서대로 찾는다. 못 찾은 줄은 저장되지 않은 줄(제목·소개·무시)이다. 반환: 원문 줄 번호 → "종류|배역".
     */
    static Map<Integer, String> storedLabels(List<NumberedLine> lines, JsonNode stored, List<String> storedCast) {
        List<String> kinds = new ArrayList<>();
        List<String> speakers = new ArrayList<>();
        List<String> texts = new ArrayList<>();
        for (JsonNode l : stored) {
            kinds.add(LenientJson.asText(l.get(0)));
            speakers.add(norm(LenientJson.asText(l.get(1))));
            texts.add(norm(LenientJson.asText(l.get(2))));
        }
        Set<String> castNorm = new HashSet<>();
        storedCast.forEach(c -> castNorm.add(norm(c)));
        Map<Integer, String> labels = new HashMap<>();
        int pointer = 0;
        for (NumberedLine line : lines) {
            String t = norm(line.text());
            if (t.isEmpty()) continue;
            String label = NONE;
            if (!castNorm.contains(t)) {
                for (int k = pointer; k < Math.min(texts.size(), pointer + 12); k++) {
                    String body = t;
                    String speaker = speakers.get(k);
                    if (!speaker.isEmpty()) {
                        // 머리 모양(「이름:」「[이름]」「(이름)」「이름.」「이름⇥」)을 떼고 본다
                        String opened = body.replaceFirst("^[\\[(（<【]", "");
                        if (opened.startsWith(speaker)) {
                            body = opened.substring(speaker.length()).replaceFirst("^[\\])）>】]?[:：.;\\-–—]*", "");
                        }
                    }
                    String s = texts.get(k);
                    // 괄호 지문은 따로 떼어 저장되기도 한다 — 괄호를 뺀 나머지로도 본다
                    String bare = body.replaceAll("[(（][^)）]*[)）]", "");
                    boolean hit = !body.isEmpty() && (s.equals(body) || body.length() >= 2 && s.contains(body)
                            || t.length() >= 2 && s.contains(t) || bare.length() >= 4 && s.contains(bare));
                    if (hit) {
                        label = kinds.get(k) + "|" + ("dialogue".equals(kinds.get(k)) ? speaker : "");
                        pointer = k;
                        break;
                    }
                }
            }
            labels.put(line.no(), label);
        }
        return labels;
    }

    static String ruleLabel(SplitResponse.Row row) {
        return switch (row.kind()) {
            case DIALOGUE -> "dialogue|" + norm(row.speaker());
            case DIRECTION -> "direction|";
            case SCENE -> "scene|";
            default -> NONE;
        };
    }

    private static String kind(String label) {
        return label.split("\\|", -1)[0];
    }

    /** 글 있는 줄·규칙이 답한 줄·AI와 같은 줄(종류+화자)·종류만 같은 줄. */
    private static final class Lines {
        long content;
        long answered;
        long same;
        long sameKind;

        void add(Lines o) {
            content += o.content;
            answered += o.answered;
            same += o.same;
            sameKind += o.sameKind;
        }
    }

    private static Lines compare(RuleSplit.Result result, Map<Integer, String> want) {
        Lines lines = new Lines();
        for (Map.Entry<Integer, String> e : want.entrySet()) {
            lines.content++;
            SplitResponse.Row row = result.rows().get(e.getKey());
            if (row == null) continue;
            lines.answered++;
            String got = ruleLabel(row);
            if (got.equals(e.getValue())) lines.same++;
            if (kind(got).equals(kind(e.getValue()))) lines.sameKind++;
        }
        return lines;
    }

    @Test
    void compareRulesWithStoredSplits() throws IOException {
        Path corpus = Path.of(System.getenv("ACTTUB_SPLIT_CORPUS"));
        String outEnv = System.getenv("ACTTUB_SPLIT_CORPUS_OUT");
        Path out = outEnv == null || outEnv.isBlank() ? corpus.resolveSibling("rule-eval.tsv") : Path.of(outEnv);
        ObjectMapper json = new ObjectMapper();
        Map<String, Lines> hybrid = new TreeMap<>();
        Map<String, Lines> bands = new TreeMap<>();
        Map<String, Lines> full = new TreeMap<>();
        Map<String, Integer> fullScripts = new TreeMap<>();
        int scripts = 0;
        int confident = 0;
        long allLines = 0;
        long confidentLines = 0;
        try (BufferedReader reader = open(corpus); PrintWriter rows = new PrintWriter(Files.newBufferedWriter(out, StandardCharsets.UTF_8))) {
            rows.println("id\thybrid_format\tconfident\tlines\trule_answered\trule_same\tfull_same\tcontent");
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("{")) continue;
                JsonNode script = json.readTree(line);
                List<String> storedCast = new ArrayList<>();
                script.path("chars").forEach(c -> storedCast.add(LenientJson.asText(c)));
                List<NumberedLine> numbered = NumberedLine.of(LenientJson.asText(script.path("raw"), ""));
                Map<Integer, String> want = storedLabels(numbered, script.path("lines"), storedCast);

                RuleSplit.Result rule = RuleSplit.of(numbered);
                String format = rule.confident() ? rule.format().name() : "NOT_CONFIDENT";
                scripts++;
                allLines += rule.total();
                Lines ruleLines = compare(rule, want);
                if (rule.confident()) {
                    confident++;
                    confidentLines += rule.total();
                    hybrid.computeIfAbsent(format, f -> new Lines()).add(ruleLines);
                }
                if (!rule.roster().isEmpty() && rule.dialogues() >= 3) {
                    double c = rule.coverage();
                    String band = c >= 0.6 ? "≥0.6" : c >= 0.5 ? "0.5~0.6" : c >= 0.4 ? "0.4~0.5" : c >= 0.3 ? "0.3~0.4" : "<0.3";
                    bands.computeIfAbsent(band, f -> new Lines()).add(ruleLines);
                }

                Lines fullLines = compare(RuleSplit.full(numbered), want);
                full.computeIfAbsent(format, f -> new Lines()).add(fullLines);
                if (fullLines.content > 0) {
                    double p = (double) fullLines.same / fullLines.content;
                    fullScripts.merge(p >= 0.95 ? "1 ≥95%" : p >= 0.9 ? "2 90~95%" : p >= 0.8 ? "3 80~90%" : p >= 0.6 ? "4 60~80%" : "5 <60%", 1, Integer::sum);
                }
                rows.printf("%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d%n", LenientJson.asText(script.path("id")), format, rule.confident(), rule.total(),
                        ruleLines.answered, ruleLines.same, fullLines.same, fullLines.content);
            }
        }
        System.out.printf("[rule-corpus] 대본 %d편 · 규칙이 맡는 대본 %d편 · 모델 첫 판·줄 검토를 건너뛰는 줄 %.1f%%%n", scripts, confident,
                pct(confidentLines, allLines));
        System.out.println("[rule-hybrid] 규칙이 맡는 대본: 형식  글줄  규칙답%  AI와 같음(종류+화자)  (종류만)");
        Lines hybridAll = new Lines();
        hybrid.forEach((f, s) -> { print("rule-hybrid", f, s, true); hybridAll.add(s); });
        print("rule-hybrid", "전체", hybridAll, true);
        System.out.println("[rule-band] 규칙 답 비율 구간별(배역 있고 대사 3줄 이상인 대본 전부): 구간  글줄  규칙답%  AI와 같음(종류+화자)  (종류만)");
        bands.forEach((b, s) -> print("rule-band", b, s, true));
        System.out.println("[rule-full] 풀규칙(모든 줄 규칙): 하이브리드 형식  글줄  AI와 같음(종류+화자)  (종류만)");
        Lines fullAll = new Lines();
        full.forEach((f, s) -> { print("rule-full", f, s, false); fullAll.add(s); });
        print("rule-full", "전체", fullAll, false);
        fullScripts.forEach((k, v) -> System.out.printf("[rule-full-dist] %-10s %d편%n", k.substring(2), v));
        System.out.printf("[rule-corpus] 대본별 결과: %s%n", out);
    }

    private static void print(String tag, String key, Lines s, boolean ofAnswered) {
        long base = ofAnswered ? s.answered : s.content;
        System.out.printf("[%s] %-14s %8d %7.1f %8.1f %8.1f%n", tag, key, s.content, pct(s.answered, s.content), pct(s.same, base), pct(s.sameKind, base));
    }

    private static double pct(long a, long b) {
        return b == 0 ? 0 : 100.0 * a / b;
    }

    private static BufferedReader open(Path path) throws IOException {
        InputStream in = Files.newInputStream(path);
        if (path.getFileName().toString().endsWith(".gz")) {
            in = new GZIPInputStream(in);
        }
        return new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
    }
}
