package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * V61 이 넣은 예시 대본 3편의 미리 나눈 결과(draft)가 원문(raw_text)의 줄과 맞는지 본다 — DB 없이 마이그레이션 글을 읽는다.
 * 원문은 앱 {@code apps/mobile/lib/reading/sample.ts} 와 글자 그대로 같아야 한다(같은 글 판정이 해시로 된다).
 */
class ReadingExampleDraftTest {
    private static final Pattern ROW = Pattern.compile(
            "'([a-z]+)', '([^']*)', '([^']*)', (\\d+), true,\\s*\\$raw\\$(.*?)\\$raw\\$,\\s*\\$draft\\$(.*?)\\$draft\\$::jsonb", Pattern.DOTALL);

    @Test
    @DisplayName("V61 rooftop: 원문은 옛 길의 예시 글(SampleScript)과 같고 나눈 줄도 SampleScript 와 같다")
    void rooftopMatchesTheOldSamplePath() throws IOException {
        ReadingExample rooftop = examples().get("rooftop");
        assertThat(rooftop.rawText()).isEqualTo(SampleScript.TEXT);
        ScriptDraft old = SampleScript.draft(null, SampleScript.TEXT, "sample");
        assertThat(rooftop.draft().characterNames()).isEqualTo(old.characterNames());
        assertThat(rooftop.draft().lines()).isEqualTo(old.lines());
        assertThat(rooftop.draft().title()).isEqualTo("옥상, 밤");
    }

    @Test
    @DisplayName("V61 cafe: 17줄(지문 2·대사 15), 배역 서연 8·준호 7, 줄마다 원문의 「이름: 대사」와 같다")
    void cafeMatchesItsRawText() throws IOException {
        ReadingExample cafe = examples().get("cafe");
        assertThat(cafe.title()).isEqualTo("카페, 헤어지자는 말");
        assertThat(cafe.summary()).isEqualTo("서연 · 준호 · 2인 대화");
        assertThat(cafe.characters()).containsExactly("서연", "준호");
        assertThat(cafe.lines()).hasSize(17);
        assertThat(cafe.dialogueCount()).isEqualTo(15);
        assertThat(cafe.lines().stream().filter(line -> Integer.valueOf(0).equals(line.character())).count()).isEqualTo(8);
        assertThat(cafe.lines().stream().filter(line -> Integer.valueOf(1).equals(line.character())).count()).isEqualTo(7);
        assertThat(rendered(cafe)).isEqualTo(bodyLines(cafe.rawText()));
        assertThat(ScriptRules.check(cafe.draft())).isNull();
    }

    @Test
    @DisplayName("V61 minji: 지문 1줄 + 민지의 대사 7문장, 문장을 이으면 원문 문단과 같다")
    void minjiMatchesItsRawText() throws IOException {
        ReadingExample minji = examples().get("minji");
        assertThat(minji.characters()).containsExactly("민지");
        assertThat(minji.lines()).hasSize(8);
        assertThat(minji.dialogueCount()).isEqualTo(7);
        List<String> body = bodyLines(minji.rawText());
        assertThat(body).hasSize(2);
        assertThat(minji.lines().getFirst()).isEqualTo(new ReadingExample.Line("direction", null, body.getFirst()));
        String joined = String.join(" ", minji.lines().subList(1, 8).stream().map(ReadingExample.Line::text).toList());
        assertThat(joined).isEqualTo(body.get(1));
        assertThat(minji.lines().subList(1, 8)).extracting(ReadingExample.Line::text)
                .isEqualTo(Monologue.sentences(body.get(1)));
        assertThat(ScriptRules.check(minji.draft())).isNull();
        assertThat(minji.draft().unnamedCast()).isFalse();
    }

    @Test
    @DisplayName("V61: 3편 모두 원문 첫 줄이 제목이고, 대본 저장 규칙을 통과하며, 미리보기는 앞 5줄(지문은 speaker null)")
    void everyExampleIsSavable() throws IOException {
        Map<String, ReadingExample> examples = examples();
        assertThat(examples.keySet()).containsExactly("rooftop", "cafe", "minji");
        for (ReadingExample example : examples.values()) {
            assertThat(example.rawText().split("\n")[0]).isEqualTo(example.title());
            assertThat(example.draft().source()).isEqualTo("sample");
            assertThat(ScriptRules.check(example.draft())).as(example.id()).isNull();
            assertThat(example.preview()).hasSize(5);
            assertThat(example.preview().getFirst()).isEqualTo(new ReadingExample.Preview(null, example.lines().getFirst().text()));
        }
        assertThat(examples.get("cafe").preview().get(1)).isEqualTo(new ReadingExample.Preview("서연", "일찍 왔네."));
    }

    /** 원문의 제목 다음 줄 가운데 빈 줄이 아닌 것. */
    private static List<String> bodyLines(String rawText) {
        List<String> lines = new ArrayList<>();
        String[] all = rawText.split("\n");
        for (int index = 1; index < all.length; index++) {
            if (!all[index].isBlank()) {
                lines.add(all[index].strip());
            }
        }
        return lines;
    }

    /** 나눈 줄을 원문 꼴(지문은 그대로, 대사는 「이름: 대사」)로 되돌린다. */
    private static List<String> rendered(ReadingExample example) {
        return example.lines().stream()
                .map(line -> line.character() == null ? line.text() : example.characters().get(line.character()) + ": " + line.text())
                .toList();
    }

    private static Map<String, ReadingExample> examples() throws IOException {
        String sql;
        try (InputStream in = ReadingExampleDraftTest.class.getResourceAsStream("/db/migration/V61__reading_examples.sql")) {
            assertThat(in).isNotNull();
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        ObjectMapper mapper = new ObjectMapper();
        Map<String, ReadingExample> examples = new LinkedHashMap<>();
        Matcher matcher = ROW.matcher(sql);
        while (matcher.find()) {
            JsonNode draft = mapper.readTree(matcher.group(6));
            List<String> characters = new ArrayList<>();
            draft.path("characters").forEach(name -> characters.add(name.textValue()));
            List<ReadingExample.Line> lines = new ArrayList<>();
            draft.path("lines").forEach(line -> lines.add(new ReadingExample.Line(line.path("kind").textValue(),
                    line.path("character").isNull() ? null : line.path("character").intValue(), line.path("text").textValue())));
            examples.put(matcher.group(1), new ReadingExample(matcher.group(1), matcher.group(2), matcher.group(3),
                    matcher.group(5), characters, lines));
        }
        return examples;
    }
}
