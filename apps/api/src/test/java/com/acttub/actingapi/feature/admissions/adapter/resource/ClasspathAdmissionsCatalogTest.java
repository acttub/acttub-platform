package com.acttub.actingapi.feature.admissions.adapter.resource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/**
 * 카탈로그 무결성 검사 — 어긋난 문서로는 기동하지 않는다. 실제 classpath 문서 대신 읽어 들인 결과를 바꿔 끼워
 * 위반마다 어떤 문제 줄이 나오는지 본다.
 */
class ClasspathAdmissionsCatalogTest {

    /** classpath 문서를 읽는 자리에서 주어진 JSON 을 대신 읽는 매퍼. */
    private static ObjectMapper reading(String json) {
        return new ObjectMapper() {
            @Override
            public <T> T readValue(InputStream ignored, Class<T> type) throws IOException {
                return new ObjectMapper().readValue(json, type);
            }
        };
    }

    @Test
    void theShippedCatalogLoads() {
        ClasspathAdmissionsCatalog catalog = new ClasspathAdmissionsCatalog(new ObjectMapper());

        assertThat(catalog.all().universities()).isNotEmpty();
        assertThat(catalog.all().notices()).allSatisfy(notice -> assertThat(catalog.all().universities())
                .anySatisfy(university -> assertThat(university.id()).isEqualTo(notice.universityId())));
    }

    @Test
    void everyKindOfViolationIsListedInOneStartupFailure() {
        String broken = """
                {"universities":[
                  {"id":"u1","type":"academy",
                   "tips":[{"text":"t","category":"gossip","source_type":"rumor"}],
                   "resources":[{"title":"r","source_type":"ad"}]},
                  {"id":"u1","type":"univ"}],
                 "notices":[
                  {"id":"n1","university_id":"u1","discipline":"dance",
                   "stages":[{"order":1,"evaluates":["free_acting","juggling"]},{"order":1,"evaluates":[]}],
                   "practical_items":[{"category":"magic","stage":2},{"category":"song","stage":1}]},
                  {"id":"n1","university_id":"nowhere","discipline":"acting"}]}
                """;

        assertThatThrownBy(() -> new ClasspathAdmissionsCatalog(reading(broken)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("invalid admissions data: "
                        + "u1: type=academy; "
                        + "u1: tip category=gossip; "
                        + "u1: tip source_type=rumor; "
                        + "u1: resource source_type=ad; "
                        + "universities[].id 중복: u1; "
                        + "n1: discipline=dance; "
                        + "n1: stage 1 evaluates=[juggling]; "
                        + "n1: stages[].order 중복 1; "
                        + "n1: category=magic; "
                        + "n1: practical_items[].stage=2; "
                        + "notices[].id 중복: n1; "
                        + "universities에 없는 university_id: nowhere");
    }

    @Test
    void unreadableDocumentStopsStartup() {
        ObjectMapper failing = new ObjectMapper() {
            @Override
            public <T> T readValue(InputStream ignored, Class<T> type) throws IOException {
                throw new IOException("truncated");
            }
        };

        assertThatThrownBy(() -> new ClasspathAdmissionsCatalog(failing))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("cannot load admissions/notices.json")
                .hasRootCauseMessage("truncated");
    }
}
