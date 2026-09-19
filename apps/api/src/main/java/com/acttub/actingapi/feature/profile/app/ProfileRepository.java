package com.acttub.actingapi.feature.profile.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.NotificationSettings;
import com.acttub.actingapi.feature.profile.domain.Profile;

/**
 * profile 이 저장소에 요구하는 것.
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018). 없음을 404 로 옮기는 일은 서비스가 한다.
 *
 * <p><b>회원 자료를 쓰는 연산은 활성 계정에만 쓴다.</b> 쓰는 트랜잭션이 탈퇴와 같은 {@code users} 행을 잡고
 * 상태를 다시 본다 — 게이트를 지난 뒤에 다른 기기의 탈퇴가 끝났으면 쓰지 않고 "없음"과 같은 값을 돌려준다.
 * 어느 쪽인지(없음 404 · 닫힘 403)는 서비스가 그때 다시 읽어 가른다.
 */
public interface ProfileRepository {

    Account find(UUID userId);

    /**
     * 여섯 항목과 소개를 <b>한 번에</b> 저장한다. 부분 저장은 없다 — 방향도 같은 트랜잭션에서 통째로
     * 갈아 끼운다. 사진과 알림 토글은 건드리지 않는다. 없거나 계정이 활성이 아니면 {@code null}.
     */
    Account saveProfile(UUID userId, Profile profile);

    /**
     * 탈퇴 처리. 없으면 {@code null}.
     *
     * <p><b>상태 전환·개인정보 파기·토큰 폐기가 한 트랜잭션이어야 한다</b> — 그래서 이것들을
     * 서비스가 나눠 부르는 형태로 가르지 않고 연산 하나로 둔다. 나누면 중간 실패 시
     * "탈퇴했는데 refresh 는 살아 있는" 계정이 남는다.
     *
     * <p>바깥 호출(객체 삭제, 제공자 해제)은 여기서 하지 않는다. 거기 쓸 값을 파기 전에 정리 장부로
     * 옮겨 두기만 하고, 돌려준 식별자로 서비스가 트랜잭션 밖에서 시도한다.
     *
     * <p>이미 탈퇴한 계정이면 <b>최초 탈퇴 시각을 유지</b>하고 파기만 다시 돈다.
     *
     * @param destroyMediaRegardless 보관 동의와 무관하게 영상을 파기한다(만 14세 미만으로 드러난 회원)
     * @param today 한국 시간의 오늘 — 생년월일을 5세 단위 연령대로 뭉갤 때의 기준
     */
    Withdrawn withdraw(UUID userId, boolean destroyMediaRegardless, Instant now, LocalDate today);

    /**
     * @param deactivatedAt 최초 탈퇴 시각
     * @param cleanupOperationIds 이번에 장부에 올린 바깥 정리들
     */
    record Withdrawn(Instant deactivatedAt, List<UUID> cleanupOperationIds) {
    }

    /**
     * 만 14세 미만으로 드러난 가입 중의 계정을 닫는다.
     *
     * <p>아직 아무 자료도 없는 계정은 <b>행째 지운다</b> — 탈퇴와 달리 아무것도 남기지 않는다.
     * 법정대리인 동의 없이 아동의 정보를 들고 있지 않기 위해서다. 연습 같은 자료가 이미 있는
     * 1.0.0 이전 회원은 지울 수 없어(남의 화면에 얽힌 행이 깨진다) 탈퇴와 같은 절차로 닫고,
     * <b>보관 동의와 무관하게</b> 영상을 파기한다.
     *
     * @return 어느 쪽으로 닫았는가. 없는 사용자면 {@code null}
     */
    Closed closeUnderage(UUID userId, Instant now, LocalDate today);

    /** @param cleanupOperationIds 탈퇴와 같은 절차로 닫았을 때 장부에 올린 바깥 정리들. 행째 지웠으면 비어 있다 */
    record Closed(Closure closure, List<UUID> cleanupOperationIds) {
    }

    enum Closure {
        /** 계정의 모든 행을 지웠다. */
        ERASED,
        /** 자료가 있어 탈퇴와 같은 절차로 닫았다. */
        DEACTIVATED
    }

    // ---- 매일 도는 일 (AccountHousekeeping) ----

