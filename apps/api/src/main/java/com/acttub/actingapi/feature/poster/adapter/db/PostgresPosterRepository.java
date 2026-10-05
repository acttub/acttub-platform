package com.acttub.actingapi.feature.poster.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.poster.app.PosterRepository;
import com.acttub.actingapi.feature.poster.domain.Poster;
import com.acttub.actingapi.feature.poster.domain.PosterDraft;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공지 포스터의 Postgres 구현 — {@code app_posters}(V29). 행이 적고 플랫폼이 배열 칸이라 Schema Entity 없이 native SQL
 * 로만 읽고 쓴다(CONTRACT §5-1, EntityMappingIT 의 대기 목록).
 *
 * <p>{@code (slug, COALESCE(locale,''))} 유일은 DB 가 판정한다 — 만들기는 {@code ON CONFLICT DO NOTHING} 의 0행,
 * 고치기는 겹치는 다른 행이 있으면 갱신하지 않는 조건의 0행으로 "이미 있다" 를 안다.
 */
@Repository
class PostgresPosterRepository implements PosterRepository {

    private static final String COLUMNS = """
            id,slug,revision,active,priority,starts_at,ends_at,array_to_string(platforms,',') AS platforms,locale,
            min_app_version,frequency,audience,dismissible,badge,title,body,image,audio,cta_label,cta_action,cta_target,
            created_at,updated_at""";

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresPosterRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<Poster> live(String platform, String locale, Instant now) {
        return list(entityManager.createNativeQuery("SELECT " + COLUMNS + """
                 FROM app_posters
                WHERE active
                  AND (starts_at IS NULL OR starts_at <= :now)
                  AND (ends_at IS NULL OR ends_at > :now)
                  AND :platform = ANY(platforms)
                  AND (locale IS NULL OR locale = CAST(:locale AS text))
                ORDER BY priority DESC, updated_at DESC, id
                """, Tuple.class)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("platform", platform)
                .setParameter("locale", locale))
                .stream().map(PostgresPosterRepository::poster).toList();
    }

    @Override
    public List<Poster> all() {
        return list(entityManager.createNativeQuery("SELECT " + COLUMNS
                + " FROM app_posters ORDER BY active DESC, priority DESC, updated_at DESC, id", Tuple.class))
                .stream().map(PostgresPosterRepository::poster).toList();
    }

    @Override
    public Optional<Poster> find(UUID id) {
        return list(entityManager.createNativeQuery("SELECT " + COLUMNS + " FROM app_posters WHERE id=:id", Tuple.class)
                .setParameter("id", id))
                .stream().findFirst().map(PostgresPosterRepository::poster);
    }

    @Override
    public Optional<Poster> insert(PosterDraft draft, Instant now) {
        return transaction.execute(tx -> bind(entityManager.createNativeQuery("""
                WITH inserted AS (
                    INSERT INTO app_posters(id,slug,revision,active,priority,starts_at,ends_at,platforms,locale,
                                            min_app_version,frequency,audience,dismissible,badge,title,body,image,audio,
                                            cta_label,cta_action,cta_target,created_at,updated_at)
                    VALUES (:id,:slug,1,:active,:priority,CAST(:startsAt AS timestamptz),CAST(:endsAt AS timestamptz),
                            CAST(:platforms AS text[]),CAST(:locale AS text),CAST(:minAppVersion AS text),:frequency,
                            :audience,:dismissible,CAST(:badge AS text),:title,CAST(:body AS text),CAST(:image AS text),
                            CAST(:audio AS text),CAST(:ctaLabel AS text),:ctaAction,CAST(:ctaTarget AS text),:now,:now)
                    ON CONFLICT DO NOTHING
                    RETURNING *
                )
                """ + "SELECT " + COLUMNS + " FROM inserted", Tuple.class), draft, now)
                .setParameter("id", UUID.randomUUID())
                .getResultStream().findFirst().map(row -> poster((Tuple) row)));
    }

