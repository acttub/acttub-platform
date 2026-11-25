package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
import java.util.Optional;

import com.acttub.actingapi.feature.reading.schema.ReadingExampleEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code reading_examples} 를 읽는 문장(apps/api/CONTRACT.md §5-9). 행은 마이그레이션과 운영 SQL 이 넣는다. */
interface ReadingExampleJpaRepository extends Repository<ReadingExampleEntity, String> {

    @Query("select e from ReadingExampleEntity e where e.active order by e.sortOrder, e.id")
    List<ReadingExampleEntity> active();

    @Query("select e from ReadingExampleEntity e where e.active and e.language = :language order by e.sortOrder, e.id")
    List<ReadingExampleEntity> active(String language);

    @Query("select e from ReadingExampleEntity e where e.active and e.id = :id")
    Optional<ReadingExampleEntity> findActive(String id);
}
