package com.acttub.actingapi.feature.video.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.video.schema.VideoTranscriptEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code video_transcripts} 를 지우는 문장(apps/api/CONTRACT.md §5-9). 넣기는 분석 저장소의 native SQL 이다. */
interface VideoTranscriptJpaRepository extends Repository<VideoTranscriptEntity, UUID> {

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from VideoTranscriptEntity t where t.videoId = :videoId")
    int deleteByVideo(UUID videoId);
}
