package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RecentScriptTexts;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

@Repository
class PostgresRecentScriptTexts implements RecentScriptTexts {

    private final EntityManager entityManager;

    PostgresRecentScriptTexts(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Texts of(UUID userId, int scriptLimit, int lineLimit) {
        List<UUID> scriptIds = new ArrayList<>();
        List<String> titles = new ArrayList<>();
        for (Object[] script : entityManager.createQuery(
                        "select s.id, s.title from ScriptEntity s where s.userId = :userId order by s.updatedAt desc",
                        Object[].class)
                .setParameter("userId", userId)
                .setMaxResults(scriptLimit)
                .getResultList()) {
            scriptIds.add((UUID) script[0]);
            titles.add((String) script[1]);
        }
        if (scriptIds.isEmpty()) {
            return new Texts(List.of(), List.of(), List.of());
        }
        List<String> names = entityManager.createQuery(
                        "select c.name from ScriptCharacterEntity c where c.scriptId in (:ids)", String.class)
                .setParameter("ids", scriptIds)
                .getResultList();
        List<String> lines = entityManager.createQuery(
                        "select l.text from ScriptLineEntity l where l.scriptId in (:ids) and character_length(l.text) >= 6",
                        String.class)
                .setParameter("ids", scriptIds)
                .setMaxResults(lineLimit)
                .getResultList();
        return new Texts(List.copyOf(titles), names, lines);
    }
}
