package com.acttub.actingapi.feature.ads.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** 운영 화면용 광고 읽기 모델(SOMA-876). 노출은 한 사람·광고·한국 날짜에 한 번, 클릭은 누른 횟수다. */
public final class AdStats {
    private AdStats() {
    }

    /** 저장된 광고와 지금까지 합계. */
    public record Stored(UUID id, AdDraft draft, Instant createdAt, Instant updatedAt, long impressions, long clicks) {
    }

    /** 한국 날짜 하루의 노출·클릭. */
    public record Day(LocalDate day, long impressions, long clicks) {
    }

    /** from~to(양 끝 포함, 한국 날짜) 날짜별 표와 기간 합계. 기록이 없는 날은 0 으로 채운다. */
    public record Period(LocalDate from, LocalDate to, List<Day> days, long impressions, long clicks) {
    }
}
