package com.acttub.actingapi.admissions;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import com.acttub.actingapi.admissions.AdmissionDtos.AdmissionNotice;
import com.acttub.actingapi.admissions.AdmissionDtos.AdmissionsResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnResource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnResource(resources = "classpath:admissions/notices.json")
class AdmissionsCatalog {
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

    AdmissionsCatalog(ObjectMapper mapper) {
        ClassPathResource resource = new ClassPathResource("admissions/notices.json");
        try (InputStream input = resource.getInputStream()) {
            payload = mapper.readValue(input, AdmissionsResponse.class);
        } catch (IOException exception) {
            throw new IllegalStateException("cannot load admissions/notices.json", exception);
        }
        validate(payload);
    }

    AdmissionsResponse all() {
        return payload;
    }

    AdmissionsResponse university(String universityId) {
        var university = payload.universities().stream()
                .filter(value -> value.id().equals(universityId))
                .findFirst()
                .orElse(null);
        if (university == null) {
            return null;
        }
        List<AdmissionNotice> notices = payload.notices().stream()
                .filter(value -> value.universityId().equals(universityId))
                .toList();
        return new AdmissionsResponse(
                payload.updatedAt(),
                payload.disclaimer(),
                List.of(university),
                notices);
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
