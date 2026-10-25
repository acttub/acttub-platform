package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 미리 만든 음성 줄을 복사한 대본의 줄에 잇는 규칙. */
class ReadingExampleAudioTest {
    private static final ReadingExample EXAMPLE = new ReadingExample("ex", "제목", "요약", "원문", List.of("윤서", "태오"), List.of(
            new ReadingExample.Line("direction", null, "(지문)"),
            new ReadingExample.Line("dialogue", 0, "하나."),
            new ReadingExample.Line("dialogue", 1, "(웃으며) 둘."),
            new ReadingExample.Line("dialogue", 0, "셋.")));
    private static final ReadingExampleAudio AUDIO = new ReadingExampleAudio("p/ex/", Map.of("윤서", "F1", "태오", "M1"), List.of(
            new ReadingExampleAudio.Line(2, "2.m4a", 1000),
            new ReadingExampleAudio.Line(3, "3.m4a", 2000),
            new ReadingExampleAudio.Line(4, "4.m4a", 3000)));

    private static List<ReadingExampleAudio.CopiedLine> copy() {
        List<ReadingExampleAudio.CopiedLine> out = new ArrayList<>();
        for (int i = 0; i < EXAMPLE.lines().size(); i++) {
            ReadingExample.Line line = EXAMPLE.lines().get(i);
            out.add(new ReadingExampleAudio.CopiedLine(UUID.randomUUID(), i + 1, line.kind(),
                    line.character() == null ? null : EXAMPLE.characters().get(line.character()), line.text(), null));
        }
        return out;
    }

    @Test
    @DisplayName("그대로 복사한 대본: 대사 줄마다 그 줄 id 와 prefix+key, 길이")
    void matchesEveryDialogue() {
        List<ReadingExampleAudio.CopiedLine> copied = copy();
        assertThat(AUDIO.match(EXAMPLE, copied)).containsExactly(
                new ReadingExampleAudio.Matched(copied.get(1).id(), "p/ex/2.m4a", 1000),
                new ReadingExampleAudio.Matched(copied.get(2).id(), "p/ex/3.m4a", 2000),
                new ReadingExampleAudio.Matched(copied.get(3).id(), "p/ex/4.m4a", 3000));
    }

    @Test
    @DisplayName("고친 글·바꾼 배역·지문으로 바꾼 줄·읽을 글이 따로 있는 줄·없는 줄은 뺀다")
    void omitsEditedLines() {
        List<ReadingExampleAudio.CopiedLine> copied = copy();
        var two = copied.get(1);
        var three = copied.get(2);
        copied.set(1, new ReadingExampleAudio.CopiedLine(two.id(), 2, "dialogue", "윤서", "하나!", null));
        copied.set(2, new ReadingExampleAudio.CopiedLine(three.id(), 3, "dialogue", "윤서", three.text(), null));
        assertThat(AUDIO.match(EXAMPLE, copied)).extracting(ReadingExampleAudio.Matched::objectKey).containsExactly("p/ex/4.m4a");

        copied = copy();
        copied.set(3, new ReadingExampleAudio.CopiedLine(copied.get(3).id(), 4, "direction", null, "셋.", null));
        copied.set(1, new ReadingExampleAudio.CopiedLine(copied.get(1).id(), 2, "dialogue", "윤서", "하나.", "하나"));
        assertThat(AUDIO.match(EXAMPLE, copied)).extracting(ReadingExampleAudio.Matched::objectKey).containsExactly("p/ex/3.m4a");

        assertThat(AUDIO.match(EXAMPLE, copy().subList(0, 2))).extracting(ReadingExampleAudio.Matched::objectKey)
                .containsExactly("p/ex/2.m4a");
    }

    @Test
    @DisplayName("앞에 줄을 넣어 자리가 밀리면 같은 글이 아니라 빠진다")
    void omitsShiftedLines() {
        List<ReadingExampleAudio.CopiedLine> shifted = new ArrayList<>();
        shifted.add(new ReadingExampleAudio.CopiedLine(UUID.randomUUID(), 1, "direction", null, "(새 지문)", null));
        for (ReadingExampleAudio.CopiedLine line : copy()) {
            shifted.add(new ReadingExampleAudio.CopiedLine(line.id(), line.ordinal() + 1, line.kind(), line.characterName(), line.text(), null));
        }
        assertThat(AUDIO.match(EXAMPLE, shifted)).isEmpty();
    }
}
