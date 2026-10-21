package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 원문의 비지 않은 줄 하나와 원래 줄 번호(1부터). 모델은 이 번호로 답하고 서버는 이 번호로 답을 원문에 되돌린다 —
 * 글자는 모델이 쓰지 않는다.
 */
public record NumberedLine(int no, String text) {

    /** 빈 줄을 뺀 줄에 원래 줄 번호를 붙인다. {@code \r\n} 도 줄바꿈이다. */
    public static List<NumberedLine> of(String raw) {
        List<NumberedLine> lines = new ArrayList<>();
        String[] all = raw.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
        for (int index = 0; index < all.length; index++) {
            if (!all[index].isBlank()) {
                lines.add(new NumberedLine(index + 1, all[index]));
            }
        }
        return lines;
    }

    /** 모델에 보내는 모양 — {@code 줄번호<TAB>원문} 한 줄씩. */
    public static String format(List<NumberedLine> lines) {
        StringBuilder out = new StringBuilder();
        for (NumberedLine line : lines) {
            if (!out.isEmpty()) {
                out.append('\n');
            }
            out.append(line.no()).append('\t').append(line.text());
        }
        return out.toString();
    }

    /**
     * 빠진 줄을 다시 묻는 입력 — {@code targets} 는 {@link #format} 모양, 그 앞뒤 {@code around} 줄은 번호 앞에 {@code ~} 를 붙인
     * 문맥 줄이다. 줄 순서는 {@code all} 순서다.
     */
    public static String withContext(List<NumberedLine> all, List<NumberedLine> targets, int around) {
        Set<Integer> wanted = new HashSet<>();
        for (NumberedLine target : targets) {
            wanted.add(target.no());
        }
        boolean[] shown = new boolean[all.size()];
        for (int index = 0; index < all.size(); index++) {
            if (wanted.contains(all.get(index).no())) {
                Arrays.fill(shown, Math.max(0, index - around), Math.min(all.size(), index + around + 1), true);
            }
        }
        StringBuilder out = new StringBuilder();
        for (int index = 0; index < all.size(); index++) {
            if (!shown[index]) {
                continue;
            }
            NumberedLine line = all.get(index);
            if (!out.isEmpty()) {
                out.append('\n');
            }
            out.append(wanted.contains(line.no()) ? "" : "~").append(line.no()).append('\t').append(line.text());
        }
        return out.toString();
    }

    /** 앞에서부터 {@code size} 줄씩. */
    public static List<List<NumberedLine>> chunks(List<NumberedLine> lines, int size) {
        List<List<NumberedLine>> chunks = new ArrayList<>();
        for (int start = 0; start < lines.size(); start += size) {
            chunks.add(List.copyOf(lines.subList(start, Math.min(lines.size(), start + size))));
        }
        return chunks;
    }
}
