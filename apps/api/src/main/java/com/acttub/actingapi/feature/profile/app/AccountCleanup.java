package com.acttub.actingapi.feature.profile.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository.Abandoned;
import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository.CleanupOperation;
import com.acttub.actingapi.integration.oidc.AppleTokenClient;
import com.acttub.actingapi.integration.oidc.KakaoUserClient;
import com.acttub.actingapi.integration.oidc.NaverTokenClient;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

/**
 * 탈퇴 트랜잭션 밖에서 하는 정리 — 저장소의 객체 삭제와 제공자 쪽 연결 해제.
 *
 * <p><b>여기서 난 실패는 탈퇴를 되돌리지 않는다.</b> 탈퇴는 이미 끝났고, 실패한 정리는 장부에 남아
 * 7일 동안 다시 시도된다. 간격은 5분에서 시작해 두 배씩 늘고 12시간에서 멈춘다. 성공하면 행을 값과
 * 함께 지우고, 7일이 지나면 포기하고 지운다 — 해제에 쓸 값을 그보다 오래 들고 있지 않는다.
 *
 * <p>실패는 조용히 묻지 않는다. 시도가 실패할 때마다 보고하고(같은 자리·같은 예외의 반복은 보고기가
 * 10분 동안 억제한다, ADR-025), 애플 폐기는 App Store 필수라 <b>7일 뒤에도 실패면 따로 알린다.</b>
 *
 * <p>값(토큰·회원번호·객체 키)은 로그에도 보고에도 싣지 않는다. 남기는 것은 실패의 종류뿐이다.
 */
@Service
public class AccountCleanup {
    /** 집은 워커가 죽었을 때 다른 워커가 다시 집기까지의 시간. 바깥 호출의 시간 제한보다 넉넉하다. */
    static final Duration LEASE = Duration.ofMinutes(10);

    private static final Duration FIRST_RETRY = Duration.ofMinutes(5);
    private static final Duration LONGEST_RETRY = Duration.ofHours(12);
    private static final int BATCH = 20;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final AccountCleanupRepository operations;
    private final ProfilePhotoStorage storage;
    private final AppleTokenClient apple;
    private final KakaoUserClient kakao;
    private final NaverTokenClient naver;
    private final AccountSecrets secrets;
    private final FailureReporter failureReporter;
    private final Clock clock;

    public AccountCleanup(
            AccountCleanupRepository operations,
            ProfilePhotoStorage storage,
            AppleTokenClient apple,
            KakaoUserClient kakao,
            NaverTokenClient naver,
            AccountSecrets secrets,
            FailureReporter failureReporter,
            Clock clock) {
        this.operations = operations;
        this.storage = storage;
        this.apple = apple;
        this.kakao = kakao;
        this.naver = naver;
        this.secrets = secrets;
        this.failureReporter = failureReporter;
        this.clock = clock;
    }

    /** 탈퇴가 방금 올린 정리를 바로 한 번 시도한다. 어떤 실패도 밖으로 나가지 않는다. */
    public void attempt(List<UUID> operationIds) {
        try {
            operations.claim(operationIds, clock.instant(), LEASE).forEach(this::run);
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("AccountCleanup.attempt"));
        }
    }

    /**
     * 때가 된 정리를 다시 시도하고, 기한이 지난 것을 치운다. 정해진 간격으로 돈다.
     *
     * @return 이번에 시도한 정리의 수
     */
    public int runDue() {
        Instant now = clock.instant();
        operations.removeExpired(now).forEach(this::abandoned);
        int attempted = 0;
        List<CleanupOperation> claimed;
        do {
            claimed = operations.claimDue(now, BATCH, LEASE);
            claimed.forEach(this::run);
            attempted += claimed.size();
        } while (claimed.size() == BATCH);
        return attempted;
    }

    private void run(CleanupOperation operation) {
        try {
            String payload = secrets.decrypt(operation.payloadEncrypted());
            switch (operation.kind()) {
                // 리딩 녹음 객체도 같은 저장소의 객체 키 목록이다(reading.recording).
                case "object_delete", "reading_recording_delete" -> deleteObjects(payload);
                case "apple_revoke" -> apple.revoke(payload);
                case "kakao_unlink" -> kakao.unlink(payload);
                case "naver_revoke" -> naver.revoke(payload);
                default -> throw new IllegalStateException("unknown cleanup kind: " + operation.kind());
            }
            operations.succeeded(operation.id());
        } catch (RuntimeException failure) {
            Instant now = clock.instant();
            operations.failed(
                    operation.id(),
                    failure.getClass().getSimpleName(),
                    now.plus(retryDelay(operation.attemptCount())),
                    now);
            failureReporter.report(
                    failure, new FailureContext("AccountCleanup." + operation.kind(), operation.id()));
        }
    }

    /** 이미 없는 객체를 지우는 것은 실패가 아니다(S3 의 삭제는 멱등이다). 하나라도 실패하면 전부 다시 한다. */
    private void deleteObjects(String payload) {
        List<String> keys;
        try {
            keys = JSON.readValue(payload, new TypeReference<List<String>>() { });
        } catch (Exception unreadable) {
            throw new IllegalStateException("object_delete payload is not a key list");
        }
        keys.forEach(storage::delete);
    }

    private void abandoned(Abandoned operation) {
        if (!"apple_revoke".equals(operation.kind())) {
            return;
        }
        failureReporter.report(
                new AppleRevocationAbandoned(operation.attemptCount(), operation.lastError()),
                FailureKind.EXTERNAL,
                new FailureContext("AccountCleanup.appleRevocationAbandoned", operation.id()));
    }

    static Duration retryDelay(int attemptCount) {
        Duration delay = FIRST_RETRY;
        for (int i = 1; i < attemptCount && delay.compareTo(LONGEST_RETRY) < 0; i++) {
            delay = delay.multipliedBy(2);
        }
        return delay.compareTo(LONGEST_RETRY) > 0 ? LONGEST_RETRY : delay;
    }

    /**
     * 애플 토큰 폐기를 7일 동안 성공하지 못하고 포기했다. 폐기는 App Store 필수라 사람이 봐야 한다 —
     * 토큰은 이미 지워졌으므로 애플 쪽 연결은 사용자가 기기 설정에서 끊는 길만 남는다.
     */
    public static final class AppleRevocationAbandoned extends RuntimeException {
        AppleRevocationAbandoned(int attempts, String lastError) {
            super("apple token revocation abandoned after " + attempts + " attempts; last error: " + lastError);
        }
    }
}
