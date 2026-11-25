package com.acttub.actingapi.feature.audition.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import com.acttub.actingapi.feature.audition.app.AuditionRepository;
import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 오디션 공고의 Postgres 구현 — {@code audition_postings}(V36). */
@Repository
class PostgresAuditionRepository implements AuditionRepository {

    private final AuditionPostingJpaRepository postings;
    private final TransactionTemplate transaction;

    PostgresAuditionRepository(AuditionPostingJpaRepository postings, PlatformTransactionManager transactionManager) {
        this.postings = postings;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /** 공고마다 한 문장이고 한 번 부른 것은 한 트랜잭션이다 — 하나가 실패하면 앞에서 넣은 것도 되돌린다. */
    @Override
    public void upsert(List<AuditionPosting> postings, Instant now) {
        transaction.executeWithoutResult(tx -> postings.forEach(posting -> this.postings.upsert(
                posting.source(), posting.sourceRef(), posting.title(), posting.category(), posting.payText(),
                posting.applyStart(), posting.applyEnd(), posting.statusText(), posting.postedOn(), posting.sourceUrl(),
                now)));
    }

    @Override
    public List<AuditionPosting> openCandidates(LocalDate today) {
        return postings.openCandidates(today, AuditionRules.openPostedSince(today));
    }

    @Override
    public int deleteExpired(LocalDate today) {
        return transaction.execute(tx -> postings.deleteExpired(
                AuditionRules.deleteEndedBefore(today), AuditionRules.deletePostedBefore(today)));
    }

    @Override
    public Optional<Instant> lastCollectedAt() {
        return Optional.ofNullable(postings.lastSeenAt());
    }
}
