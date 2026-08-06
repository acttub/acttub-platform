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
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-ui:2.8.6")
    implementation("com.nimbusds:nimbus-jose-jwt:9.48")
    implementation(platform("software.amazon.awssdk:bom:2.31.30"))
    implementation("software.amazon.awssdk:s3")
    // runtimeOnly 가 아니라 implementation 이다. 제약명 문자열로 유니크 위반을 가르는 코드가
    // PSQLException.getServerErrorMessage().getConstraint() 를 컴파일 타임에 참조한다 (/SPEC.md §6 #10).
    implementation("org.postgresql:postgresql")

    // M0 스파이크 전용. SDK 채택이 확정되면 M4 에서 implementation 으로 올린다.
    testImplementation("com.google.genai:google-genai:1.57.0")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:junit-jupiter")
    testImplementation("org.testcontainers:postgresql")

    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    systemProperty("file.encoding", "UTF-8")

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
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    archiveFileName = "acting-api.jar"
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
