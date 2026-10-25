package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 예시 대본의 미리 만든 상대역 음성 — {@code reading_examples.audio} (V62, reading.script 「예시 대본」).
 *
 * <p>대사 줄마다 파일 하나를 그 배역의 목소리({@link #voices()})로 만들어 영상 버킷의 {@link #prefix()} 아래에 두었다. 복사한
 * 대본의 줄과는 자리(ordinal = {@link Line#seq()})로 잇되, 그 줄이 여전히 같은 배역의 같은 대사일 때만 잇는다 — 배우가 줄을 고치거나
 * 넣고 빼면 그 줄의 음성은 맞지 않아 뺀다. {@link #lines()} 가 비면 상대역이 없는 예시(독백)라 음성도 모델도 필요 없다.
 *
 * @param prefix 객체 키 앞자리(끝 {@code /}). 줄이 없으면 빈 글자일 수 있다
 * @param voices 배역 이름 → 음성을 만든 프리셋
 */
public record ReadingExampleAudio(String prefix, Map<String, String> voices, List<Line> lines) {

    public ReadingExampleAudio {
        prefix = prefix == null ? "" : prefix;
        voices = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(voices));
        lines = List.copyOf(lines);
        if (!lines.isEmpty() && (prefix.isBlank() || !prefix.endsWith("/"))) {
            throw new IllegalArgumentException("audio prefix must end with / when there are lines");
        }
        for (Line line : lines) {
            if (line.seq() < 1 || line.key() == null || line.key().isBlank() || line.key().contains("..")
                    || line.key().startsWith("/") || line.durationMs() < 0) {
                throw new IllegalArgumentException("invalid audio line: " + line);
            }
        }
    }

    /** @param seq 예시 draft 의 줄 자리(1부터, 지문 포함) @param key {@link #prefix()} 뒤의 파일 이름 */
    public record Line(int seq, String key, int durationMs) {
    }

    /**
     * 복사한 대본의 줄 하나.
     *
     * @param characterName 대사면 배역 이름, 아니면 {@code null}
     * @param speech 상대역이 읽을 다른 글(서버가 단 것). 없으면 {@code null}
     */
    public record CopiedLine(UUID id, int ordinal, String kind, String characterName, String text, String speech) {
    }

    /** @param objectKey 버킷 안의 전체 키 */
    public record Matched(UUID lineId, String objectKey, int durationMs) {
    }

    /**
     * 음성 줄을 복사한 대본의 줄에 잇는다. 같은 자리의 줄이 예시 그 줄과 같은 대사(종류·배역 이름·글)이고 다른 읽을 글이 없을 때만
     * 잇고, 아니면 뺀다. 순서는 음성 줄 순서다.
     */
    public List<Matched> match(ReadingExample example, List<CopiedLine> copied) {
        Map<Integer, CopiedLine> byOrdinal = new LinkedHashMap<>();
        for (CopiedLine line : copied) {
            byOrdinal.put(line.ordinal(), line);
        }
        List<Matched> out = new ArrayList<>();
        for (Line line : lines) {
            if (line.seq() > example.lines().size()) {
                continue;
            }
            ReadingExample.Line source = example.lines().get(line.seq() - 1);
            CopiedLine target = byOrdinal.get(line.seq());
            if (target == null || !"dialogue".equals(source.kind()) || source.character() == null) {
                continue;
            }
            String speaker = example.characters().get(source.character());
            if ("dialogue".equals(target.kind()) && speaker.equals(target.characterName())
                    && source.text().equals(target.text()) && target.speech() == null) {
                out.add(new Matched(target.id(), prefix + line.key(), line.durationMs()));
            }
        }
        return out;
    }
}
