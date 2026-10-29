package com.acttub.actingapi.feature.ads.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdStats;

/** 광고 저장소 — {@code ads}·{@code ad_events} (V66). */
public interface AdRepository {

    /** 지금 켜져 있고(active) 기간 안인 광고 중 이 칸을 대상으로 한 것. */
    List<Ad> activeFor(String slotKey, Instant now);

    /** 운영 화면용 — 모든 광고(꺼진 것까지)와 지금까지 노출·클릭 합계. 켜진 것, 우선순위 큰 것, 최근 것 순. */
    List<AdStats.Stored> all();

    Optional<AdStats.Stored> findStored(UUID adId);

    AdStats.Stored insert(AdDraft draft, Instant now);

    /** 없으면 empty. */
    Optional<AdStats.Stored> update(UUID adId, AdDraft draft, Instant now);

    /** from~to(포함, 한국 날짜)의 날짜별 노출·클릭. 기록이 있는 날만. */
    List<AdStats.Day> dailyEvents(UUID adId, LocalDate from, LocalDate to);

    /** 상태·기간과 상관없이 id 로. */
    Optional<Ad> find(UUID adId);

    /**
     * 첫 연습을 끝냈는가 — 노트가 생긴 코칭, 끝까지 읽은 리딩, 챌린지 참여 중 하나라도 있으면 true.
     * 앱 홈의 첫 사용자 판정(lib/home-today isFirstUser)과 같은 기준이다.
     */
    boolean practiced(UUID userId);

    /** 노출은 한 사람·광고·날짜에 한 번만 남는다. 새로 남겼으면 true. */
    boolean recordImpression(UUID adId, UUID userId, String slotKey, LocalDate day, Instant now);

    void recordClick(UUID adId, UUID userId, String slotKey, LocalDate day, Instant now);
}
