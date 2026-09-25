package com.acttub.actingapi.feature.consent.adapter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;

import com.acttub.actingapi.feature.consent.app.ConsentNoticeSource;
import com.acttub.actingapi.feature.consent.domain.ConsentNotice;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

/**
 * 고지 문서를 배포에 든 파일에서 읽는다 — 동의 문서의 발행 정본과 같은 디렉토리
 * ({@code consent-docs/}, {@code CONSENT_DOCS_DIR} 로 바꿀 수 있다)다.
 *
 * <p>⚠ <b>파일 이름이 고정이다.</b> 배포 가드({@code deploy/consent-gate.sh})가 계측 키를 넣기 전에
 * 이 파일에 수탁사 고지가 있는지 본다. 이름을 바꾸면 가드도 함께 고쳐야 한다.
 *
 * <p>요청마다 읽는다. 파일은 작고 공개 페이지는 드물게 열리며, 기동 때 읽어 두면 파일이 없는 배포가
 * 기동 실패나 조용한 빈 목록 가운데 하나가 된다 — 지금은 그 요청만 500 으로 드러난다.
 */
@Component
class DeployedConsentNotices implements ConsentNoticeSource {

    /** 개인정보 처리방침. 동의 문서 {@code privacy}(수집·이용 동의)와 다른 문서다. */
    static final String PRIVACY_POLICY_FILE = "privacy_policy.md";

    private final ResourceLoader resources;
    private final String configuredDir;

    DeployedConsentNotices(ResourceLoader resources, @Value("${CONSENT_DOCS_DIR:}") String configuredDir) {
        this.resources = resources;
        this.configuredDir = configuredDir;
    }

    @Override
    public List<ConsentNotice> notices() {
        return List.of(new ConsentNotice("privacy_policy", "개인정보 처리방침", read(PRIVACY_POLICY_FILE)));
    }

    private String read(String name) {
        Resource resource = configuredDir != null && !configuredDir.isBlank()
                ? new FileSystemResource(Path.of(configuredDir).resolve(name))
                : resources.getResource("classpath:consent-docs/" + name);
        try (var in = resource.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException missing) {
            throw new UncheckedIOException("consent notice is missing: " + name, missing);
        }
    }
}
