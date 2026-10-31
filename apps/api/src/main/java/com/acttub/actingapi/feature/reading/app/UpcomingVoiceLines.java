package com.acttub.actingapi.feature.reading.app;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.reading.app.ScriptViews.CharacterView;
import com.acttub.actingapi.feature.reading.app.ScriptViews.LineView;

/**
 * 리딩 회차에서 방금 고품질 목소리를 요청한 줄 다음에 나올 상대 대사(SOMA-949). 서버가 미리 만들어 둘 줄을 고른다.
 *
 * <p>앱(apps/mobile app/reading/play.tsx 「primeSpeech」)과 같은 규칙으로 고른다 — 회차 범위 안의 대사 줄 중 내 배역이 아니고
 * 나를 포함한 묶음 배역도 아닌 줄, 목소리는 그 배역의 {@code voice}, 글은 {@link VoiceText#spoken}. 찾지 못하면 빈 목록이다.
 */
public interface UpcomingVoiceLines {
    /** 앱이 요청할 모양 그대로의 한 줄. */
    record Line(String text, String preset) {}

    List<Line> after(UUID userId, UUID sessionId, String text, String preset, int count);

    UpcomingVoiceLines NONE = (userId, sessionId, text, preset, count) -> List.of();

    /**
     * 대본·회차 정보에서 고른다. 요청한 줄(글과 목소리가 같은 상대 대사)을 범위 안에서 처음 찾은 자리 뒤로 {@code count}줄.
     * 여러 말로 나눠 읽는 줄은 앱이 조각마다 요청해서 서버가 같은 글을 만들기 어렵다 — 고르지 않고 건너뛴다.
     */
    static List<Line> pick(List<CharacterView> characters, List<LineView> lines, List<UUID> myCharacterIds,
            UUID startLineId, UUID endLineId, String text, String preset, int count) {
        if (count <= 0 || text == null || preset == null) return List.of();
        Set<UUID> mine = new HashSet<>(myCharacterIds == null ? List.of() : myCharacterIds);
        Map<UUID, CharacterView> byId = characters.stream().collect(Collectors.toMap(CharacterView::id, Function.identity(), (a, b) -> a));
        int start = indexOf(lines, startLineId, 0);
        int end = indexOf(lines, endLineId, lines.size() - 1);
        if (start < 0 || end < start) return List.of();
        String wanted = text.trim();
        List<Line> next = new ArrayList<>();
        boolean found = false;
        for (int i = start; i <= end && next.size() < count; i++) {
            LineView line = lines.get(i);
            if (!"dialogue".equals(line.kind())) continue;
            CharacterView who = byId.get(line.characterId());
            if (who == null || mine.contains(who.id()) || who.memberIds().stream().anyMatch(mine::contains)) continue;
            String spoken = VoiceText.spoken(line.text(), line.speech());
            if (spoken == null || spoken.isEmpty() || who.voice() == null) continue;
            if (found) next.add(new Line(spoken, who.voice()));
            else if (spoken.equals(wanted) && who.voice().equals(preset)) found = true;
        }
        return found ? next : List.of();
    }

    private static int indexOf(List<LineView> lines, UUID id, int fallback) {
        if (id == null) return fallback;
        for (int i = 0; i < lines.size(); i++) if (id.equals(lines.get(i).id())) return i;
        return -1;
    }
}
