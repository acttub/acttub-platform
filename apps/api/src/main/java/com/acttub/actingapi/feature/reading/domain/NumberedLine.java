package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;

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

    /** 앞에서부터 {@code size} 줄씩. */
    public static List<List<NumberedLine>> chunks(List<NumberedLine> lines, int size) {
        List<List<NumberedLine>> chunks = new ArrayList<>();
        for (int start = 0; start < lines.size(); start += size) {
            chunks.add(List.copyOf(lines.subList(start, Math.min(lines.size(), start + size))));
        }
        return chunks;
    }
}
