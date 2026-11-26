package com.acttub.actingapi.feature.poster.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.poster.schema.AppPosterEntity;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code app_posters} 를 읽고 쓰는 문장. {@code (slug, locale)} 을 다투는 넣기·고치기는 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface AppPosterJpaRepository extends Repository<AppPosterEntity, UUID> {

    // 플랫폼 거르기는 native 의 `:platform = ANY(platforms)` 와 같은 행을 고른다. HQL 에는 `= any(배열)` 이 없고
    // (`any(…)` 는 bool_or 집계로 풀린다), `array_contains` 는 매개변수를 varchar 배열로 감싸 `text[] @> varchar[]` 연산자가
    // 없다고 실패한다. 칸에 NULL 원소가 없어(ck_app_posters_platforms) 위치가 0 보다 큰지로 본다.

    @Query("""
            select p from AppPosterEntity p
            where p.active
              and (p.startsAt is null or p.startsAt <= :now)
              and (p.endsAt is null or p.endsAt > :now)
              and array_position(p.platforms, :platform) > 0
              and (p.locale is null or p.locale = :locale)
            order by p.priority desc, p.updatedAt desc, p.id
            """)
    List<AppPosterEntity> live(String platform, String locale, Instant now);

    @Query("""
            select p from AppPosterEntity p
            where (p.startsAt is null or p.startsAt <= :now)
              and array_position(p.platforms, :platform) > 0
              and (p.locale is null or p.locale = :locale)
            order by coalesce(p.startsAt, p.createdAt) desc, p.id
            """)
    List<AppPosterEntity> history(String platform, String locale, Instant now, Limit limit);

    @Query("select p from AppPosterEntity p order by p.active desc, p.priority desc, p.updatedAt desc, p.id")
    List<AppPosterEntity> all();

    @Query("select p from AppPosterEntity p where p.id = :id")
    Optional<AppPosterEntity> find(UUID id);

    /**
     * 대상 없는 {@code ON CONFLICT DO NOTHING} — 표현식 유니크 인덱스 {@code (slug, COALESCE(locale,''))} 와 겹치면 0행이다.
     * 함께 넣는 다른 트랜잭션이 있으면 그 커밋을 기다렸다가 판정한다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into AppPosterEntity (id, slug, revision, active, priority, startsAt, endsAt, platforms, locale,
                                         minAppVersion, frequency, audience, dismissible, badge, title, body, image,
                                         audio, ctaLabel, ctaAction, ctaTarget, footnote, imageBg, createdAt, updatedAt)
            values (:id, :slug, 1, :active, :priority, :startsAt, :endsAt, :platforms, :locale,
                    :minAppVersion, :frequency, :audience, :dismissible, :badge, :title, :body, :image,
                    :audio, :ctaLabel, :ctaAction, :ctaTarget, :footnote, :imageBg, :now, :now)
            on conflict do nothing
            """)
    int insertUnlessTaken(UUID id, String slug, boolean active, int priority, Instant startsAt, Instant endsAt,
            String[] platforms, String locale, String minAppVersion, String frequency, String audience,
            boolean dismissible, String badge, String title, String body, String image, String audio, String ctaLabel,
            String ctaAction, String ctaTarget, String footnote, String imageBg, Instant now);

    /**
     * 다른 포스터가 같은 {@code (slug, locale)}(언어 없음끼리도 같다)을 쓰면 0행이다. revision 은 열 값에 더해 올리므로 함께
     * 올리는 두 요청이 모두 센다. NOT EXISTS 는 문장 시작의 스냅숏으로 보므로, 함께 같은 값으로 바꾸는 두 트랜잭션은 둘 다
     * 지나고 뒤의 것은 {@code uq_app_posters_slug_locale} 에서 막힌다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update AppPosterEntity p
            set p.slug = :slug, p.revision = p.revision + case when :bump = true then 1 else 0 end, p.active = :active,
                p.priority = :priority, p.startsAt = :startsAt, p.endsAt = :endsAt, p.platforms = :platforms,
                p.locale = :locale, p.minAppVersion = :minAppVersion, p.frequency = :frequency,
                p.audience = :audience, p.dismissible = :dismissible, p.badge = :badge, p.title = :title,
                p.body = :body, p.image = :image, p.audio = :audio, p.ctaLabel = :ctaLabel,
                p.ctaAction = :ctaAction, p.ctaTarget = :ctaTarget, p.footnote = :footnote, p.imageBg = :imageBg,
                p.updatedAt = :now
            where p.id = :id
              and not exists (select 1 from AppPosterEntity o
                              where o.id <> :id and o.slug = :slug
                                and coalesce(o.locale, '') = coalesce(:locale, ''))
            """)
    int updateUnlessTaken(UUID id, boolean bump, String slug, boolean active, int priority, Instant startsAt,
            Instant endsAt, String[] platforms, String locale, String minAppVersion, String frequency, String audience,
            boolean dismissible, String badge, String title, String body, String image, String audio, String ctaLabel,
            String ctaAction, String ctaTarget, String footnote, String imageBg, Instant now);
}
