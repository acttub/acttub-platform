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
    // PSQLException.getServerErrorMessage().getConstraint() 를 컴파일 타임에 참조한다 (/SPEC.md §6 #10).
    implementation("org.postgresql:postgresql")

    implementation("com.google.genai:google-genai:1.57.0")

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
    // 로컬 .env 의 GEMINI_API_KEY 를 실호출 스파이크로 전달한다(있을 때만).
    // 키가 없으면 GeminiSdkSpikeTest 의 실호출 케이스는 @EnabledIfEnvironmentVariable 로 건너뛴다.
    System.getenv("GEMINI_API_KEY")?.let {
        environment("GEMINI_API_KEY", it)
        // 실호출을 돌릴 참이면 샘플 영상도 있어야 한다. clean 뒤에도 자동으로 만들어진다.
        dependsOn("prepareSpikeVideo")
    }
    // 관문 ③ 은 100MB 급 영상을 만들고 실제로 올린다. 비싸고 느려서 기본으로 돌지 않는다 —
    // `-PenvelopeSpike` 를 줄 때만 켠다(`ProductionEnvelopeSpikeTest` 는 이 변수를 본다).
    if (project.hasProperty("envelopeSpike")) {
        environment("M4_ENVELOPE_SPIKE", "1")
        dependsOn("prepareEnvelopeVideos")
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
// 그렇게 깨졌다. 과거 버전 문서도 함께 실린다(빈 DB 재구축 경로가 쓴다).
tasks.named<org.gradle.language.jvm.tasks.ProcessResources>("processResources") {
    // 발행 절차 문서는 문서일 뿐이라 싣지 않는다. 파일들 옆에 두는 이유는 절차와 대상이
    // 갈리면 방침을 올릴 때 절차를 안 보게 되기 때문이다.
    exclude("consent-docs/README.md", "admissions/README.md")
}

/**
 * M0 Gemini 스파이크용 샘플 영상을 만든다. 저장소에 커밋하지 않는다(M0-spike.md 미결 사항).
 * 로컬에 ffmpeg 이 없어도 되도록 Docker 이미지를 쓴다 — Testcontainers 때문에 어차피 Docker 가 떠 있다.
 */
tasks.register("prepareSpikeVideo") {
    val output = layout.buildDirectory.file("spike/sample.mp4")
    outputs.file(output)
    doLast {
        val target = output.get().asFile
        target.parentFile.mkdirs()
        if (target.exists() && target.length() > 0) {
            logger.lifecycle("샘플 영상이 이미 있다: ${target.absolutePath}")
            return@doLast
        }
        providers.exec {
            commandLine(
                "docker", "run", "--rm",
                "-v", "${target.parentFile.absolutePath}:/out",
                "jrottenberg/ffmpeg:6.1-alpine",
                "-f", "lavfi", "-i", "testsrc=duration=6:size=320x240:rate=12",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
                "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", "-shortest",
                "/out/${target.name}"
            )
        }.result.get()
        logger.lifecycle("샘플 영상 생성: ${target.absolutePath} (${target.length()} bytes)")
    }
}

/**
 * M4 관문 ③(production-envelope) 용 영상 둘을 만든다. 저장소에 커밋하지 않는다.
 *
 * M0 의 PASS 는 6초·80KB 한 건이었다 — 실제 봉투는 그보다 세 자릿수 크다.
 *   - `envelope-raw.mp4`  : 업로드 상한(uploads.py:MAX_UPLOAD_BYTES = 100MB)에 근접한 원본.
 *     압축이 실패했을 때 이것이 그대로 Files API 로 간다 — SDK 의 다중 chunk 경로.
 *   - `envelope-compressed.mp4` : 위를 `compress.py:compress_for_gemini` 와 **같은 파라미터**로
 *     줄인 것. 운영에서 Gemini 로 가는 것은 보통 이쪽이다.
 *
 * 합성 영상이라 분석 품질은 볼 수 없다. 이 스파이크가 보는 것은 전송·실패 경로다.
 */
tasks.register("prepareEnvelopeVideos") {
    val rawFile = layout.buildDirectory.file("spike/envelope-raw.mp4")
    val compressedFile = layout.buildDirectory.file("spike/envelope-compressed.mp4")
    outputs.files(rawFile, compressedFile)
    doLast {
        val raw = rawFile.get().asFile
        val compressed = compressedFile.get().asFile
        val dir = raw.parentFile
        dir.mkdirs()

        // 크기를 crf 로 맞추려 하면 소스 내용에 따라 세 자릿수로 튄다(실측: testsrc 는 14MB,
        // 노이즈는 초당 35MB). 그래서 **비트레이트를 강제**한다 — 실제 봉투인
        // "120초 · 100MB" 는 곧 6.5Mbps 이고, 그것이 스마트폰 1080p 의 전형값이다.
        if (!raw.exists() || raw.length() == 0L) {
            providers.exec {
                commandLine(
                    "docker", "run", "--rm",
                    "-v", "${dir.absolutePath}:/out",
                    "jrottenberg/ffmpeg:6.1-alpine",
                    "-f", "lavfi", "-i", "testsrc=duration=120:size=1920x1080:rate=30",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=120",
                    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast",
                    // nal-hrd=cbr 이 없으면 libx264 가 단순한 소스에서 지정 비트레이트를
                    // 채우지 않는다 — 실측으로 6500k 를 줬는데 1.6Mbps 가 나왔다.
                    "-b:v", "6500k", "-x264-params", "nal-hrd=cbr:force-cfr=1",
                    "-minrate", "6500k", "-maxrate", "6500k", "-bufsize", "13000k",
                    "-c:a", "aac", "-b:a", "64k", "-shortest",
                    "/out/${raw.name}"
                )
            }.result.get()
        }
        logger.lifecycle("원본 영상: ${raw.absolutePath} (${raw.length()} bytes)")

        // acting-summary/compress.py:compress_for_gemini 와 **값까지 같은** 파라미터.
        // 하나라도 다르면 여기서 잰 크기가 운영을 대표하지 못한다.
        if (!compressed.exists() || compressed.length() == 0L) {
            providers.exec {
                commandLine(
                    "docker", "run", "--rm",
                    "-v", "${dir.absolutePath}:/out",
                    "jrottenberg/ffmpeg:6.1-alpine",
                    "-threads", "1", "-i", "/out/${raw.name}",
                    "-vf", "scale=w=768:h=768:force_original_aspect_ratio=decrease:force_divisible_by=2",
                    "-r", "10", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-ac", "1",
                    "-movflags", "+faststart", "-threads", "1",
                    "/out/${compressed.name}"
                )
            }.result.get()
        }
        logger.lifecycle("압축 영상: ${compressed.absolutePath} (${compressed.length()} bytes)")
        logger.lifecycle("압축률: ${"%.1f".format(100.0 * compressed.length() / raw.length())}%")
    }
}
