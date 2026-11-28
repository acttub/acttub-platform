package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.consent.app.ReadingConsents;
import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 대본 리딩의 AI 처리 동의는 두 곳에서 읽는다: consent 의 {@link ReadingConsents}(나누기 접수, 고품질 목소리)와, 대본 올리기가 자기
 * 문장 안에서 행마다 읽는 식(실패 원본을 보관하는가, {@code PostgresScriptUploadRepository#recordFailure}). 두 곳이 같은 규칙으로
 * 답하는지와 Port 가 보내는 문장 수를 실제 PostgreSQL 에서 본다. 화면 쪽 결과는 {@code ReadingImportIT}·{@code CloudVoiceIT} 가 본다.
 */
class ScriptUploadConsentParityIT extends ReadingRepositoryFixture {

    @Autowired
    ReadingConsents consents;

    @Autowired
    ScriptUploadRepository uploads;

    @BeforeEach
    void noDocuments() {
        jdbc.execute("TRUNCATE TABLE consent_documents CASCADE");
    }

    @Test
    @DisplayName("대본 나누기 동의: consent 의 답이 granted 일 때만 실패 원본을 보관한다 — 문서 없음, 결정 없음, 동의, 거절, 동의 뒤 철회, 새 문서, 개인정보 v8·v9·v10·숫자 아닌 버전")
    void theScriptSplitAnswerMatchesWhatTheUploadStatementReads() {
        Map<String, UUID> people = new LinkedHashMap<>();
        for (String name : new String[] {"undecided", "granted", "declined", "withdrew", "privacyV8", "privacyV9",
            "privacyV10Withdrew", "privacyDraft"}) {
            people.put(name, member());
        }
        assertThat(consents.scriptSplit(people.get("undecided"))).as("문서가 없다").isEqualTo("undecided");
        assertParity(people);

        UUID split = document("script_split", "v1", now.minusSeconds(3600));
        decide(people.get("granted"), split, "granted", now.minusSeconds(60));
        decide(people.get("declined"), split, "declined", now.minusSeconds(60));
        decide(people.get("withdrew"), split, "granted", now.minusSeconds(60));
        decide(people.get("withdrew"), split, "declined", now.minusSeconds(30));
        decide(people.get("privacyV8"), document("privacy", "v8", now.minusSeconds(3600)), "granted", now.minusSeconds(60));
        decide(people.get("privacyV9"), document("privacy", "v9", now.minusSeconds(3500)), "granted", now.minusSeconds(60));
        UUID v10 = document("privacy", "v10", now.minusSeconds(3400));
        decide(people.get("privacyV10Withdrew"), v10, "granted", now.minusSeconds(60));
        decide(people.get("privacyV10Withdrew"), v10, "declined", now.minusSeconds(30));
        decide(people.get("privacyDraft"), document("privacy", "draft", now.minusSeconds(3300)), "granted", now.minusSeconds(60));

        assertThat(people.keySet().stream().map(name -> name + "=" + consents.scriptSplit(people.get(name))))
                .containsExactly("undecided=undecided", "granted=granted", "declined=denied", "withdrew=denied",
                        "privacyV8=undecided", "privacyV9=granted", "privacyV10Withdrew=undecided", "privacyDraft=undecided");
        assertParity(people);

        document("script_split", "v2", now.minusSeconds(600));
        assertThat(consents.scriptSplit(people.get("granted"))).as("새 문서에는 아직 결정하지 않았다").isEqualTo("undecided");
        assertThat(consents.scriptSplit(people.get("privacyV9"))).as("개인정보 동의는 문서가 바뀌어도 품는다").isEqualTo("granted");
        assertParity(people);
    }

    @Test
    @DisplayName("Port 가 보내는 문장: 나누기 동의는 한 문장, 고품질 목소리 동의는 개인정보 동의로 끝나면 한 문장이고 아니면 두 문장이다")
    void thePortSendsTheseStatements() {
        UUID covered = member();
        UUID undecided = member();
        document("cloud_voice", "v1", now.minusSeconds(3600));
        decide(covered, document("privacy", "v9", now.minusSeconds(3600)), "granted", now.minusSeconds(60));

        assertThat(statementsOf(() -> consents.scriptSplit(undecided))).hasSize(1);
        assertThat(statementsOf(() -> consents.cloudVoice(covered))).hasSize(1);
        assertThat(statementsOf(() -> consents.cloudVoice(undecided))).hasSize(2);
        assertThat(consents.cloudVoice(covered)).isEqualTo("granted");
        assertThat(consents.cloudVoice(undecided)).isEqualTo("undecided");
    }

    /** 사람마다 원본을 하나 올리고 실패를 남겨, 보관 시한이 적혔는지를 Port 의 답과 견준다. */
    private void assertParity(Map<String, UUID> people) {
        people.forEach((name, userId) -> {
            UUID upload = UUID.randomUUID();
            uploads.reserve(userId, upload, "scripts/" + upload + ".pdf", null, 1L, now.plusSeconds(600), now);
            uploads.recordFailure(upload, "failed", now.plusSeconds(60), now);
            boolean kept = jdbc.queryForObject("SELECT kept_until IS NOT NULL FROM script_uploads WHERE id=?", Boolean.class, upload);
            assertThat(kept).as("%s: 실패 원본 보관과 consent 의 답(%s)", name, consents.scriptSplit(userId))
                    .isEqualTo("granted".equals(consents.scriptSplit(userId)));
        });
    }

    private UUID document(String type, String version, Instant publishedAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                VALUES (?,?,?,'ko',?,?,false,?)
                """, id, type, version, type, type, utc(publishedAt));
        return id;
    }

    private void decide(UUID userId, UUID document, String action, Instant at) {
        jdbc.update("INSERT INTO user_consents(id,user_id,document_id,action,occurred_at) VALUES (?,?,?,?,?)",
                UUID.randomUUID(), userId, document, action, utc(at));
    }
}
