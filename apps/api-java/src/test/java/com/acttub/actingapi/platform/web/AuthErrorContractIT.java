package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class AuthErrorContractIT {
    private static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("auth_error");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    RequestMappingHandlerMapping handlerMapping;

    @Test
    void defaultProfileDoesNotRegisterHarnessRoutes() throws Exception {
        assertThat(handlerMapping.getHandlerMethods().keySet()).noneMatch(mapping ->
                mapping.getPatternValues().stream()
                        .anyMatch(pattern -> pattern.startsWith("/__harness")));
        assertThat(mvc.perform(post("/__harness/db-projection")
                        .contentType("application/json")
                        .content("{}"))
                .andReturn().getResponse().getStatus()).isEqualTo(404);
    }

    @Test
    void inventoryUsesDetailAndNeverProblemDetail() throws Exception {
        assertResponse(get("/missing"), 404, "{\"detail\":\"Not Found\"}");
        assertResponse(get("/v2/auth/login"), 405, "{\"detail\":\"Method Not Allowed\"}");
        assertResponse(
                post("/v2/auth/logout")
                        .contentType("application/json")
                        .content("{\"refresh_token\":\"x\"}"),
                401,
                "{\"detail\":\"invalid or missing access token\"}");
        assertResponse(
                post("/v2/auth/login")
                        .contentType("application/json")
                        .content("{\"provider\":\"none\",\"id_token\":\"x\"}"),
                400,
                "{\"detail\":\"unsupported_provider\"}");
    }

    @Test
    void validationHasFastApiLocMsgAndTypeForMissingWrongAndMalformed() throws Exception {
        assertThat(body(jsonPost("{}"), 422)).isEqualTo(JSON.readTree("""
                {"detail":[
                  {"type":"missing","loc":["body","provider"],"msg":"Field required","input":{}},
                  {"type":"missing","loc":["body","id_token"],"msg":"Field required","input":{}}
                ]}
                """));

        assertThat(body(jsonPost("{\"provider\":1,\"id_token\":\"a\"}"), 422))
                .isEqualTo(JSON.readTree("""
                        {"detail":[{"type":"string_type","loc":["body","provider"],
                          "msg":"Input should be a valid string","input":1}]}
                        """));

        assertThat(body(jsonPost(""), 422)).isEqualTo(JSON.readTree("""
                {"detail":[{"type":"missing","loc":["body"],
                  "msg":"Field required","input":null}]}
                """));

        assertMalformedJson(body(jsonPost("{\"provider\": \"google\", "), 422));
    }

    private static void assertMalformedJson(JsonNode response) {
        assertThat(response.path("detail")).hasSize(1);
        JsonNode error = response.path("detail").get(0);
        assertThat(error.path("type").textValue()).isEqualTo("json_invalid");
        assertThat(error.path("msg").textValue()).isEqualTo("JSON decode error");
        assertThat(error.path("loc")).hasSize(2);
        assertThat(error.path("loc").get(0).textValue()).isEqualTo("body");
        assertThat(error.path("loc").get(1).isIntegralNumber()).isTrue();
        assertThat(error.path("input").isObject()).isTrue();
        assertThat(error.path("input")).isEmpty();
        assertThat(error.path("ctx").path("error").isTextual()).isTrue();
        assertThat(error.path("ctx").path("error").textValue()).isNotBlank();
    }

    private static MockHttpServletRequestBuilder jsonPost(String body) {
        return post("/v2/auth/login").contentType("application/json").content(body);
    }

    private void assertResponse(
            MockHttpServletRequestBuilder request,
            int status,
            String expected) throws Exception {
        MvcResult result = mvc.perform(request).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(status);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree(expected));
    }

    private JsonNode body(MockHttpServletRequestBuilder request, int status) throws Exception {
        MvcResult result = mvc.perform(request).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(status);
        return JSON.readTree(result.getResponse().getContentAsString());
    }
}
