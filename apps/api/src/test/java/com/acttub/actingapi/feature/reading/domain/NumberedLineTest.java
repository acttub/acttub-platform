package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class NumberedLineTest {

    @Test
    void withContextMarksNeighboursAndMergesOverlappingWindows() {
        // 빈 줄(3번)은 번호만 건너뛰고 문맥 줄 수에 들지 않는다.
        List<NumberedLine> all = NumberedLine.of("가\n나\n\n다\n라\n마\n바\n사\n아");
        List<NumberedLine> targets = List.of(all.get(0), all.get(4));

        assertThat(NumberedLine.withContext(all, targets, 1)).isEqualTo("""
                1\t가
                ~2\t나
                ~5\t라
                6\t마
                ~7\t바""");
        assertThat(NumberedLine.withContext(all, targets, 2)).isEqualTo("""
                1\t가
                ~2\t나
                ~4\t다
                ~5\t라
                6\t마
                ~7\t바
                ~8\t사""");
    }
}
