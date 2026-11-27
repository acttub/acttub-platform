package com.acttub.actingapi.feature.practice.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code deleted_practice_videos}(V85) — 지운 연습에서 보관 동의로 남긴 영상 한 편과 원래 주인. 기본 키가 영상 id 라 한 영상은 한
 * 줄이다. 넣기({@code on conflict (video_id) do nothing})와 지우기는 HQL 이고, 파기할 줄을 고르는 잠금 조회는 영상 행을 함께 잠가
 * native 다.
 */
@Entity
@Table(name = "deleted_practice_videos")
public class DeletedPracticeVideoEntity {

    @Id
    @Column(name = "video_id", nullable = false)
    private UUID videoId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "deleted_at", nullable = false)
    private Instant deletedAt;

    protected DeletedPracticeVideoEntity() {
    }
}
