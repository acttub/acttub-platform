# acting-api 런타임 이미지. 멀티스테이지가 아니다 — jar 는 밖에서(로컬·Actions) 만든다.
#
#   (cd apps/api && ./gradlew bootJar)
#   docker build -t acttub-api:local apps/api        # 빌드 컨텍스트 = apps/api
#
# 컨텍스트에서 jar 하나만 올라온다(apps/api/.dockerignore). 환경 무관 이미지 하나이며
# 설정은 전부 런타임 env 로 받는다(deploy/home/compose.yml, .env.example).
FROM eclipse-temurin:21-jre-noble

# ffmpeg·ffprobe 는 영상 압축(GeminiVideoCompressor)·음성 추출(FfmpegAudioExtractor)·
# 길이 측정(VideoDurationProbe)이 PATH 에서 찾는다. 문서에 없던 호스트 의존을 이미지에 넣는다.
# curl 은 compose healthcheck 와 배포 스크립트의 /health 확인이 쓴다.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

# non-root. 고정 uid 라 볼륨을 붙이더라도 호스트 쪽 소유권을 예측할 수 있다.
RUN useradd --system --uid 10001 --user-group --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
COPY --chown=app:app build/libs/acting-api.jar /app/acting-api.jar
USER app

# 힙은 컨테이너 메모리 상한의 비율로 잡는다(systemd 의 고정 -Xmx512m 대체). 상한은 compose 의
# deploy.resources.limits.memory 가 준다. OOM 이면 프로세스를 끝내 restart 정책이 다시 띄우게 한다 —
# 살아 있되 요청마다 OOM 을 내는 상태보다 낫다. 이 env 는 compose .env 로 덮어쓸 수 있다.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError"

# 문서용이다 — 호스트에 publish 하지 않는다(홈서버 8080 은 다른 서비스가 쓴다).
EXPOSE 8080
# 격리한 jar 는 dotenv 를 끈다(apps/api/CLAUDE.md 「로컬 설정」). 설정은 컨테이너 env 로만 들어온다.
ENTRYPOINT ["java", "-Dacttub.dotenv.enabled=false", "-jar", "/app/acting-api.jar"]
