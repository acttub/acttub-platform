package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.schema.CoachNoteEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code coach_notes} 를 읽고 쓰는 문장. 읽기는 대화 행({@code coach_conversations})을 조인해 회차로도 찾는다. */
interface CoachNoteJpaRepository extends Repository<CoachNoteEntity, UUID> {

    String COLUMNS = """
            select n.id as id, n.conversationId as conversationId, n.format as format, n.kind as kind, n.title as title,
                   n.summaryQuotes as summaryQuotes, n.nextTake as nextTake, n.actorWords as actorWords,
                   n.corrections as corrections, n.tags as tags, n.fallback as fallback,
                   n.sourceRevision as sourceRevision, n.legacyReport as legacyReport, n.createdAt as createdAt,
                   n.lineNotes as lineNotes
            from CoachNoteEntity n
            join CoachConversationEntity c on c.id = n.conversationId
            """;

    @Query(COLUMNS + " where n.conversationId = :conversationId")
    Optional<Stored> ofConversation(UUID conversationId);

    /** 연습 화면이 싣는 노트 — 한 문장이다. */
    @Query(COLUMNS + " where c.practiceId = :practiceId")
    Optional<Stored> ofPractice(UUID practiceId);

    /** jsonb 칸은 저장된 글 그대로 온다(SQL NULL 은 {@code null}, JSON null 은 글자 {@code null}). */
    interface Stored {
        UUID getId();

        UUID getConversationId();

        String getFormat();

        String getKind();

        String getTitle();

        String getSummaryQuotes();

        String getNextTake();

        String getActorWords();

        String getCorrections();

        String getTags();

        boolean getFallback();

        int getSourceRevision();

        String getLegacyReport();

        Instant getCreatedAt();

        String getLineNotes();
    }

    /** 노트를 한 번 만든다. 이미 있으면 넣지 않는다(0). 대사별 메모는 DB 기본값([])이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into CoachNoteEntity (id, conversationId, format, kind, title, summaryQuotes, nextTake, actorWords,
                                         corrections, tags, fallback, sourceRevision, legacyReport, createdAt)
            values (:id, :conversationId, :format, :kind, :title, :summaryQuotes, :nextTake, :actorWords,
                    :corrections, :tags, :fallback, :sourceRevision, :legacyReport, :now)
            on conflict (conversationId) do nothing
            """)
    int insert(UUID id, UUID conversationId, String format, String kind, String title, String summaryQuotes,
            String nextTake, String actorWords, String corrections, String tags, boolean fallback, int sourceRevision,
            String legacyReport, Instant now);

    /** 있으면 같은 줄(id·만든 시각은 그대로)을 새 내용으로 고치고 대사별 메모를 비운다. 없으면 만든다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into CoachNoteEntity (id, conversationId, format, kind, title, summaryQuotes, nextTake, actorWords,
                                         corrections, tags, fallback, sourceRevision, legacyReport, createdAt)
            values (:id, :conversationId, :format, :kind, :title, :summaryQuotes, :nextTake, :actorWords,
                    :corrections, :tags, :fallback, :sourceRevision, :legacyReport, :now)
            on conflict (conversationId) do update set
                format = excluded.format, kind = excluded.kind, title = excluded.title,
                summaryQuotes = excluded.summaryQuotes, nextTake = excluded.nextTake,
                actorWords = excluded.actorWords, corrections = excluded.corrections, tags = excluded.tags,
                fallback = excluded.fallback, sourceRevision = excluded.sourceRevision,
                legacyReport = excluded.legacyReport, lineNotes = '[]'
            """)
    int upsert(UUID id, UUID conversationId, String format, String kind, String title, String summaryQuotes,
            String nextTake, String actorWords, String corrections, String tags, boolean fallback, int sourceRevision,
            String legacyReport, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CoachNoteEntity n set n.lineNotes = :lineNotes where n.conversationId = :conversationId")
    int saveLineNotes(UUID conversationId, String lineNotes);
}
