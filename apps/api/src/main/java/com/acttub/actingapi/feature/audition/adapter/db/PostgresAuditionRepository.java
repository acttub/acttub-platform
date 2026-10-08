package com.acttub.actingapi.feature.audition.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import com.acttub.actingapi.feature.audition.app.AuditionRepository;
import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 오디션 공고의 Postgres 구현 — {@code audition_postings}(V36). 쓰기가 전부 {@code ON CONFLICT} upsert 와 조건 삭제라
 * Schema Entity 없이 native SQL 로만 읽고 쓴다(CONTRACT §5-1·§5-2, EntityMappingIT 의 대기 목록).
 */
@Repository
class PostgresAuditionRepository implements AuditionRepository {

    private static final String COLUMNS = """
            source,source_ref,title,category,pay_text,apply_start,apply_end,status_text,posted_on,source_url""";

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAuditionRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public void upsert(List<AuditionPosting> postings, Instant now) {
        OffsetDateTime seen = now.atOffset(ZoneOffset.UTC);
        transaction.executeWithoutResult(tx -> postings.forEach(posting -> entityManager.createNativeQuery("""
                INSERT INTO audition_postings(source,source_ref,title,category,pay_text,apply_start,apply_end,
                                              status_text,posted_on,source_url,first_seen_at,last_seen_at)
                VALUES (:source,:sourceRef,:title,:category,CAST(:payText AS text),CAST(:applyStart AS date),
                        CAST(:applyEnd AS date),CAST(:statusText AS text),:postedOn,:sourceUrl,:seen,:seen)
                ON CONFLICT (source, source_ref) DO UPDATE
                SET title=EXCLUDED.title,category=EXCLUDED.category,pay_text=EXCLUDED.pay_text,
                    apply_start=EXCLUDED.apply_start,apply_end=EXCLUDED.apply_end,status_text=EXCLUDED.status_text,
                    posted_on=EXCLUDED.posted_on,source_url=EXCLUDED.source_url,last_seen_at=EXCLUDED.last_seen_at
                """)
                .setParameter("source", posting.source())
                .setParameter("sourceRef", posting.sourceRef())
                .setParameter("title", posting.title())
                .setParameter("category", posting.category())
                .setParameter("payText", posting.payText())
                .setParameter("applyStart", posting.applyStart())
                .setParameter("applyEnd", posting.applyEnd())
                .setParameter("statusText", posting.statusText())
                .setParameter("postedOn", posting.postedOn())
                .setParameter("sourceUrl", posting.sourceUrl())
                .setParameter("seen", seen)
                .executeUpdate()));
    }

    @Override
    public List<AuditionPosting> openCandidates(LocalDate today) {
        return list(entityManager.createNativeQuery("SELECT " + COLUMNS + """
                 FROM audition_postings
                WHERE apply_end >= :today
                   OR (apply_end IS NULL AND posted_on >= :postedSince)
                """, Tuple.class)
                .setParameter("today", today)
                .setParameter("postedSince", AuditionRules.openPostedSince(today)))
                .stream().map(PostgresAuditionRepository::posting).toList();
    }

    @Override
    public int deleteExpired(LocalDate today) {
        return transaction.execute(tx -> entityManager.createNativeQuery("""
                DELETE FROM audition_postings
                WHERE apply_end < :endedBefore
                   OR (apply_end IS NULL AND posted_on < :postedBefore)
                """)
                .setParameter("endedBefore", AuditionRules.deleteEndedBefore(today))
                .setParameter("postedBefore", AuditionRules.deletePostedBefore(today))
                .executeUpdate());
    }

    @Override
    public Optional<Instant> lastCollectedAt() {
        return list(entityManager.createNativeQuery(
                "SELECT max(last_seen_at) AS last_seen_at FROM audition_postings", Tuple.class))
                .stream().findFirst().map(row -> instant(row.get("last_seen_at")));
    }

    private static AuditionPosting posting(Tuple row) {
        return new AuditionPosting(
                row.get("source", String.class),
                row.get("source_ref", String.class),
                row.get("title", String.class),
                row.get("category", String.class),
                row.get("pay_text", String.class),
                date(row.get("apply_start")),
                date(row.get("apply_end")),
                row.get("status_text", String.class),
                date(row.get("posted_on")),
                row.get("source_url", String.class));
    }

    private static LocalDate date(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof LocalDate local) {
            return local;
        }
        if (value instanceof java.sql.Date sql) {
            return sql.toLocalDate();
        }
        throw new IllegalStateException("unexpected date type: " + value.getClass());
    }

    private static Instant instant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant();
        }
        throw new IllegalStateException("unexpected timestamp type: " + value.getClass());
    }
}
