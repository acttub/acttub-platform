package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Line;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Output;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Prepared;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Recording;
import org.junit.jupiter.api.Test;

class RecordingCoachMaterialTest {

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

        Prepared prepared = RecordingCoachMaterial.prepare(
                List.of(noStt, silent, first, partner, direction), Set.of(ME), recordings);

        assertThat(prepared.clips()).extracting(RecordingCoachMaterial.Clip::lineId)
                .containsExactly(first.id(), noStt.id());
        assertThat(prepared.clips()).extracting(RecordingCoachMaterial.Clip::label)
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
        assertThat(RecordingCoachMaterial.audible(recording(UUID.randomUUID(), "none", null, 800))).isFalse();
        assertThat(RecordingCoachMaterial.audible(recording(UUID.randomUUID(), "none", null, 801))).isTrue();
    }

    @Test
    void capsTheNumberOfClips() {
        List<Line> lines = new ArrayList<>();
        List<Recording> recordings = new ArrayList<>();
        for (int i = 0; i < RecordingCoachMaterial.MAX_CLIPS + 5; i++) {
            Line line = new Line(UUID.randomUUID(), i, "dialogue", "대사 " + i, ME, "윤서");
            lines.add(line);
            recordings.add(recording(line.id(), "stt", "대사", 1000));
        }
        assertThat(RecordingCoachMaterial.prepare(lines, Set.of(ME), recordings).clips())
                .hasSize(RecordingCoachMaterial.MAX_CLIPS);
    }

    @Test
    void parseHidesTheDesignAndReadsTheChosenClip() {
        Output output = RecordingCoachMaterial.parse("""
                <설계>
                녹음 1: 빠름
                고른 녹음: 2
                </설계>
                "됐어"는 앞 대사보다 끝이 내려가요. 윤서는 민준한테서 무슨 말을 듣고 싶었어요?
                """);
        assertThat(output.message()).isEqualTo("\"됐어\"는 앞 대사보다 끝이 내려가요. 윤서는 민준한테서 무슨 말을 듣고 싶었어요?");
        assertThat(output.design()).contains("고른 녹음: 2");
        assertThat(output.chosenClip()).isEqualTo(2);
    }

    @Test
    void parseTreatsAnUnclosedDesignAsHidden() {
        Output output = RecordingCoachMaterial.parse("<설계> 고른 녹음: 1 그리고 배우에게");
        assertThat(output.message()).isEmpty();
        assertThat(output.chosenClip()).isEqualTo(1);
        assertThat(RecordingCoachMaterial.parse("소리로는 여기까지예요.").design()).isNull();
    }

    private static Recording recording(UUID lineId, String source, String transcript, int durationMs) {
        return new Recording(lineId, "k/" + lineId, "audio/mp4", durationMs, 20_000, transcript, source);
    }

    @Test
    void 평가하는_말을_찾는다() {
        assertThat(RecordingCoachMaterial.evaluative("느리게 말한 게 잘 맞네요.")).isEqualTo("잘 맞네요");
        assertThat(RecordingCoachMaterial.evaluative("소리로는 충분하니 영상으로 찍어 봐요.")).isEqualTo("충분");
        assertThat(RecordingCoachMaterial.evaluative("빠르게 말한 소리와 잘 어울려요.")).isEqualTo("잘 어울려요");
        assertThat(RecordingCoachMaterial.evaluative("\"말 안 하려고\"는 다른 대사들보다 빨라요. 왜 그렇게 말해요?")).isNull();
        assertThat(RecordingCoachMaterial.evaluative("방금 말한 것은 느리게 말한 소리와 맞아요.")).isNull();
        assertThat(RecordingCoachMaterial.evaluative("끝을 내려 말한 게 가라앉은 마음을 잘 보여줘요.")).isEqualTo("잘 보여줘요");
        assertThat(RecordingCoachMaterial.evaluative("지우의 고민이 느껴지네요.")).isEqualTo("느껴지");
        assertThat(RecordingCoachMaterial.evaluative("\"나도 잘 모르겠어\"는 다른 대사들보다 느려요.")).isNull();
    }
}
