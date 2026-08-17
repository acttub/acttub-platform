package com.acttub.actingapi.consent.adapter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.schema.ConsentType;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import org.postgresql.util.PSQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 기동할 때 manifest 에 적힌 동의 문서를 DB 에 올린다.
 *
 * <p><b>어느 하위 어댑터에도 속하지 않아 층의 루트에 둔다</b> — 파일에서 읽어 DB 에 넣는 일이
 * 한 몸이라 {@code resource} 도 {@code db} 도 아니고, 그 사이의 판정(같은 판인데 내용이 다르면
 * 경고만 남긴다)도 그 일의 일부다. 배선이 아닌데 루트에 있는 첫 파일이며, 루트를 "여럿을
 * 조립하는 것"이 아니라 <b>"어느 하위에도 속하지 않는 것"</b>의 자리로 읽는다.
 *
 * <p>어떤 실패도 기동을 막지 않는다. 문서 시딩이 안 됐다고 앱이 뜨지 않으면 그 편이 더 나쁘다.
 */
@Component
public class ConsentDocumentPublisher implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(ConsentDocumentPublisher.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ResourceLoader resources;
    private final String configuredDir;

    public ConsentDocumentPublisher(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            ResourceLoader resources,
            @Value("${CONSENT_DOCS_DIR:}") String configuredDir) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.resources = resources;
        this.configuredDir = configuredDir;
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    record Entry(
            String file,
            String type,
            String version,
            String title,
            @JsonDeserialize(using = StrictBooleanDeserializer.class) Boolean required) {
    }

    private record Validated(Entry entry, ConsentType type, String body) {
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            publish();
        } catch (Exception exception) {
            log.error("Consent document startup seed failed", exception);
        }
    }

    public int publish() throws Exception {
        Resource manifest = resource("manifest.json");
        if (!manifest.exists()) {
            log.warn("Consent documents manifest is missing: {}", manifest);
            return 0;
        }

        List<Entry> entries = mapper.readValue(manifest.getInputStream(), new TypeReference<>() { });
        List<Validated> all = new ArrayList<>();
        for (Entry entry : entries) {
            ConsentType type = Arrays.stream(ConsentType.values())
                    .filter(value -> value.dbValue().equals(entry.type()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException(
                            "invalid consent type: " + entry.type()));
            if (entry.file() == null || entry.file().isBlank()
                    || entry.version() == null || entry.version().isBlank()
                    || entry.title() == null || entry.title().isBlank()
                    || entry.required() == null) {
                throw new IllegalArgumentException("invalid consent manifest entry");
            }
            Resource body = resource(entry.file());
            if (!body.exists()) {
                throw new java.io.FileNotFoundException(entry.file());
            }
            all.add(new Validated(
                    entry,
                    type,
                    new String(body.getInputStream().readAllBytes(), StandardCharsets.UTF_8)));
        }

        int published = 0;
        for (Validated value : all) {
            Entry entry = value.entry();
            List<Map<String, Object>> existing = jdbc.queryForList(
                    "SELECT title,body,required FROM consent_documents "
                            + "WHERE type=?::consent_type_t AND version=?",
                    value.type().dbValue(),
                    entry.version());
            if (!existing.isEmpty()) {
                Map<String, Object> row = existing.getFirst();
                List<String> mismatch = new ArrayList<>();
                if (!Objects.equals(row.get("title"), entry.title())) {
                    mismatch.add("title");
                }
                if (!Objects.equals(row.get("body"), value.body())) {
                    mismatch.add("body");
                }
                if (!Objects.equals(row.get("required"), entry.required())) {
                    mismatch.add("required");
                }
                if (!mismatch.isEmpty()) {
                    log.warn(
                            "Consent document {}:{} differs in fields: {}; publish a new version",
                            value.type().dbValue(),
                            entry.version(),
                            mismatch);
                }
                continue;
            }
            try {
                jdbc.update(
                        "INSERT INTO consent_documents(id,type,version,title,body,required) "
                                + "VALUES (?,?::consent_type_t,?,?,?,?)",
                        UUID.randomUUID(),
                        value.type().dbValue(),
                        entry.version(),
                        entry.title(),
                        value.body(),
                        entry.required());
                published++;
            } catch (DataIntegrityViolationException exception) {
                if (!isUniqueRace(exception)) {
                    throw exception;
                }
            }
        }
        log.info("Published {} consent documents during startup", published);
        return published;
    }

    private Resource resource(String name) {
        if (configuredDir != null && !configuredDir.isBlank()) {
            return new FileSystemResource(Path.of(configuredDir).resolve(name));
        }
        return resources.getResource("classpath:consent-docs/" + name);
    }

    static boolean isUniqueRace(Throwable value) {
        for (Throwable cause = value; cause != null; cause = cause.getCause()) {
            if (cause instanceof PSQLException postgres
                    && postgres.getServerErrorMessage() != null
                    && "23505".equals(postgres.getSQLState())
                    && "uq_consent_documents_type_version".equals(
                            postgres.getServerErrorMessage().getConstraint())) {
                return true;
            }
        }
        return false;
    }

    public static final class StrictBooleanDeserializer extends JsonDeserializer<Boolean> {
        @Override
        public Boolean deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            if (parser.currentToken() == JsonToken.VALUE_TRUE) {
                return true;
            }
            if (parser.currentToken() == JsonToken.VALUE_FALSE) {
                return false;
            }
            Object input = parser.readValueAs(Object.class);
            throw InvalidFormatException.from(
                    parser,
                    "required must be a JSON boolean",
                    input,
                    Boolean.class);
        }
    }
}
