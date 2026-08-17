package com.acttub.actingapi.memory.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.memory.domain.MemoryValue;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import org.springframework.stereotype.Service;

/**
 * 배우가 자기 기억 여섯 칸을 읽고 고치고 지운다 (`actor_memory.py`).
 *
 * <p>이 화면이 기억 기능의 안전판이다 — 에이전트가 잘못 적은 것을 되돌릴 경로가 여기밖에
 * 없다. 그래서 배우가 쓴 것은 언제나 이긴다.
 *
 * <p><b>배우 쪽 경로만 여기를 지난다.</b> 에이전트가 쓰는 길({@code MemoryUpdateWorker})은
 * 저장소를 직접 본다 — 지나는 규칙이 다르고(배우 것을 덮지 않는다, 쓸 수 있는 칸이 넷뿐이다),
 * 그 둘을 한 서비스로 묶으면 "누구 이름으로 쓰는가"를 인자로 받게 된다.
 */
@Service
public class MemoryService {

    private final MemoryRepository repository;

    public MemoryService(MemoryRepository repository) {
        this.repository = repository;
    }

    public List<MemoryEntry> list(UUID userId) {
        return repository.list(userId);
    }

    /**
     * 배우가 한 칸을 쓰거나 고친다. 값은 <b>받은 그대로</b> 넘기면 된다 — 다듬는 것은 여기서
     * 한다.
     *
     * @throws BlankMemoryValue 다듬고 나니 아무것도 안 남았다
     */
    public MemoryEntry write(UUID userId, ActorMemoryField field, String rawValue) {
        String value = MemoryValue.normalize(rawValue);
        if (value == null) {
            throw new BlankMemoryValue();
        }
        return repository.writeAsActor(userId, field, value);
    }

    /** 이미 없어도 지우려는 결과는 같으므로 아무 일도 일어나지 않는다. */
    public void delete(UUID userId, ActorMemoryField field) {
        repository.delete(userId, field);
    }

    /** 기억을 통째로 지운다. 다음 연습부터 다시 쌓인다. */
    public void deleteAll(UUID userId) {
        repository.delete(userId, null);
    }
}
