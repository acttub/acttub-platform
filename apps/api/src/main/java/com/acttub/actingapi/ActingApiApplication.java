package com.acttub.actingapi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;

/**
 * {@code @EntityScan}은 Schema Entity가 어디 사는지를 선언으로 고정한다. 이 매핑은
 * {@code ddl-auto: validate}의 스키마 대조와 SOMA-460 이후 런타임 영속화에 함께 쓰이므로,
 * 위치가 흐려지면 검증과 읽기·쓰기 양쪽의 대상이 흐려진다.
 *
 * <p><b>주의 — 이 애노테이션은 스캔 범위를 넓히는 게 아니라 좁힌다.</b> 관례 스캔은
 * {@code com.acttub.actingapi} 전체를 본다. 여기 적힌 패키지 밖에 엔티티를 두면 조용히 검증에서
 * 빠지므로, {@code schema/EntityMappingIT}가 엔티티 개수를 못박아 그 침묵을 빨간불로 바꾼다.
 *
 * <p>도메인별 재편(SOMA-397)으로 각 도메인이 자기 {@code <도메인>/schema} 를 갖는다. 어느
 * 도메인의 것도 아닌 것 — 여러 도메인이 함께 쓰는 어휘, {@code PgEnum} 배관, 도메인을 가로지르는
 * 원장 — 은 {@code platform/schema} 에 남는다.
 * <b>여기에 한 줄을 더하는 것을 잊으면 그 테이블만 검증에서 빠진다</b> — 개수 검사가 그것을 잡는다.
 */
@SpringBootApplication
@EntityScan({
    "com.acttub.actingapi.platform.schema",
    "com.acttub.actingapi.feature.analysis.schema",
    "com.acttub.actingapi.feature.practice.schema",
    "com.acttub.actingapi.feature.community.schema",
    "com.acttub.actingapi.feature.report.schema",
    "com.acttub.actingapi.feature.coach.schema",
    "com.acttub.actingapi.feature.upload.schema",
    "com.acttub.actingapi.feature.auth.schema",
    "com.acttub.actingapi.feature.consent.schema",
    "com.acttub.actingapi.feature.memory.schema",
    "com.acttub.actingapi.feature.push.schema"
})
public class ActingApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(ActingApiApplication.class, args);
    }
}
