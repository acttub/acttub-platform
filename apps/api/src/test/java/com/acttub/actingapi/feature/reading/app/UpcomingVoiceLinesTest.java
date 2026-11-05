package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptViews.CharacterView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.LineView;
import com.acttub.actingapi.feature.reading.app.UpcomingVoiceLines.Line;
import org.junit.jupiter.api.Test;

/** 서버가 미리 만들 상대 대사를 앱과 같은 규칙으로 고른다(SOMA-949). */
class UpcomingVoiceLinesTest {
    private final UUID me = UUID.randomUUID();
    private final UUID jiho = UUID.randomUUID();
    private final UUID mina = UUID.randomUUID();
    private final UUID together = UUID.randomUUID();
    private final List<CharacterView> characters = List.of(
            character(me, "서연", "F2", List.of()),
            character(jiho, "지호", "M1", List.of()),
            character(mina, "미나", "F1", List.of()),
            character(together, "서연, 지호", "M3", List.of(me, jiho)));
    private final List<LineView> lines = new ArrayList<>();

    private static CharacterView character(UUID id, String name, String voice, List<UUID> members) {
        return new CharacterView(id, name, 0, null, voice, null, null, 0, members, false);
    }

    private LineView line(String kind, UUID who, String text, String speech) {
        LineView line = new LineView(UUID.randomUUID(), lines.size() + 1, kind, who, text, null, null, speech);
        lines.add(line);
        return line;
    }

    @Test
    void picksFollowingPartnerLinesWithTheirVoices() {
        line("dialogue", jiho, "하나", null);
        line("dialogue", me, "내 대사", null);
        line("direction", null, "(문을 연다)", null);
        line("dialogue", jiho, "둘", null);
        line("dialogue", mina, "셋", null);
        line("dialogue", together, "같이 말하는 줄", null);
        line("dialogue", jiho, "넷", null);
        line("dialogue", jiho, "다섯", null);

        var next = UpcomingVoiceLines.pick(characters, lines, List.of(me), null, null, "하나", "M1", 3);

        // 내 줄·지문·나를 포함한 묶음 배역 줄은 앱도 읽지 않는다.
        assertThat(next).containsExactly(new Line("둘", "M1"), new Line("셋", "F1"), new Line("넷", "M1"));
    }

    @Test
    void allListsEveryPartnerLineInTheRange() {
        line("dialogue", jiho, "하나", null);
        LineView start = line("dialogue", me, "내 대사", null);
        line("dialogue", mina, "(웃으며) 둘", null);
        line("dialogue", together, "같이 말하는 줄", null);
        LineView end = line("dialogue", jiho, "셋", null);
        line("dialogue", jiho, "범위 밖", null);

        var all = UpcomingVoiceLines.allOf(characters, lines, List.of(me), start.id(), end.id());

        assertThat(all).containsExactly(new Line("둘", "F1"), new Line("셋", "M1"));
    }

    @Test
    void allGivesUpOnLinesReadInParts() {
        line("dialogue", jiho, "하나", null);
        line("dialogue", mina, "Hello 안녕", "⟦en⟧Hello⟦ko⟧안녕");
        assertThat(UpcomingVoiceLines.allOf(characters, lines, List.of(me), null, null)).isNull();
    }

    @Test
    void allGivesUpOnPartnersWithoutVoiceOrABrokenRange() {
        UUID silent = UUID.randomUUID();
        var withSilent = new ArrayList<>(characters);
        withSilent.add(character(silent, "목소리 없음", null, List.of()));
        line("dialogue", silent, "하나", null);
        assertThat(UpcomingVoiceLines.allOf(withSilent, lines, List.of(me), null, null)).isNull();
        assertThat(UpcomingVoiceLines.allOf(characters, lines, List.of(me), UUID.randomUUID(), null)).isNull();
    }

    @Test
    void staysInsideTheSessionRange() {
        line("dialogue", jiho, "하나", null);
        LineView end = line("dialogue", jiho, "둘", null);
        line("dialogue", jiho, "범위 밖", null);
        var next = UpcomingVoiceLines.pick(characters, lines, List.of(me), lines.get(0).id(), end.id(), "하나", "M1", 3);
        assertThat(next).containsExactly(new Line("둘", "M1"));
    }

