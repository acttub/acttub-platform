package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Line;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Prepared;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Recording;
import org.junit.jupiter.api.Test;

class ReadingVoiceMaterialTest {

    private static final UUID ME = UUID.randomUUID();
    private static final UUID PARTNER = UUID.randomUUID();

    @Test
    void picksOnlyMyAudibleLinesInScriptOrderAndLabelsThem() {
        Line direction = new Line(UUID.randomUUID(), 1, "direction", "옥상, 밤.", null, null);
        Line partner = new Line(UUID.randomUUID(), 2, "dialogue", "너 힘들면 말하라고 했잖아.", PARTNER, "민준");
        Line first = new Line(UUID.randomUUID(), 3, "dialogue", "왜 말 안 했어?", ME, "윤서");
        Line silent = new Line(UUID.randomUUID(), 4, "dialogue", "그냥.", ME, "윤서");
        Line noStt = new Line(UUID.randomUUID(), 5, "dialogue", "됐어.", ME, "윤서");
        List<Recording> recordings = List.of(
                recording(first.id(), "stt", "왜 말 안 했어", 1800),
                recording(silent.id(), "stt", "  ", 2000),
                recording(noStt.id(), "none", null, 1200),
                recording(partner.id(), "stt", "너 힘들면", 1500));

        Prepared prepared = ReadingVoiceMaterial.prepare(
                List.of(noStt, silent, first, partner, direction), Set.of(ME), recordings);

        assertThat(prepared.clips()).extracting(ReadingVoiceMaterial.Clip::lineId)
                .containsExactly(first.id(), noStt.id());
        assertThat(prepared.clips()).extracting(ReadingVoiceMaterial.Clip::label)
                .containsExactly("녹음 1", "녹음 2");
        assertThat(prepared.script()).isEqualTo("""
                [대본]
                1. [지문] 옥상, 밤.
                2. 민준(상대 대사): 너 힘들면 말하라고 했잖아.
                3. 윤서(내 대사, 녹음 1): 왜 말 안 했어?
                4. 윤서(내 대사, 녹음 없음): 그냥.
                5. 윤서(내 대사, 녹음 2): 됐어.
                """);
        assertThat(prepared.lineOf(2)).isEqualTo(noStt.id());
        assertThat(prepared.lineOf(9)).isNull();
    }

    @Test
    void shortRecordingWithoutTranscriptIsSilent() {
        assertThat(ReadingVoiceMaterial.audible(recording(UUID.randomUUID(), "none", null, 800))).isFalse();
        assertThat(ReadingVoiceMaterial.audible(recording(UUID.randomUUID(), "none", null, 801))).isTrue();
    }

    @Test
    void capsTheNumberOfClips() {
        List<Line> lines = new ArrayList<>();
        List<Recording> recordings = new ArrayList<>();
        for (int i = 0; i < ReadingVoiceMaterial.MAX_CLIPS + 5; i++) {
            Line line = new Line(UUID.randomUUID(), i, "dialogue", "대사 " + i, ME, "윤서");
            lines.add(line);
            recordings.add(recording(line.id(), "stt", "대사", 1000));
        }
        assertThat(ReadingVoiceMaterial.prepare(lines, Set.of(ME), recordings).clips())
                .hasSize(ReadingVoiceMaterial.MAX_CLIPS);
    }

    @Test
    void modelTextListsTheScriptAndWhereEachLineSitsInTheJoinedAudio() {
        Line first = new Line(UUID.randomUUID(), 1, "dialogue", "왜 말 안 했어?", ME, "윤서");
        Line partner = new Line(UUID.randomUUID(), 2, "dialogue", "그냥.", PARTNER, "민준");
        Line second = new Line(UUID.randomUUID(), 3, "dialogue", "됐어, 이제.", ME, "윤서");
        Prepared prepared = ReadingVoiceMaterial.prepare(List.of(first, partner, second), Set.of(ME),
                List.of(recording(first.id(), "stt", "왜 말 안 했어", 1800), recording(second.id(), "stt", "됐어 이제", 1500)));
        String text = ReadingVoiceMaterial.modelText(prepared, java.util.Map.of(first.id(), 1800, second.id(), 1500),
                "\n[서버가 잰 소리]\n다른 대사와 확실히 다르게 잰 소리가 없다.\n");

        assertThat(text).startsWith("[리딩 녹음]\n[대본]\n1. 윤서(내 대사, 녹음 1): 왜 말 안 했어?\n2. 민준(상대 대사): 그냥.\n")
                .contains("- 녹음 1: 0:00~0:02 \"왜 말 안 했어?\"\n", "- 녹음 2: 0:02~0:04 \"됐어, 이제.\"\n")
                .endsWith("다른 대사와 확실히 다르게 잰 소리가 없다.\n");
    }

    private static Recording recording(UUID lineId, String source, String transcript, int durationMs) {
        return new Recording(lineId, "k/" + lineId, "audio/mp4", durationMs, 20_000, transcript, source);
    }
}
