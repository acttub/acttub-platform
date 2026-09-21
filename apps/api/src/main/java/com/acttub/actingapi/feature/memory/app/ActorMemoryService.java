package com.acttub.actingapi.feature.memory.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.memory.domain.MemoryValue;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.stereotype.Service;

/**
 * 배우가 자기 기억 네 칸을 읽고 고치고 지운다 (practice.memory).
 *
 * <p>이 화면이 기억 기능의 안전판이다 — 워커가 잘못 적은 것을 되돌릴 경로가 여기밖에 없다. 그래서 배우가 쓴
 * 것은 언제나 이기고, 워커는 그 칸을 다시 덮지 않는다.
 *
 * <p><b>배우 쪽 경로만 여기를 지난다.</b> 워커가 쓰는 길({@link ActorMemoryUpdates})은 저장소를 직접 본다 —
 * 지나는 규칙이 다르고(세대 확인, 배우 것 보호), 그 둘을 한 서비스로 묶으면 "누구 이름으로 쓰는가"를 인자로
 * 받게 된다.
 */
@Service
public class ActorMemoryService {

    private final ActorMemoryStore store;

    public ActorMemoryService(ActorMemoryStore store) {
        this.store = store;
    }

    public List<ActorMemory> list(UUID userId) {
        return store.list(userId);
    }

    /**
     * 배우가 한 칸을 쓰거나 고친다. 값은 <b>받은 그대로</b> 넘기면 된다 — 다듬는 것은 여기서 한다.
     *
     * <p>게이트를 지난 뒤에 다른 기기의 탈퇴가 먼저 끝났으면 저장소가 쓰지 않는다. 게이트가 했을 답을
     * 그대로 준다 — 닫힌 계정에 기억이 다시 생기지 않는다.
     *
     * @throws BlankMemoryValue 다듬고 나니 아무것도 안 남았다
     */
    public ActorMemory write(UUID userId, String field, String rawValue) {
        String value = MemoryValue.normalize(rawValue);
        if (value == null) {
            throw new BlankMemoryValue();
        }
        ActorMemory written = store.writeAsActor(userId, field, value);
        if (written == null) {
            throw new ApiException(403, "account_deactivated");
        }
        return written;
    }

    /** 이미 없어도 지우려는 결과는 같으므로 멱등이다. 누적 횟수는 초기화하지 않는다. */
    public void delete(UUID userId, String field) {
        store.delete(userId, field);
    }

    /** 기억을 통째로 지운다. 다음 갱신 대상 회차부터 다시 쌓인다. */
    public void deleteAll(UUID userId) {
        store.delete(userId, null);
    }
}
