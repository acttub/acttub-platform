package com.acttub.actingapi.feature.admissions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.util.List;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class AdmissionsEndpointIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("admissions_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper mapper;

    @Test
    void publicListAndUniversityDetailReturnTheValidatedCatalog() throws Exception {
        JsonNode all = getJson("/v2/admissions", 200);
        assertThat(all.path("universities").isArray()).isTrue();
        assertThat(all.path("universities").isEmpty()).isFalse();
        assertThat(all.path("notices").isArray()).isTrue();

        JsonNode cau = getJson("/v2/admissions/cau", 200);
        assertThat(cau.path("universities")).hasSize(1);
        assertThat(cau.at("/universities/0/id").textValue()).isEqualTo("cau");
        cau.path("notices").forEach(notice ->
                assertThat(notice.path("university_id").textValue()).isEqualTo("cau"));

        JsonNode missing = getJson("/v2/admissions/no-such-university", 404);
        assertThat(missing).isEqualTo(
                mapper.readTree("{\"detail\":\"university_not_found\"}"));
    }

    @Test
    void omittedValuesBecomePresentNullsWhileDefaultsRemainNonNullable() throws Exception {
        JsonNode all = getJson("/v2/admissions", 200);
        JsonNode university = all.path("universities").get(0);
        assertThat(university.has("region")).isTrue();
        assertThat(university.has("campus")).isTrue();
        assertThat(university.has("resources")).isTrue();
        assertThat(university.has("tips")).isTrue();

        JsonNode notice = all.path("notices").get(0);
        for (String field : List.of(
                "department", "discipline", "admission_year", "track", "weights", "note")) {
            assertThat(notice.has(field)).as(field).isTrue();
        }
        for (String field : List.of(
                "designated_works", "essay_questions", "stages", "practical_items", "results")) {
            assertThat(notice.path(field).isArray()).as(field).isTrue();
        }
    }

    private JsonNode getJson(String path, int status) throws Exception {
        var response = mvc.perform(get(path)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }
}
