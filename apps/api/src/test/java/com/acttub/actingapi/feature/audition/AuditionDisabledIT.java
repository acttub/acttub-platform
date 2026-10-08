package com.acttub.actingapi.feature.audition;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import com.acttub.actingapi.feature.audition.app.AuditionService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * app.audition — {@code AUDITION_ENABLED} 를 주지 않은(기본 false) 기동. 수집 스케줄러가 서지 않아 네트워크를 열 자리가
 * 없고, 표에 행이 있어도 GET 은 빈 items 다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class AuditionDisabledIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("audition_disabled");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired ApplicationContext context;
    @Autowired AuditionService auditions;

    @Test
    @DisplayName("AUDITION_ENABLED=false: 스케줄러 빈이 없고, 수집을 불러도 아무것도 하지 않으며, GET 은 빈 items 다")
    void disabledServerServesAnEmptyList() throws Exception {
        LocalDate today = LocalDate.now(ZoneOffset.ofHours(9));
        jdbc.update("""
                INSERT INTO audition_postings(source,source_ref,title,category,apply_end,posted_on,source_url,
                                              first_seen_at,last_seen_at)
                VALUES ('otr','1','연극 배우 모집','theater',?,?,'https://otr.co.kr/audition/?vid=1',?,?)
                """, today.plusDays(5), today, OffsetDateTime.now(ZoneOffset.UTC), OffsetDateTime.now(ZoneOffset.UTC));

        assertThat(context.getBeanNamesForType(
                Class.forName("com.acttub.actingapi.feature.audition.adapter.sched.AuditionCollectScheduler")))
                .isEmpty();
        assertThat(auditions.collect().stored()).isEmpty();

        var response = mvc.perform(get("/v2/auditions")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        assertThat(body.path("items").isArray()).isTrue();
        assertThat(body.path("items")).isEmpty();
        assertThat(body.has("collected_at")).isTrue();
        assertThat(body.path("collected_at").isNull()).isTrue();
    }
}
