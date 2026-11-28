package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;

/**
 * 계정을 닫는 순서 (account.withdraw, ADR-040). 표를 고치는 것은 각 표의 주인이고, 여기는 순서만 안다.
 *
 * <p>순서는 {@link #close}·{@link #closeUnderage} 와 그것이 도는 {@link AccountErasureStep} 에 적힌 그대로다. 구현을 주입받은 순서(Spring 의 등록
 * 순서)는 쓰지 않는다. 자리마다 구현이 꼭 하나여야 하고, 빠지거나 겹치면 애플리케이션이 뜨지 않는다.
 */
@Service
public class AccountErasureSequence {

    private final AccountDeactivation accounts;
    private final PendingSettlement settlement;
    private final MediaRetention retention;
    private final Map<AccountErasureStep, AccountErasure> owners = new EnumMap<>(AccountErasureStep.class);
    private final List<AccountErasure> everyOwner;

    public AccountErasureSequence(
            AccountDeactivation accounts,
            PendingSettlement settlement,
            MediaRetention retention,
            List<AccountErasure> erasures) {
        this.accounts = accounts;
        this.settlement = settlement;
        this.retention = retention;
        this.everyOwner = List.copyOf(erasures);
        for (AccountErasure erasure : erasures) {
            for (AccountErasureStep step : erasure.steps()) {
                AccountErasure taken = owners.putIfAbsent(step, erasure);
                if (taken != null) {
                    throw new IllegalStateException("account erasure step " + step + " has two owners: "
                            + taken.getClass().getName() + ", " + erasure.getClass().getName());
                }
            }
        }
        Set<AccountErasureStep> unowned = EnumSet.allOf(AccountErasureStep.class);
        unowned.removeAll(owners.keySet());
        if (!unowned.isEmpty()) {
            throw new IllegalStateException("account erasure steps without an owner: " + unowned);
        }
    }

    /** 닫은 결과. 다시 온 요청에서도 {@code deactivatedAt} 은 처음 닫은 시각이다. */
    public record Closed(Instant deactivatedAt, List<UUID> cleanupOperationIds) {
    }

    /**
     * 계정을 닫는다(탈퇴). <b>부르는 쪽의 트랜잭션 안에서</b> 부른다. 상태 전환과 파기가 한 트랜잭션이어야 「탈퇴했는데 토큰은
     * 살아 있는」 계정이 남지 않는다. 이미 닫힌 계정이면 파기만 다시 돈다.
     *
     * <ol>
     *   <li>계정 행을 잠근다. 맨 앞이어야 한다. 회원 자료를 쓰는 트랜잭션이 같은 행을 잡고 활성인지 보므로, 여기서 줄을 세워야
     *       늦게 온 쓰기가 파기한 값을 되살리지 못한다.</li>
     *   <li>활성이면 밀린 일을 끝내고({@link PendingSettlement}) 상태를 바꾼다. 집계가 상태 전환보다 앞이다.</li>
     *   <li>영상·녹음을 남길지 정한다.</li>
     *   <li>{@link AccountErasureStep} 에 적힌 순서로 각 주인이 자기 몫을 지운다.</li>
     * </ol>
     *
     * @return 없는 계정이면 {@code null}
     */
    public Closed close(UUID userId, Instant now, LocalDate today) {
        return close(userId, false, now, today);
    }

    /**
     * 가입 중에 만 14세 미만으로 드러난 계정을 닫고 <b>계정 행까지 지운다</b>(account.profile). <b>부르는 쪽의 트랜잭션 안에서</b>
     * 부른다.
     *
     * <ol>
     *   <li>{@link #close} 와 같은 순서로 닫는다. 보관 동의가 있어도 영상·녹음은 파기한다. 제공자 연결 해제와 객체 삭제가 정리
     *       장부에 오른다.</li>
     *   <li>각 주인이 외래 키 없이 이 계정을 가리키는 자기 행을 지운다({@link AccountErasure#eraseWithAccountRow}).</li>
     *   <li>계정 행을 지운다. 신원(해시까지), 토큰, 동의 기록과 남아 있던 자료는 외래 키로 함께 지워진다. 정리 장부의 행은
     *       남되 {@code user_id} 가 비워지고, 커밋 뒤에 실행된다.</li>
     * </ol>
     *
     * @return 정리 장부에 올린 일의 id. 없는 계정이면 {@code null}
     */
    public List<UUID> closeUnderage(UUID userId, Instant now, LocalDate today) {
        Closed closed = close(userId, true, now, today);
        if (closed == null) {
            return null;
        }
        everyOwner.forEach(owner -> owner.eraseWithAccountRow(userId));
        accounts.eraseRow(userId);
        return closed.cleanupOperationIds();
    }

    private Closed close(UUID userId, boolean destroyMediaRegardless, Instant now, LocalDate today) {
        AccountDeactivation.State state = accounts.lock(userId);
        if (state == null) {
            return null;
        }
        if (state == AccountDeactivation.State.ACTIVE) {
            settlement.settleBeforeDeactivation(userId, now);
            accounts.deactivate(userId, now);
        }
        boolean retainMedia = !destroyMediaRegardless && retention.granted(userId);
        ClosingAccount account = new ClosingAccount(userId, retainMedia, now, today);
        List<UUID> cleanups = new ArrayList<>();
        for (AccountErasureStep step : AccountErasureStep.values()) {
            cleanups.addAll(owners.get(step).erase(step, account));
        }
        return new Closed(accounts.deactivatedAt(userId), List.copyOf(cleanups));
    }
}
