package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.Arrays;
import java.util.List;

/** 이름·id 목록을 한 칸에 이어 붙여 읽는 규칙 — 대본·회차 저장소가 같이 쓴다. */
final class JoinedColumn {
    /** 이어 붙일 때 쓰는 구분자. 이름에 나올 수 없는 제어 문자다. */
    static final String SEPARATOR = "\u001f";

    private JoinedColumn() {
    }

    static List<String> split(String joined) {
        return joined == null || joined.isEmpty() ? List.of() : Arrays.asList(joined.split(SEPARATOR, -1));
    }
}