    /**
     * 마지막 활동이 {@code lastActiveBefore} 보다 앞선 <b>활성</b> 게스트. 옮겨진 게스트는 이미 닫혀 있어
     * 고르지 않는다. 마지막 활동은 가입·토큰 발급(갱신)·올리기·연습 가운데 가장 늦은 시각이다 — 액세스 토큰이
     * 30분이라 웹을 쓰는 동안에는 토큰 발급이 계속 찍힌다.
     */
    List<UUID> idleGuests(Instant lastActiveBefore);

    /**
     * 탈퇴한 지 오래된({@code deactivatedBefore} 보다 앞선) 계정의 남은 것을 파기한다 — 신원의 해시 행을
     * 지우고, 보관 동의로 남겨 두었던 영상 객체의 삭제를 정리 장부에 올린다. 한 트랜잭션이다. 해시 행이
     * 있든 없든(제공자의 연결 끊기로 신원이 먼저 지워진 회원) 고르고, 파기를 마친 시각을 적어 한 번 파기한
     * 계정은 다시 고르지 않는다.
     *
     * @return 장부에 올린 객체 삭제들. 부르는 쪽이 트랜잭션 밖에서 시도한다
     */
    List<UUID> purgeRetained(Instant deactivatedBefore, Instant now);

    /** 만료되거나 폐기된 지 오래된 리프레시 토큰 행을 지운다. 그 전까지는 재사용 탐지와 문제 추적에 쓴다. */
    int deleteStaleRefreshTokens(Instant before);

    /**
     * 쓰였거나 시한이 지난 지 오래된 이관 코드 행을 지운다. ⚠ 쓰인 코드는 "이 게스트는 옮겨졌다"는 표식이라
     * 그 게스트의 리프레시 토큰이 살 수 있는 동안(30일)에는 지우면 안 된다.
     */
    int deleteStaleTransferCodes(Instant before);

    /** 알림 토글 셋. 프로필 행이 없으면 {@code null}. */
    NotificationSettings notificationSettings(UUID userId);

    /**
     * 보낸 토글만 바꾼다({@code null} 은 그대로 둔다). 분석 완료와 챌린지가 <b>둘 다</b> 꺼지면 같은
     * 트랜잭션에서 그 회원의 푸시 토큰을 전부 지운다 — 토글은 회원 단위라 기기마다가 아니다.
     *
     * @return 바꾼 뒤의 토글 셋. 프로필 행이 없거나 계정이 활성이 아니면 {@code null}
     */
    NotificationSettings updateNotificationSettings(
            UUID userId, Boolean analysisDone, Boolean challenge, Boolean eveningReminder);

    /**
     * 새로 받은 올리기 자리를 적는다. 앞의 대기 중인 올리기는 덮어쓰되, 그 객체의 삭제를 같은 트랜잭션에서
     * 정리 장부에 올린다(그 주소의 시한 뒤에 지운다) — 덮기만 하면 올리다 만 객체의 키를 아는 곳이 없어진다.
     * 프로필 행이 없거나 계정이 활성이 아니면 {@code false}.
     */
    boolean beginPhotoUpload(UUID userId, PhotoUpload upload, Instant now);

    /** 대기 중인 올리기. 없으면 {@code null}. */
    PhotoUpload pendingPhotoUpload(UUID userId);

    /**
     * 대기 중인 올리기를 프로필 사진으로 바꾼다. 바뀌기 전 사진의 객체 삭제는 같은 트랜잭션에서 정리 장부에
     * 올린다 — 커밋 뒤에 저장소가 실패해도 키를 잃지 않는다.
     *
     * @return 장부에 올린 객체 삭제들(없었으면 빈 목록). 부르는 쪽이 트랜잭션 밖에서 시도한다. 계정이 활성이
     *         아니면 {@code null}
     */
    List<UUID> completePhotoUpload(UUID userId, String objectKey, Instant now);

    /** 사진을 뗀다. 돌려주는 값은 {@link #completePhotoUpload} 와 같다. */
    List<UUID> clearPhoto(UUID userId, Instant now);

    record PhotoUpload(String objectKey, String mimeType, long sizeBytes, Instant expiresAt) {
    }
}
