package com.acttub.actingapi.feature.coach.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.integration.llm.StructuredJson;
import org.junit.jupiter.api.Test;

class PostgresCoachPersonasTest {
    @Test void eachAdvisorHashMapsToTheirOwnPromptAndCommentsAreIgnored() {
        String a = "a".repeat(64), b = "b".repeat(64);
        var parsed = PostgresCoachPersonas.parse("# 설명 줄\n" + a + " park-seunga\n" + b + " cho-taemin\n" + "c".repeat(64) + "\nnot-a-hash x\n");
        assertThat(parsed).containsOnlyKeys(a, b).containsEntry(a, "park-seunga").containsEntry(b, "cho-taemin");
    }

    @Test void everyAdvisorInTheListHasAKoreanPromptFile() {
        var advisors = PostgresCoachPersonas.parse(StructuredJson.textResource("/coaching/direct-video/personas/advisors.txt"));
        assertThat(advisors).hasSize(13);
        assertThat(advisors.values()).doesNotContain("a", "b1")
                .allSatisfy(id -> assertThat(PostgresCoachPersonas.class.getResource("/coaching/direct-video/personas/advisors/" + id + ".txt"))
                        .as(id).isNotNull());
        assertThat(advisors.values()).containsOnly("cha-jeonghun", "cho-taemin", "choi-jeongju", "choi-yunhee", "jung-hani", "park-seunga", "kwon-ohryong");
    }

    @Test void emailsAreMatchedByLowercaseTrimmedHash() {
        assertThat(PostgresCoachPersonas.hash(" Someone@Example.com ")).isEqualTo(PostgresCoachPersonas.hash("someone@example.com"))
                .hasSize(64).matches("[0-9a-f]{64}");
    }
}
