package com.acttub.actingapi.feature.profile.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.domain.Account;
import com.acttub.actingapi.feature.profile.domain.Profile;

/**
 * profile 이 저장소에 요구하는 것.
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018) — "그 사용자가 없다" 하나뿐이다. 없음을 404 로 옮기는
 * 일은 서비스가 한다.
 */
public interface ProfileRepository {

    Account find(UUID userId);

    /**
     * 여섯 항목과 소개를 <b>한 번에</b> 저장한다. 부분 저장은 없다 — 방향도 같은 트랜잭션에서 통째로
     * 갈아 끼운다. 사진과 알림 토글은 건드리지 않는다. 없으면 {@code null}.
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

    /** 새로 받은 올리기 자리를 적는다. 앞의 대기 중인 올리기는 덮어쓴다. 프로필 행이 없으면 {@code false}. */
    boolean beginPhotoUpload(UUID userId, PhotoUpload upload);

    /** 대기 중인 올리기. 없으면 {@code null}. */
    PhotoUpload pendingPhotoUpload(UUID userId);

    /**
     * 대기 중인 올리기를 프로필 사진으로 바꾼다.
     *
     * @return 바뀌기 전의 사진 키. 없었으면 {@code null}
     */
    String completePhotoUpload(UUID userId, String objectKey);

    /** 사진을 뗀다. 돌려주는 값은 떼어 낸 사진 키이고, 없었으면 {@code null}. */
    String clearPhoto(UUID userId);

    record PhotoUpload(String objectKey, String mimeType, long sizeBytes, Instant expiresAt) {
    }
}
