package com.acttub.actingapi.admissions.adapter.resource;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import com.acttub.actingapi.admissions.app.Admissions.AdmissionsResponse;
import com.acttub.actingapi.admissions.app.AdmissionsCatalog;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnResource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * 카탈로그를 classpath JSON 한 벌에서 읽는다.
 *
 * <p><b>무결성 검사가 여기 있는 이유</b> — 바깥에서 들어온 문서가 우리가 아는 형태인지 보는
 * 일이라 어댑터의 책임이다. 기동 때 한 번 돌고, 어긋나면 컨텍스트가 뜨지 않는다. 잘못된
 * 카탈로그로 서비스가 도는 것보다 안 뜨는 편이 낫다 — 입시생이 광고를 정보로 읽거나 없는
 * 대학을 가리키는 요강을 보게 된다.
 */
@Component
@ConditionalOnResource(resources = "classpath:admissions/notices.json")
class ClasspathAdmissionsCatalog implements AdmissionsCatalog {
    private static final Set<String> DISCIPLINES = Set.of("acting", "musical");
    private static final Set<String> UNIVERSITY_TYPES = Set.of("univ", "college");
    private static final Set<String> TIP_CATEGORIES = Set.of(
            "practice", "day_of", "place", "dress", "document", "strategy", "etc");
    private static final Set<String> SOURCE_TYPES = Set.of(
            "official", "school", "academy", "personal");
    private static final Set<String> PRACTICAL_CATEGORIES = Set.of(
            "free_acting",
            "assigned_acting",
            "improv",
            "song",
            "dance",
            "movement",
            "special",
            "interview",
            "essay",
            "audition_etc");

    private final AdmissionsResponse payload;

    ClasspathAdmissionsCatalog(ObjectMapper mapper) {
        ClassPathResource resource = new ClassPathResource("admissions/notices.json");
        try (InputStream input = resource.getInputStream()) {
            payload = mapper.readValue(input, AdmissionsResponse.class);
        } catch (IOException exception) {
            throw new IllegalStateException("cannot load admissions/notices.json", exception);
        }
        validate(payload);
    }

    @Override
    public AdmissionsResponse all() {
        return payload;
    }

    private static void validate(AdmissionsResponse value) {
        List<String> problems = new ArrayList<>();
        Set<String> universityIds = new HashSet<>();
        value.universities().forEach(university -> {
            if (!universityIds.add(university.id())) {
                problems.add("universities[].id 중복: " + university.id());
            }
            if (university.type() != null && !UNIVERSITY_TYPES.contains(university.type())) {
                problems.add(university.id() + ": type=" + university.type());
            }
            university.tips().forEach(tip -> {
                if (!TIP_CATEGORIES.contains(tip.category())) {
                    problems.add(university.id() + ": tip category=" + tip.category());
                }
                if (!SOURCE_TYPES.contains(tip.sourceType())) {
                    problems.add(university.id() + ": tip source_type=" + tip.sourceType());
                }
            });
            university.resources().forEach(resource -> {
                if (!SOURCE_TYPES.contains(resource.sourceType())) {
                    problems.add(university.id() + ": resource source_type=" + resource.sourceType());
                }
            });
        });

        Set<String> noticeIds = new HashSet<>();
        value.notices().forEach(notice -> {
            if (!noticeIds.add(notice.id())) {
                problems.add("notices[].id 중복: " + notice.id());
            }
            if (!universityIds.contains(notice.universityId())) {
                problems.add("universities에 없는 university_id: " + notice.universityId());
            }
            if (notice.discipline() != null && !DISCIPLINES.contains(notice.discipline())) {
                problems.add(notice.id() + ": discipline=" + notice.discipline());
            }
            Set<Integer> orders = new HashSet<>();
            notice.stages().forEach(stage -> {
                if (!orders.add(stage.order())) {
                    problems.add(notice.id() + ": stages[].order 중복 " + stage.order());
                }
                Set<String> unknown = new HashSet<>(stage.evaluates());
                unknown.removeAll(PRACTICAL_CATEGORIES);
                if (!unknown.isEmpty()) {
                    problems.add(notice.id() + ": stage " + stage.order() + " evaluates=" + unknown);
                }
            });
            notice.practicalItems().forEach(item -> {
                if (!PRACTICAL_CATEGORIES.contains(item.category())) {
                    problems.add(notice.id() + ": category=" + item.category());
                }
                if (item.stage() != null && !orders.isEmpty() && !orders.contains(item.stage())) {
                    problems.add(notice.id() + ": practical_items[].stage=" + item.stage());
                }
            });
        });
        if (!problems.isEmpty()) {
            throw new IllegalStateException("invalid admissions data: " + String.join("; ", problems));
        }
    }
}
