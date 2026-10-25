package com.acttub.actingapi.feature.reading.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.reading.domain.ReadingExampleAudio;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** {@code reading_examples.audio}(V62) 글 풀기와, V62 가 넣은 세 예시의 값. */
class ReadingExampleAudioJsonTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    @DisplayName("audio 풀기: prefix·voices(순서 유지)·lines(seq·key·duration_ms)")
    void parses() {
        ReadingExampleAudio audio = ReadingExampleAudioJson.parse(MAPPER, """
                {"prefix":"reading-examples/v1/cafe/","voices":{"서연":"F1","준호":"M1"},
                 "lines":[{"seq":2,"key":"2.m4a","duration_ms":1532},{"seq":3,"key":"3.m4a","duration_ms":2229}]}""");
        assertThat(audio.prefix()).isEqualTo("reading-examples/v1/cafe/");
        assertThat(audio.voices()).containsExactly(Map.entry("서연", "F1"), Map.entry("준호", "M1"));
        assertThat(audio.lines()).containsExactly(new ReadingExampleAudio.Line(2, "2.m4a", 1532),
                new ReadingExampleAudio.Line(3, "3.m4a", 2229));
    }

    @Test
    @DisplayName("audio 풀기: NULL 칸은 null(음성 없음), 독백의 빈 값은 prefix 없이 빈 voices·lines")
    void nullAndEmpty() {
        assertThat(ReadingExampleAudioJson.parse(MAPPER, null)).isNull();
        ReadingExampleAudio empty = ReadingExampleAudioJson.parse(MAPPER, "{\"voices\":{},\"lines\":[]}");
        assertThat(empty.prefix()).isEmpty();
        assertThat(empty.voices()).isEmpty();
        assertThat(empty.lines()).isEmpty();
    }

    @Test
    @DisplayName("audio 풀기: 모양이 틀리면 IllegalArgumentException — JSON 아님·칸 없음·숫자 아닌 seq·끝 / 없는 prefix·.. 든 key")
    void rejectsMalformed() {
        for (String bad : List.of(
                "not json",
                "[]",
                "{\"voices\":{}}",
                "{\"lines\":[]}",
                "{\"voices\":{\"a\":1},\"lines\":[]}",
                "{\"prefix\":\"p/\",\"voices\":{},\"lines\":[{\"seq\":\"2\",\"key\":\"2.m4a\",\"duration_ms\":1}]}",
                "{\"prefix\":\"p/\",\"voices\":{},\"lines\":[{\"seq\":2,\"duration_ms\":1}]}",
                "{\"prefix\":\"p\",\"voices\":{},\"lines\":[{\"seq\":2,\"key\":\"2.m4a\",\"duration_ms\":1}]}",
                "{\"voices\":{},\"lines\":[{\"seq\":2,\"key\":\"2.m4a\",\"duration_ms\":1}]}",
                "{\"prefix\":\"p/\",\"voices\":{},\"lines\":[{\"seq\":0,\"key\":\"2.m4a\",\"duration_ms\":1}]}",
                "{\"prefix\":\"p/\",\"voices\":{},\"lines\":[{\"seq\":2,\"key\":\"../x.m4a\",\"duration_ms\":1}]}",
                "{\"prefix\":\"p/\",\"voices\":{},\"lines\":[{\"seq\":2,\"key\":\"2.m4a\",\"duration_ms\":-1}]}")) {
            assertThatThrownBy(() -> ReadingExampleAudioJson.parse(MAPPER, bad)).as(bad).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    @DisplayName("V62: rooftop·cafe 는 대사 15줄 모두 음성(윤서·서연 F1, 태오·준호 M1, 지문 자리 1·10/14 없음), minji 는 빈 값")
    void v62Values() throws IOException {
        Map<String, ReadingExampleAudio> audio = v62();
        assertThat(audio).containsOnlyKeys("rooftop", "cafe", "minji");
        ReadingExampleAudio rooftop = audio.get("rooftop");
        assertThat(rooftop.prefix()).isEqualTo("reading-examples/v1/rooftop/");
        assertThat(rooftop.voices()).containsExactly(Map.entry("윤서", "F1"), Map.entry("태오", "M1"));
        assertThat(rooftop.lines()).extracting(ReadingExampleAudio.Line::seq)
                .containsExactly(2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17);
        ReadingExampleAudio cafe = audio.get("cafe");
        assertThat(cafe.voices()).containsExactly(Map.entry("서연", "F1"), Map.entry("준호", "M1"));
        assertThat(cafe.lines()).extracting(ReadingExampleAudio.Line::seq)
                .containsExactly(2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17);
        for (ReadingExampleAudio example : List.of(rooftop, cafe)) {
            assertThat(example.lines()).allSatisfy(line -> {
                assertThat(line.key()).isEqualTo(line.seq() + ".m4a");
                assertThat(line.durationMs()).isBetween(500, 10_000);
            });
        }
        assertThat(audio.get("minji").lines()).isEmpty();
        assertThat(audio.get("minji").voices()).isEmpty();
    }

    private static Map<String, ReadingExampleAudio> v62() throws IOException {
        String sql;
        try (InputStream in = ReadingExampleAudioJsonTest.class.getResourceAsStream("/db/migration/V62__reading_example_audio.sql")) {
            assertThat(in).isNotNull();
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        Map<String, ReadingExampleAudio> out = new LinkedHashMap<>();
        Matcher matcher = Pattern.compile("\\$audio\\$(.*?)\\$audio\\$::jsonb, updated_at = now\\(\\) WHERE id = '([a-z]+)'", Pattern.DOTALL)
                .matcher(sql);
        while (matcher.find()) {
            out.put(matcher.group(2), ReadingExampleAudioJson.parse(MAPPER, matcher.group(1)));
        }
        return out;
    }
}
