package com.acttub.actingapi.feature.admissions.app;

import java.util.List;

import com.acttub.actingapi.feature.admissions.app.Admissions.AdmissionNotice;
import com.acttub.actingapi.feature.admissions.app.Admissions.AdmissionsResponse;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnResource;
import org.springframework.stereotype.Service;

/**
 * 카탈로그를 거르는 규칙. 대학 하나로 좁혀도 <b>응답의 모양은 전량과 같다</b> — 목록이
 * 하나로 줄 뿐이라 클라이언트가 두 형태를 다루지 않아도 된다.
 *
 * <p>⚠ <b>요강 파일이 없으면 이 기능은 통째로 없다.</b> 그래서 컨트롤러·카탈로그·서비스 셋이
 * 같은 {@code @ConditionalOnResource} 를 진다 — 하나라도 빠지면 그 빈이 없는 카탈로그를
 * 요구해 <b>컨텍스트가 기동하지 못한다.</b> 🔎 계약 하네스는 이것을 보지 못한다(리소스가 없는
 * 기동으로 인스턴스를 띄우는 시나리오가 없다. {@code admissions-missing} 은 "없는 대학"이지
 * "없는 카탈로그"가 아니다).
 */
@Service
@ConditionalOnResource(resources = AdmissionsCatalog.RESOURCE)
public class AdmissionsService {
    private final AdmissionsCatalog catalog;

    public AdmissionsService(AdmissionsCatalog catalog) {
        this.catalog = catalog;
    }

    public AdmissionsResponse all() {
        return catalog.all();
    }

    /** 그 대학과 그 대학의 요강만. 없으면 404. */
    public AdmissionsResponse university(String universityId) {
        AdmissionsResponse payload = catalog.all();
        var university = payload.universities().stream()
                .filter(value -> value.id().equals(universityId))
                .findFirst()
                .orElseThrow(() -> new ApiException(404, "university_not_found"));
        List<AdmissionNotice> notices = payload.notices().stream()
                .filter(value -> value.universityId().equals(universityId))
                .toList();
        return new AdmissionsResponse(
                payload.updatedAt(),
                payload.disclaimer(),
                List.of(university),
                notices);
    }
}
