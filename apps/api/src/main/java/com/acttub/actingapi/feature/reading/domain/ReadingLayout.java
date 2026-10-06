package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 대본 줄 열에서 세는 리딩 표시값 — 대사 번호, 장면, 구간 이름, 진행 K/N (reading.session). 앱·웹은 이 값을 그리기만
 * 한다. 프레임워크를 모른다.
 */
public final class ReadingLayout {

    /** 지문으로 나눈 장면이 이보다 대사가 적으면 이웃 장면에 붙인다 — 장면 머리 없는 대본이 잘게 쪼개지지 않게. */
    private static final int MIN_SCENE_DIALOGUES = 5;

    private static final String DIALOGUE = "dialogue";
    private static final String SCENE = "scene";

    /** @param kind {@code dialogue}·{@code direction}·{@code scene} */
    public record Line(UUID id, String kind, String text) {
    }

    /**
     * @param title 막·장 머리 줄의 글. 지문으로 나눈 장면은 {@code null} 이고 화면이 번호로 부른다
     * @param startLineId 장면 안 첫 대사 줄
     * @param endLineId 장면 안 마지막 대사 줄
     */
    public record Scene(int no, String title, UUID startLineId, UUID endLineId, int dialogueCount) {
    }

    /**
     * 구간 이름. 화면 글(「장면 2」·「대사 5~12번」)은 기기가 만든다.
     *
     * @param kind {@code all}(대본 전체)·{@code scene}(장면 하나와 첫·끝 대사가 정확히 같음)·{@code dialogues}(그 밖)
     * @param sceneNo {@code scene} 일 때만
     * @param sceneTitle {@code scene} 이고 그 장면에 머리 줄이 있을 때만
     * @param start 구간 시작 대사 번호
     * @param end 구간 끝 대사 번호
     */
    public record RangeName(String kind, Integer sceneNo, String sceneTitle, int start, int end) {
    }

    /** @param done 현재 줄 앞까지 지난 대사 수 @param total 구간 안 대사 수(모든 배역) */
    public record Progress(int done, int total) {
    }

    private record Span(String title, int first, int last, int count) {
        Span join(Span next) {
            return new Span(title, Math.min(first, next.first), Math.max(last, next.last), count + next.count);
        }
    }

    private final List<Line> lines;
    private final Integer[] dialogueNos;
    private final Map<UUID, Integer> indexOf = new HashMap<>();
    private final int dialogueCount;
    private final List<Span> spans;

    private ReadingLayout(List<Line> lines) {
        this.lines = List.copyOf(lines);
        this.dialogueNos = new Integer[lines.size()];
        int n = 0;
        for (int i = 0; i < lines.size(); i++) {
            indexOf.put(lines.get(i).id(), i);
            if (DIALOGUE.equals(lines.get(i).kind())) {
                dialogueNos[i] = ++n;
            }
        }
        this.dialogueCount = n;
        this.spans = spans();
    }

    /** @param lines 대본의 줄, 순서대로 */
    public static ReadingLayout of(List<Line> lines) {
        return new ReadingLayout(lines);
    }

    /** 대사 줄만 1부터 센 번호. 지문·장면은 {@code null}. */
    public Integer dialogueNo(int index) {
        return dialogueNos[index];
    }

    /**
     * 「장면으로 찾기」의 후보. 장면 줄(막·장 머리)이 있으면 그 줄이 경계이고, 없으면 지문이 경계다. 대사가 없는 장면은
     * 없다. 지문 경계의 짧은 장면은 앞 장면에(첫 장면이면 뒤 장면에) 붙인다.
     */
    public List<Scene> scenes() {
        List<Scene> scenes = new ArrayList<>();
        for (Span span : spans) {
            scenes.add(new Scene(scenes.size() + 1, span.title(), lines.get(span.first()).id(),
                    lines.get(span.last()).id(), span.count()));
        }
        return scenes;
    }

    /** 대사 번호 구간(양끝 포함)의 이름. */
    public RangeName rangeName(int startNo, int endNo) {
        if (startNo == 1 && endNo == dialogueCount) {
            return new RangeName("all", null, null, startNo, endNo);
        }
        for (int i = 0; i < spans.size(); i++) {
            Span span = spans.get(i);
            if (dialogueNos[span.first()] == startNo && dialogueNos[span.last()] == endNo) {
                return new RangeName("scene", i + 1, span.title(), startNo, endNo);
            }
        }
        return new RangeName("dialogues", null, null, startNo, endNo);
    }

    /**
     * 진행 중 회차의 K/N. N 은 구간 대사 수, K 는 현재 줄의 대사 번호에서 시작 번호를 뺀 것이다. 현재 줄이 대사가
     * 아니면 그 앞 대사의 번호로 센다(웹 규칙 — 이어 할 때 덜 뒤로 간 것처럼 보인다). 현재 줄을 모르면 0.
     */
    public Progress progress(int startNo, int endNo, UUID currentLineId) {
        int total = endNo - startNo + 1;
        Integer index = currentLineId == null ? null : indexOf.get(currentLineId);
        if (index == null) {
            return new Progress(0, total);
        }
        int currentNo = startNo;
        for (int i = index; i >= 0; i--) {
            if (dialogueNos[i] != null) {
                currentNo = dialogueNos[i];
                break;
            }
        }
        return new Progress(Math.min(total, Math.max(0, currentNo - startNo)), total);
    }

    private List<Span> spans() {
        boolean byHeader = lines.stream().anyMatch(line -> SCENE.equals(line.kind()));
        List<Span> out = new ArrayList<>();
        String title = null;
        boolean open = false;
        int first = -1;
        int last = -1;
        int count = 0;
        for (int i = 0; i < lines.size(); i++) {
            Line line = lines.get(i);
            boolean boundary = byHeader ? SCENE.equals(line.kind()) : !DIALOGUE.equals(line.kind());
            if (boundary) {
                if (open && first >= 0) {
                    out.add(new Span(title, first, last, count));
                }
                open = true;
                title = byHeader ? line.text() : null;
                first = -1;
                last = -1;
                count = 0;
                continue;
            }
            if (!DIALOGUE.equals(line.kind())) {
                continue;
            }
            if (!open) {
                open = true;
                title = null;
            }
            if (first < 0) {
                first = i;
            }
            last = i;
            count++;
        }
        if (open && first >= 0) {
            out.add(new Span(title, first, last, count));
        }
        return byHeader ? out : mergeShort(out);
    }

    private static List<Span> mergeShort(List<Span> spans) {
        List<Span> merged = new ArrayList<>();
        for (Span span : spans) {
            if (!merged.isEmpty() && span.count() < MIN_SCENE_DIALOGUES) {
                merged.set(merged.size() - 1, merged.getLast().join(span));
            } else {
                merged.add(span);
            }
        }
        if (merged.size() > 1 && merged.getFirst().count() < MIN_SCENE_DIALOGUES) {
            merged.set(0, merged.getFirst().join(merged.get(1)));
            merged.remove(1);
        }
        return merged;
    }
}
