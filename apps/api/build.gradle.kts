plugins {
    java
    id("org.springframework.boot") version "3.4.7"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.acttub"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

extra["testcontainers.version"] = "1.21.3"

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("io.micrometer:micrometer-registry-prometheus")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-ui:2.8.6")
    implementation("com.nimbusds:nimbus-jose-jwt:9.48")
    implementation(platform("software.amazon.awssdk:bom:2.31.30"))
    implementation("software.amazon.awssdk:s3")
    // runtimeOnly 가 아니라 implementation 이다. 제약명 문자열로 유니크 위반을 가르는 코드가
    // PSQLException.getServerErrorMessage().getConstraint() 를 컴파일 타임에 참조한다 (apps/api/CONTRACT.md §6 #10).
    implementation("org.postgresql:postgresql")

    implementation("com.google.genai:google-genai:1.68.0")
    implementation("com.networknt:json-schema-validator:1.5.6")

    // 대본 원본 파일의 글자 뽑기(reading.script). 둘 다 Apache-2.0. commons-logging 은 spring-jcl 이 같은 API 를 준다.
    implementation("org.apache.pdfbox:pdfbox:3.0.8") {
        exclude(group = "commons-logging", module = "commons-logging")
    }
    implementation("kr.dogfoot:hwplib:1.1.11")

    // 오디션 공고 목록 페이지의 표 읽기(app.audition). MIT.
    implementation("org.jsoup:jsoup:1.23.2")

    // 파이썬 observability.py 대응(M5 §D). starter 가 MVC 예외를 자동으로 잡아 보내고
    // BeforeSendCallback 빈을 물어 간다. DSN 이 비면 SDK 스스로 꺼지므로 로컬·테스트는 조용하다.
    implementation("io.sentry:sentry-spring-boot-starter-jakarta:8.53.0")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:junit-jupiter")
    testImplementation("org.testcontainers:postgresql")
    // 패키지 순환을 CI 에서 빨간불로 잡는다 (ADR-016). 단일 모듈이라 컴파일러가
    // 방향을 강제하지 못하므로 이 검사가 유일한 관문이다.
    testImplementation("com.tngtech.archunit:archunit-junit5:1.3.0")

    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    // Spring context가 많은 전체 스위트는 기본 512MB worker에서 후반부 OOM이 재현됐다.
    // CI 정본 명령(./gradlew test)이 추적되지 않는 로컬 init script 없이 완주하게 고정한다.
    maxHeapSize = "1g"
    // 클래스마다 Spring 컨텍스트·Flyway 가 새로 떠서 한 줄로 돌면 7분이 넘는다(SOMA-552).
    // fork 마다 JVM 이 따로라 PostgresContainerSupport 의 컨테이너도 fork 마다 따로 뜬다.
    maxParallelForks = 2
    systemProperty("file.encoding", "UTF-8")

    // 로컬 .env 를 테스트가 읽지 못하게 막는다(DotenvEnvironmentPostProcessor). 이 가드가
    // 없으면 실 API 키가 흘러들어, 스텁을 쓰는 줄 알았던 테스트가 진짜 호출을 하게 된다.
    systemProperty("acttub.dotenv.enabled", "false")

    // testcontainers 가 쓰는 docker-java 는 기본 Docker API 버전이 1.32 인데,
    // 최신 Docker Engine 은 그 버전을 400 으로 거부한다("Could not find a valid Docker environment"
    // 로 보인다). 최소로 올려 준다. 환경변수가 이미 있으면 그쪽을 존중한다.
    // 환경변수가 이미 있으면 그 값을 존중하되, 시스템 프로퍼티에는 항상 같은 값을 넣는다.
    // docker-java 는 api.version 시스템 프로퍼티를 우선 보므로, 환경변수만 있으면
    // 기본 1.32 로 접속하다 최신 Engine 에서 400 을 받는다.
    val dockerApiVersion = System.getenv("DOCKER_API_VERSION") ?: "1.41"
    environment("DOCKER_API_VERSION", dockerApiVersion)
    systemProperty("api.version", dockerApiVersion)
    // Docker Desktop(macOS)은 소켓을 ~/.docker/run/docker.sock 에 둔다.
    val desktopSocket = File(System.getProperty("user.home"), ".docker/run/docker.sock")
    if (System.getenv("DOCKER_HOST") == null && desktopSocket.exists()) {
        environment("DOCKER_HOST", "unix://${desktopSocket.absolutePath}")
        environment("TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE", "/var/run/docker.sock")
    }
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = false
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    archiveFileName = "acting-api.jar"
}

// 동의 문서와 심사 공고는 `src/main/resources/` 에 있어 기본 규칙대로 jar 에 실린다.
// 🔁 **정본이 여기로 넘어왔다(SOMA-403 5단계).** 그전에는 파이썬 트리(`apps/api/acting-api/`)가
// 원본이고 이 태스크가 그것을 복사해 넣었다 — 파이썬을 지우면 **jar 에 문서가 빠진 채 빌드가
// 통과하고**, 기동은 경고 한 줄만 남기고 동의 게이트가 조용히 열려 버린다
// (`ConsentDocumentPublisher` 는 어떤 실패도 기동을 막지 않는다).
//
// 파일 이름을 어디에도 적지 않는다. 방침 버전이 오르면(privacy_v2 → v3, SOMA-326) manifest 는
// 새 파일을 가리키는데 목록은 그대로라 **부팅이 FileNotFoundException 으로 죽는다** — 실제로
// 그렇게 깨졌다. 과거 버전 문서도 함께 실린다 — 발행은 manifest 가 가리키는 판만 하지만, 그 판에 동의한 기록이 있어 파일을 지우지 않는다.
tasks.named<org.gradle.language.jvm.tasks.ProcessResources>("processResources") {
    // 발행 절차 문서는 문서일 뿐이라 싣지 않는다. 파일들 옆에 두는 이유는 절차와 대상이
    // 갈리면 방침을 올릴 때 절차를 안 보게 되기 때문이다.
    exclude("consent-docs/README.md", "admissions/README.md")
}
