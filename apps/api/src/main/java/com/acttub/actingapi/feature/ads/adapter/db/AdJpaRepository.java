package com.acttub.actingapi.feature.ads.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.schema.AdEntity;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code ads}·{@code ad_events} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface AdJpaRepository extends Repository<AdEntity, UUID> {

    /** 운영 화면이 읽는 광고 한 건과 지금까지 노출·클릭 합계. */
    record StoredRow(AdEntity ad, long impressions, long clicks) {
    }

    /** 날짜 하루의 노출·클릭 수. */
    record DayRow(LocalDate day, long impressions, long clicks) {
    }

    // 칸 거르기는 native 의 `:slot = ANY(slots)` 와 같은 행을 고른다. HQL 에는 `= any(배열)` 이 없고, `array_contains` 는
    // 매개변수를 varchar 배열로 감싸 `text[] @> varchar[]` 연산자가 없다고 실패한다. 칸 값은 AdRules 가 아는 칸 이름만 받아
    // NULL 원소가 없으므로 위치가 0 보다 큰지로 본다(AppPosterJpaRepository 와 같다).

    @Query("""
            select a from AdEntity a
            where a.status = 'active' and a.kind in ('direct', 'house')
              and array_position(a.slots, :slot) > 0
              and (a.startsAt is null or a.startsAt <= :now)
              and (a.endsAt is null or a.endsAt > :now)
            order by a.priority desc, a.id
            """)
    List<AdEntity> activeFor(String slot, Instant now, Limit limit);

    @Query("select a from AdEntity a where a.id = :id")
    Optional<AdEntity> find(UUID id);

    // 켜진 것을 앞에 두는 native 의 `(status='active') DESC` 는 HQL 이 정렬 식으로 받지 않아 case 로 쓴다. status 는 NOT NULL
    // 이라 순서가 같다.

    @Query("""
            select new com.acttub.actingapi.feature.ads.adapter.db.AdJpaRepository$StoredRow(a,
                   (select count(*) from AdEventEntity e where e.adId = a.id and e.event = 'impression'),
                   (select count(*) from AdEventEntity e where e.adId = a.id and e.event = 'click'))
            from AdEntity a
            order by case when a.status = 'active' then 0 else 1 end, a.priority desc, a.createdAt desc, a.id
            """)
    List<StoredRow> all();

    @Query("""
            select new com.acttub.actingapi.feature.ads.adapter.db.AdJpaRepository$StoredRow(a,
                   (select count(*) from AdEventEntity e where e.adId = a.id and e.event = 'impression'),
                   (select count(*) from AdEventEntity e where e.adId = a.id and e.event = 'click'))
            from AdEntity a
            where a.id = :id
            """)
    Optional<StoredRow> findStored(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into AdEntity (id, kind, status, slots, audience, priority, advertiserName, headline, body,
                                  imageLargeBanner, imageBanner, imageMediumRectangle, linkUrl, appPath, sharePercent,
                                  startsAt, endsAt, createdAt, updatedAt)
            values (:id, :kind, :status, :slots, :audience, :priority, :advertiserName, :headline, :body,
                    :imageLargeBanner, :imageBanner, :imageMediumRectangle, :linkUrl, :appPath, :sharePercent,
                    :startsAt, :endsAt, :now, :now)
            """)
    int insert(UUID id, String kind, String status, String[] slots, String audience, int priority,
            String advertiserName, String headline, String body, String imageLargeBanner, String imageBanner,
            String imageMediumRectangle, String linkUrl, String appPath, int sharePercent, Instant startsAt,
            Instant endsAt, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update AdEntity a
            set a.kind = :kind, a.status = :status, a.slots = :slots, a.audience = :audience, a.priority = :priority,
                a.advertiserName = :advertiserName, a.headline = :headline, a.body = :body,
                a.imageLargeBanner = :imageLargeBanner, a.imageBanner = :imageBanner,
                a.imageMediumRectangle = :imageMediumRectangle, a.linkUrl = :linkUrl, a.appPath = :appPath,
                a.sharePercent = :sharePercent, a.startsAt = :startsAt, a.endsAt = :endsAt, a.updatedAt = :now
            where a.id = :id
            """)
    int update(UUID id, String kind, String status, String[] slots, String audience, int priority,
            String advertiserName, String headline, String body, String imageLargeBanner, String imageBanner,
            String imageMediumRectangle, String linkUrl, String appPath, int sharePercent, Instant startsAt,
            Instant endsAt, Instant now);

    /**
     * 노출은 한 사람·광고·날짜에 한 번이다. native 는 대상을 부분 유니크 인덱스({@code (ad_id,user_id,day) WHERE
     * event='impression'})로 적었는데 HQL 의 conflict 대상에는 WHERE 가 없어 대상 없는 {@code ON CONFLICT DO NOTHING} 으로
     * 쓴다. 이 표의 다른 유니크는 앱이 새로 만든 id 의 기본 키뿐이라 0행이 되는 경우가 같다. 함께 남기는 다른 트랜잭션이 있으면
     * 그 커밋을 기다렸다가 판정한다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into AdEventEntity (id, adId, userId, slot, event, day, createdAt)
            values (:id, :adId, :userId, :slot, 'impression', :day, :now)
            on conflict do nothing
            """)
    int insertImpression(UUID id, UUID adId, UUID userId, String slot, LocalDate day, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into AdEventEntity (id, adId, userId, slot, event, day, createdAt)
            values (:id, :adId, :userId, :slot, 'click', :day, :now)
            """)
    int insertClick(UUID id, UUID adId, UUID userId, String slot, LocalDate day, Instant now);

    @Query("""
            select new com.acttub.actingapi.feature.ads.adapter.db.AdJpaRepository$DayRow(e.day,
                   count(*) filter (where e.event = 'impression'),
                   count(*) filter (where e.event = 'click'))
            from AdEventEntity e
            where e.adId = :adId and e.day between :from and :to
            group by e.day
            order by e.day
            """)
    List<DayRow> dailyEvents(UUID adId, LocalDate from, LocalDate to);
}
