package com.acttub.actingapi.feature.poster.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.poster.app.PosterRepository;
import com.acttub.actingapi.feature.poster.domain.Poster;
import com.acttub.actingapi.feature.poster.domain.PosterDraft;
import com.acttub.actingapi.feature.poster.schema.AppPosterEntity;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공지 포스터의 Postgres 구현 — {@code app_posters}(V29).
 *
 * <p>{@code (slug, COALESCE(locale,''))} 유일은 DB 가 판정한다 — 만들기는 {@code ON CONFLICT DO NOTHING} 의 0행,
 * 고치기는 겹치는 다른 행이 있으면 갱신하지 않는 조건의 0행으로 "이미 있다" 를 안다. HQL 에 {@code RETURNING} 이 없어 영향 행
 * 수가 1 이면 같은 트랜잭션에서 id 로 다시 읽는다. 쓴 행은 이 트랜잭션이 커밋까지 잡고 있어 읽은 값은 방금 쓴 값이다. 0 이면
 * 다시 읽지 않는다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresPosterRepository implements PosterRepository {

    private final AppPosterJpaRepository posters;
    private final TransactionTemplate transaction;

    PostgresPosterRepository(AppPosterJpaRepository posters, PlatformTransactionManager transactionManager) {
        this.posters = posters;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<Poster> live(String platform, String locale, Instant now) {
        return posters.live(platform, locale, now).stream().map(PostgresPosterRepository::poster).toList();
    }

    @Override
    public List<Poster> history(String platform, String locale, Instant now, int limit) {
        return posters.history(platform, locale, now, Limit.of(limit)).stream()
                .map(PostgresPosterRepository::poster).toList();
    }

    @Override
    public List<Poster> all() {
        return posters.all().stream().map(PostgresPosterRepository::poster).toList();
    }

    @Override
    public Optional<Poster> find(UUID id) {
        return posters.find(id).map(PostgresPosterRepository::poster);
    }

    @Override
    public Optional<Poster> insert(PosterDraft draft, Instant now) {
        UUID id = UUID.randomUUID();
        return transaction.execute(tx -> posters.insertUnlessTaken(id, draft.slug(), draft.active(), draft.priority(),
                draft.startsAt(), draft.endsAt(), platforms(draft), draft.locale(), draft.minAppVersion(),
                draft.frequency(), draft.audience(), draft.dismissible(), draft.badge(), draft.title(), draft.body(),
                draft.image(), draft.audio(), draft.ctaLabel(), draft.ctaAction(), draft.ctaTarget(), draft.footnote(),
                draft.imageBg(), now) == 0 ? Optional.<Poster>empty() : find(id));
    }

    @Override
    public Optional<Poster> update(UUID id, PosterDraft draft, boolean bumpRevision, Instant now) {
        return transaction.execute(tx -> posters.updateUnlessTaken(id, bumpRevision, draft.slug(), draft.active(),
                draft.priority(), draft.startsAt(), draft.endsAt(), platforms(draft), draft.locale(),
                draft.minAppVersion(), draft.frequency(), draft.audience(), draft.dismissible(), draft.badge(),
                draft.title(), draft.body(), draft.image(), draft.audio(), draft.ctaLabel(), draft.ctaAction(),
                draft.ctaTarget(), draft.footnote(), draft.imageBg(), now) == 0 ? Optional.<Poster>empty() : find(id));
    }

    private static String[] platforms(PosterDraft draft) {
        return draft.platforms().toArray(String[]::new);
    }

    private static Poster poster(AppPosterEntity row) {
        PosterDraft draft = new PosterDraft(row.getSlug(), row.isActive(), row.getPriority(), row.getStartsAt(),
                row.getEndsAt(), List.of(row.getPlatforms()), row.getLocale(), row.getMinAppVersion(),
                row.getFrequency(), row.getAudience(), row.isDismissible(), row.getBadge(), row.getTitle(),
                row.getBody(), row.getImage(), row.getAudio(), row.getCtaLabel(), row.getCtaAction(),
                row.getCtaTarget(), row.getFootnote(), row.getImageBg());
        return new Poster(row.getId(), row.getRevision(), draft, row.getCreatedAt(), row.getUpdatedAt());
    }
}
