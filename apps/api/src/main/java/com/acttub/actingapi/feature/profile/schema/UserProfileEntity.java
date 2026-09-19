package com.acttub.actingapi.feature.profile.schema;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ActingExperience;
import com.acttub.actingapi.platform.schema.ActingGoal;
import com.acttub.actingapi.platform.schema.ProfileGender;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code user_profiles} — 회원당 하나. PK 가 {@code user_id} 로 <b>FK 겸 PK</b> 다
 * ({@code HandoffConfirmationEntity} 와 같은 형태, apps/api/CONTRACT.md §5-3-2).
 *
 * <p>필수 여섯 항목의 컬럼이 NULL 을 허용한다. 1.0.0 이전 회원은 옛 닉네임만 {@code name} 에
 * 들고 오고, 다 채웠는지는 게이트가 요청마다 판정한다. 추구하는 방향은 복수 선택이라
 * {@link UserProfileDirectionEntity} 에 따로 있다.
 *
 * <p>알림 토글 셋의 DB 기본값은 켜짐이다. JPA 는 필드 값을 항상 INSERT 에 싣으므로 같은 값을
 * 초기화값으로 둔다 (apps/api/CONTRACT.md §5-3-3).
 */
@Entity
@Table(name = "user_profiles")
public class UserProfileEntity {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "name")
    private String name;

    @Convert(converter = ProfileGender.JpaConverter.class)
    @Column(name = "gender", columnDefinition = "text")
    private ProfileGender gender;

    @Column(name = "birth_date")
    private LocalDate birthDate;

    @Convert(converter = ActingExperience.JpaConverter.class)
    @Column(name = "experience", columnDefinition = "text")
    private ActingExperience experience;

    @Convert(converter = ActingGoal.JpaConverter.class)
    @Column(name = "goal", columnDefinition = "text")
    private ActingGoal goal;

    @Column(name = "photo_key")
    private String photoKey;

    @Column(name = "bio")
    private String bio;

    /** 탈퇴 때 생년월일을 뭉갠 5세 단위 연령대. 구간의 아래 끝이다(25 = 만 25~29세). */
    @Column(name = "age_band")
    private Integer ageBand;

    @Column(name = "notify_analysis_done", nullable = false)
    private boolean notifyAnalysisDone = true;

    @Column(name = "notify_challenge", nullable = false)
    private boolean notifyChallenge = true;

    @Column(name = "notify_evening_reminder", nullable = false)
    private boolean notifyEveningReminder = true;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected UserProfileEntity() {
    }

    public UserProfileEntity(
            UUID userId,
            String name,
            ProfileGender gender,
            LocalDate birthDate,
            ActingExperience experience,
            ActingGoal goal) {
        this.userId = userId;
        this.name = name;
        this.gender = gender;
        this.birthDate = birthDate;
        this.experience = experience;
        this.goal = goal;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getName() {
        return name;
    }

    public ProfileGender getGender() {
        return gender;
    }

    public LocalDate getBirthDate() {
        return birthDate;
    }

    public ActingExperience getExperience() {
        return experience;
    }

    public ActingGoal getGoal() {
        return goal;
    }

    public String getPhotoKey() {
        return photoKey;
    }

    public String getBio() {
        return bio;
    }

    public Integer getAgeBand() {
        return ageBand;
    }

    public boolean isNotifyAnalysisDone() {
        return notifyAnalysisDone;
    }

    public boolean isNotifyChallenge() {
        return notifyChallenge;
    }

    public boolean isNotifyEveningReminder() {
        return notifyEveningReminder;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