    @Test
    void returnsNothingWhenTheRequestedLineIsNotFound() {
        line("dialogue", jiho, "하나", null);
        line("dialogue", jiho, "둘", null);
        assertThat(UpcomingVoiceLines.pick(characters, lines, List.of(me), null, null, "없는 줄", "M1", 3)).isEmpty();
        // 글이 같아도 목소리가 다르면 다른 줄이다.
        assertThat(UpcomingVoiceLines.pick(characters, lines, List.of(me), null, null, "하나", "F1", 3)).isEmpty();
    }

    @Test
    void matchesTheTextTheAppSends() {
        line("dialogue", jiho, "(웃으며) \"정말?\"", null);
        line("dialogue", jiho, "그래 (작게)", null);
        var next = UpcomingVoiceLines.pick(characters, lines, List.of(me), null, null, "정말?", "M1", 3);
        assertThat(next).containsExactly(new Line("그래", "M1"));
    }

    @Test
    void skipsLinesTheAppReadsInSeveralLanguageParts() {
        line("dialogue", jiho, "하나", null);
        line("dialogue", jiho, "Hello 반가워", "\u27E6en\u27E7Hello \u27E6ko\u27E7반가워");
        line("dialogue", jiho, "둘", null);
        var next = UpcomingVoiceLines.pick(characters, lines, List.of(me), null, null, "하나", "M1", 3);
        assertThat(next).containsExactly(new Line("둘", "M1"));
    }

    // ── SOMA-1000: 요청한 줄이 지금 읽는 줄에서 상대 대사 몇 줄 앞인지 ──

    @Test
    void countsPartnerLinesFromTheCurrentLine() {
        LineView current = line("dialogue", me, "내 대사", null);
        line("dialogue", jiho, "하나", null);
        line("direction", null, "(문을 연다)", null);
        line("dialogue", together, "같이 말하는 줄", null);
        line("dialogue", mina, "둘", null);
        line("dialogue", me, "또 내 대사", null);
        line("dialogue", jiho, "셋", null);
        // 내 줄·지문·묶음 배역 줄은 세지 않는다.
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), null, null, current.id(), "하나", "M1")).isZero();
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), null, null, current.id(), "둘", "F1")).isEqualTo(1);
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), null, null, current.id(), "셋", "M1")).isEqualTo(2);
    }

    @Test
    void passedLinesAreZeroAndUnknownLinesAreNull() {
        line("dialogue", jiho, "하나", null);
        LineView current = line("dialogue", jiho, "둘", null);
        line("dialogue", jiho, "셋", null);
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), null, null, current.id(), "하나", "M1")).isZero();
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), null, null, current.id(), "없는 줄", "M1")).isNull();
        // 목소리가 다르면 다른 줄이다.
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), null, null, current.id(), "셋", "F1")).isNull();
        // 지금 줄이 대본에 없으면 모른다.
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), null, null, UUID.randomUUID(), "셋", "M1")).isNull();
    }

    @Test
    void repeatedTextUsesTheNearestPlaceAheadAndStaysInRange() {
        LineView start = line("dialogue", jiho, "네", null);
        LineView current = line("dialogue", jiho, "하나", null);
        line("dialogue", jiho, "둘", null);
        line("dialogue", jiho, "네", null);
        LineView end = line("dialogue", jiho, "셋", null);
        line("dialogue", jiho, "범위 밖", null);
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), start.id(), end.id(), current.id(), "네", "M1")).isEqualTo(2);
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), start.id(), end.id(), current.id(), "범위 밖", "M1")).isNull();
        // 지금 줄을 모르면(첫 줄부터) 구간 처음에서 센다.
        assertThat(UpcomingVoiceLines.aheadOf(characters, lines, List.of(me), start.id(), end.id(), null, "셋", "M1")).isEqualTo(4);
    }
}
