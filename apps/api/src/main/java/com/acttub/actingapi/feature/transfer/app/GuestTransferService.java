package com.acttub.actingapi.feature.transfer.app;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.acttub.actingapi.feature.auth.app.GuestAccounts;
import com.acttub.actingapi.feature.memory.app.MemoryOwnership;
import com.acttub.actingapi.feature.practice.app.PracticeOwnership;
import com.acttub.actingapi.feature.reading.app.ReadingOwnership;
import com.acttub.actingapi.feature.upload.app.UploadOwnership;
import com.acttub.actingapi.platform.ledger.OperationOwnership;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 웹 게스트의 자료를 앱 회원에게 옮긴다 (account.guest, ADR-028).
 *
 * <p><b>복사가 아니라 주인 바꾸기다.</b> 자료 행의 {@code user_id} 만 회원으로 바꾸므로 영상·분석·대화·
 * 노트가 그대로 따라간다. 행의 주인은 각 도메인이라 이관은 그것을 직접 고치지 않고 도메인마다의 "주인
 * 바꾸기" 포트를 부른다 — 간선은 이관 → 각 도메인 한 방향이다.
 *
 * <p><b>옮기기는 한 트랜잭션이다.</b> 도중에 실패하면 어느 행의 주인도 바뀌지 않고 코드는 살아 있다.
 * 끝나면 게스트 계정을 닫는다: 상태를 {@code deactivated} 로, 신원 행은 지우고, 리프레시 토큰은 폐기하되
 * 행은 남긴다. 쓰인 코드 행이 "이 게스트는 옮겨졌다"는 표식으로 남아, 그 게스트의 토큰으로 온 요청에
 * {@code guest_transferred} 를 답한다. 동의 기록은 게스트 행에 남긴다.
 */
public class GuestTransferService {

    /** 코드는 10분 산다. */
    public static final Duration CODE_TTL = Duration.ofMinutes(10);

    private static final String HASH_PURPOSE = "acttub/guest-transfer-code/v1";
    private static final int CODE_SPACE = 1_000_000;
    private static final int ISSUE_ATTEMPTS = 20;

    private final TransferCodeRepository codes;
    private final GuestAccounts guests;
    private final UploadOwnership uploads;
    private final PracticeOwnership practices;
    private final OperationOwnership operations;
    private final MemoryOwnership memories;
    private final ReadingOwnership readings;
    private final Clock clock;
    private final byte[] hashKey;
    private final SecureRandom random = new SecureRandom();

    public GuestTransferService(
            TransferCodeRepository codes,
            GuestAccounts guests,
            UploadOwnership uploads,
            PracticeOwnership practices,
            OperationOwnership operations,
            MemoryOwnership memories,
            ReadingOwnership readings,
            Clock clock,
            String secret) {
        if (secret == null || secret.isEmpty()) {
            throw new IllegalArgumentException("transfer code secret must not be empty");
        }
        this.codes = codes;
        this.guests = guests;
        this.uploads = uploads;
        this.practices = practices;
        this.operations = operations;
        this.memories = memories;
        this.readings = readings;
        this.clock = clock;
        this.hashKey = hmac(secret.getBytes(StandardCharsets.UTF_8), HASH_PURPOSE);
    }

    /**
     * 웹이 보여 줄 여섯 자리 숫자. 10분 유효, 한 번 쓰면 끝, 새로 받으면 이전 코드는 무효다. 서버는 해시만
     * 저장하므로 코드는 이 응답에서만 보인다.
     */
    public IssuedCode issueCode(UUID guestId) {
        Instant now = clock.instant();
        Instant expiresAt = now.plus(CODE_TTL);
        for (int attempt = 0; attempt < ISSUE_ATTEMPTS; attempt++) {
            String code = "%06d".formatted(random.nextInt(CODE_SPACE));
            if (codes.issue(guestId, hash(code), now, expiresAt)) {
                return new IssuedCode(code, CODE_TTL.toSeconds(), expiresAt);
            }
        }
        throw new IllegalStateException("could not find a free transfer code");
    }