    @Override
    public Optional<Poster> update(UUID id, PosterDraft draft, boolean bumpRevision, Instant now) {
        return transaction.execute(tx -> bind(entityManager.createNativeQuery("""
                WITH updated AS (
                    UPDATE app_posters
                    SET slug=:slug,revision=revision + CASE WHEN :bump THEN 1 ELSE 0 END,active=:active,
                        priority=:priority,starts_at=CAST(:startsAt AS timestamptz),ends_at=CAST(:endsAt AS timestamptz),
                        platforms=CAST(:platforms AS text[]),locale=CAST(:locale AS text),
                        min_app_version=CAST(:minAppVersion AS text),frequency=:frequency,audience=:audience,
                        dismissible=:dismissible,badge=CAST(:badge AS text),title=:title,body=CAST(:body AS text),
                        image=CAST(:image AS text),audio=CAST(:audio AS text),cta_label=CAST(:ctaLabel AS text),
                        cta_action=:ctaAction,cta_target=CAST(:ctaTarget AS text),updated_at=:now
                    WHERE id=:id
                      AND NOT EXISTS (SELECT 1 FROM app_posters other
                                      WHERE other.id<>:id AND other.slug=:slug
                                        AND COALESCE(other.locale,'')=COALESCE(CAST(:locale AS text),''))
                    RETURNING *
                )
                """ + "SELECT " + COLUMNS + " FROM updated", Tuple.class), draft, now)
                .setParameter("id", id)
                .setParameter("bump", bumpRevision)
                .getResultStream().findFirst().map(row -> poster((Tuple) row)));
    }

    private static Query bind(Query query, PosterDraft draft, Instant now) {
        return query
                .setParameter("slug", draft.slug())
                .setParameter("active", draft.active())
                .setParameter("priority", draft.priority())
                .setParameter("startsAt", utc(draft.startsAt()))
                .setParameter("endsAt", utc(draft.endsAt()))
                .setParameter("platforms", "{" + String.join(",", draft.platforms()) + "}")
                .setParameter("locale", draft.locale())
                .setParameter("minAppVersion", draft.minAppVersion())
                .setParameter("frequency", draft.frequency())
                .setParameter("audience", draft.audience())
                .setParameter("dismissible", draft.dismissible())
                .setParameter("badge", draft.badge())
                .setParameter("title", draft.title())
                .setParameter("body", draft.body())
                .setParameter("image", draft.image())
                .setParameter("audio", draft.audio())
                .setParameter("ctaLabel", draft.ctaLabel())
                .setParameter("ctaAction", draft.ctaAction())
                .setParameter("ctaTarget", draft.ctaTarget())
                .setParameter("now", now.atOffset(ZoneOffset.UTC));
    }

    private static OffsetDateTime utc(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
    }

    private static Poster poster(Tuple row) {
        String platforms = row.get("platforms", String.class);
        PosterDraft draft = new PosterDraft(
                row.get("slug", String.class),
                row.get("active", Boolean.class),
                row.get("priority", Integer.class),
                instant(row, "starts_at"),
                instant(row, "ends_at"),
                platforms == null || platforms.isEmpty() ? List.of() : Arrays.asList(platforms.split(",")),
                row.get("locale", String.class),
                row.get("min_app_version", String.class),
                row.get("frequency", String.class),
                row.get("audience", String.class),
                row.get("dismissible", Boolean.class),
                row.get("badge", String.class),
                row.get("title", String.class),
                row.get("body", String.class),
                row.get("image", String.class),
                row.get("audio", String.class),
                row.get("cta_label", String.class),
                row.get("cta_action", String.class),
                row.get("cta_target", String.class));
        return new Poster(row.get("id", UUID.class), row.get("revision", Integer.class), draft,
                instant(row, "created_at"), instant(row, "updated_at"));
    }

    private static Instant instant(Tuple row, String alias) {
        Object value = row.get(alias);
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
        throw new IllegalStateException("unexpected timestamp type for " + alias + ": " + value.getClass());
    }
}
