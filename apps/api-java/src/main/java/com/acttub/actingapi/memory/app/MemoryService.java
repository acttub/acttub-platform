package com.acttub.actingapi.memory.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.schema.ActorMemoryField;
import org.springframework.stereotype.Service;

/**
 * 배우가 자기 기억 여섯 칸을 읽고 고치고 지운다 (`actor_memory.py`).
 *
 * <p>이 화면이 기억 기능의 안전판이다 — 에이전트가 잘못 적은 것을 되돌릴 경로가 여기밖에
 * 없다. 그래서 배우가 쓴 것은 언제나 이긴다.
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

    /** 값은 부르는 쪽이 이미 다듬어 넘긴다(`MemoryValue`). */
    public MemoryEntry write(UUID userId, ActorMemoryField field, String value) {
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
