package com.acttub.actingapi.feature.reading.app;

import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.reading.domain.ReadingExample;

/** 예시 대본({@code reading_examples}, V61)과 그 사람의 같은 글 대본을 찾는 자리. */
public interface ReadingExampleRepository {

    /** 켜진 예시를 sort_order 순으로. */
    List<ReadingExample> listActive();

    /** 켜진 예시 하나. 없거나 꺼졌으면 {@code null}. */
    ReadingExample findActive(String id);

    /** 그 사람의 대본 가운데 원문 해시가 같은 가장 오래된 것. 없으면 {@code null}. */
    UUID sameText(UUID userId, String rawHash);

    /** 그 사람의 대본의 원문 해시({@code scripts.raw_hash}). 없거나 남의 것이면 {@code null}. */
    String rawHash(UUID userId, UUID scriptId);

    /**
     * 그 사람의 {@code users} 행을 잡은 채 {@code work} 를 한 트랜잭션으로 한다 — 같은 글 확인과 복사 사이에 다른 요청이 끼어
     * 대본이 둘 생기지 않는다. 대본 저장({@link ScriptRepository#create})이 이 트랜잭션에 참여한다.
     */
    <T> T withOwnerLock(UUID userId, Supplier<T> work);
}
