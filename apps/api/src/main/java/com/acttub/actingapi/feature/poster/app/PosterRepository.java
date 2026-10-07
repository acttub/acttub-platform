package com.acttub.actingapi.feature.poster.app;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.poster.domain.Poster;
import com.acttub.actingapi.feature.poster.domain.PosterDraft;

/** 포스터를 두는 곳. {@code (slug, locale)} 은 언어 없음(null)까지 포함해 유일하다. */
public interface PosterRepository {

    /**
     * 켜져 있고 {@code now} 가 기간 안이며 플랫폼이 맞고 언어가 없거나 같은 것을 우선순위 큰 것, 최근에 고친 것 순으로.
     * {@code locale} 이 {@code null} 이면 언어 없는 것만이다.
     */
    List<Poster> live(String platform, String locale, Instant now);

    /** 꺼진 것까지 전부. 켜진 것, 우선순위 큰 것, 최근에 고친 것 순. */
    List<Poster> all();

    Optional<Poster> find(UUID id);

    /** 같은 {@code (slug, locale)} 이 이미 있으면 비어 있다. */
    Optional<Poster> insert(PosterDraft draft, Instant now);

    /**
     * 값을 통째로 바꾸고 {@code updated_at} 을 {@code now} 로 둔다. {@code bumpRevision} 이면 revision 을 하나 올린다.
     * 바꾼 {@code (slug, locale)} 이 다른 포스터와 겹치면 비어 있다.
     */
    Optional<Poster> update(UUID id, PosterDraft draft, boolean bumpRevision, Instant now);
}