    /**
     * 코드를 넣은 회원에게 그 코드의 게스트가 가진 자료를 옮긴다.
     *
     * @param memoryChoice {@code member}·{@code guest} 또는 {@code null}. 회원과 게스트 둘 다 배우 기억이
     *        있을 때만 본다 — 한쪽만 있으면 실려 와도 무시한다
     * @return 옮겼으면 {@link Outcome#TRANSFERRED}, 코드가 틀렸으면(만료·사용·무효 포함)
     *         {@link Outcome#CODE_NOT_FOUND}. 틀린 시도를 세는 일은 요청을 받는 자리의 몫이다
     * @throws ApiException 409 {@code memory_choice_required} — 아무것도 옮기지 않았고 코드도 살아 있다
     */
    public Outcome transfer(UUID memberId, String code, String memoryChoice) {
        Instant now = clock.instant();
        return codes.inTransaction(() -> {
            TransferCodeRepository.LiveCode live = codes.lockLive(hash(code), now);
            // 닫힌 게스트의 코드는 없는 코드다. 회원의 코드는 발급되지 않으므로 여기 오지 않는다.
            if (live == null || !guests.activeGuest(live.guestId()) || live.guestId().equals(memberId)) {
                return Outcome.CODE_NOT_FOUND;
            }
            UUID guestId = live.guestId();
            // 올린 영상 → 연습 → 작업 장부 순서는 그대로다(새 연습을 만드는 쪽이 올린 영상 행을 먼저 잡으므로,
            // 그 행에서 줄을 서야 겹쳐 만들어진 연습과 작업을 놓치지 않는다).
            uploads.reassign(guestId, memberId);
            practices.reassign(guestId, memberId);
            operations.reassign(guestId, memberId);
            // 기억은 작업 장부 뒤에 본다. 기억 갱신 워커는 작업 행을 잡은 채 그 행의 주인에게 기억을
            // 쓰므로, 작업 행을 먼저 잡아야 저장 중이던 갱신이 끝난 뒤의 기억을 보고 그 뒤의 갱신은 회원에게
            // 간다. 기억을 먼저 보면 그 사이에 저장된 기억이 닫힌 게스트에게 남는다. 고르지 않았을 때의 409 는
            // 어디서 나든 트랜잭션 전체를 되돌린다.
            moveMemory(guestId, memberId, memoryChoice);
            // 리딩(대본·회차·녹음·암기 상태)은 게스트의 users 행을 잡은 뒤 옮긴다 — 리딩의 쓰기가 같은 행을 잡고
            // 활성인지 보므로, 옮기는 사이에 커밋된 대본이 닫힌 게스트에게 남지 않는다(03-reading).
            readings.reassign(guestId, memberId);
            guests.closeTransferredGuest(guestId, now);
            codes.markUsed(live.id(), now);
            return Outcome.TRANSFERRED;
        });
    }

    /**
     * 기억은 합치지 않는다. 회원에게 없으면 게스트의 것을 옮기고, 둘 다 있으면 배우가 고른 쪽만 남긴다.
     * 고르지 않았으면 <b>아무것도 옮기지 않고</b> 409 로 알린다 — 예외가 트랜잭션을 되돌린다.
     */
    private void moveMemory(UUID guestId, UUID memberId, String memoryChoice) {
        if (!memories.hasMemory(guestId)) {
            return;
        }
        if (memories.hasMemory(memberId)) {
            if (memoryChoice == null) {
                throw new ApiException(409, "memory_choice_required");
            }
            if ("member".equals(memoryChoice)) {
                memories.discard(guestId);
                return;
            }
            memories.discard(memberId);
        }
        memories.reassign(guestId, memberId);
    }

    private String hash(String code) {
        return HexFormat.of().formatHex(hmac(hashKey, code));
    }

    private static byte[] hmac(byte[] key, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", failure);
        }
    }

    public enum Outcome {
        TRANSFERRED,
        CODE_NOT_FOUND
    }

    /** @param expiresIn 초. 웹은 이것으로 남은 시간을 센다 */
    public record IssuedCode(String code, long expiresIn, Instant expiresAt) {
    }
}
