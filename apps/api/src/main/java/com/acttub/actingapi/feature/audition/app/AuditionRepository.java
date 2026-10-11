package com.acttub.actingapi.feature.audition.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;

/** 모은 공고를 두는 곳. {@code (source, source_ref)} 가 한 행이다. */
public interface AuditionRepository {

    /** 없으면 넣고 있으면 칸을 새 값으로 바꾼다. 둘 다 {@code last_seen_at} 을 {@code now} 로 둔다. */
    void upsert(List<AuditionPosting> postings, Instant now);

    /**
     * 열려 있을 수 있는 행 — 마감일이 {@code today} 이후이거나, 마감일이 없고 게시일이 45일 안인 것. 마감 표시는 보지
     * 않는다(최종 판정은 {@code AuditionRules#isOpen}).
     */
    List<AuditionPosting> openCandidates(LocalDate today);

    /** 끝 상태(삭제): 마감일이 30일 지났거나, 마감일이 없고 게시일이 180일 지난 행. 지운 수. */
    int deleteExpired(LocalDate today);

    /** 마지막으로 공고를 본 시각({@code max(last_seen_at)}). 한 번도 모으지 못했으면 비어 있다. */
    Optional<Instant> lastCollectedAt();
}
