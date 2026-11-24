# acttub-platform

Acttub 플랫폼 모노레포입니다. 웹(`apps/web`)·백엔드(`apps/api`, acting-api)·모바일(`apps/mobile`)이 한 저장소에 있습니다.

- 폴더 구조: [ARCHITECTURE 「디렉토리 구조」](docs/ARCHITECTURE.md#디렉토리-구조)
- 작업 규칙과 문서 위치: [CLAUDE.md](CLAUDE.md)
- 검증: CI가 PR마다 돌리는 잡과 명령은 [ci.yml](.github/workflows/ci.yml)
- 브랜치·릴리스: [BRANCHING-STRATEGY](docs/BRANCHING-STRATEGY.md)
- 배포·운영: [홈서버 배포](docs/deploy/DEPLOY-HOME.md)

## 로컬 개발

두 터미널에서 API와 웹을 각각 실행합니다. API는 Docker 없이 뜨지만
테스트(`./gradlew test`)는 Testcontainers를 쓰므로 Docker가 필요합니다.

```bash
# 터미널 1
cd apps/api
DEVELOPMENT_AUTH_PROVIDER=1 ./gradlew bootRun

# 터미널 2 (저장소 루트)
pnpm dev
```

웹 개발 서버는 `http://localhost:3000`에서 실행되며 API 요청을 `http://127.0.0.1:8080`으로
프록시합니다([서버 경계](apps/web/CLAUDE.md#서버-경계)).

파일 저장소는 Cloudflare R2입니다. 올리기·재생을 쓰려면 dev 파일 버킷만 쓰는 R2 API 토큰으로 `S3_BUCKET`,
`S3_ENDPOINT`, `AWS_REGION=auto`는 `apps/api/.env`에 넣고, `AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY`는 `bootRun`의
환경 변수로 넘깁니다(뜻은 [`.env.example`](deploy/home/.env.example)). `.env`는 Spring 설정으로만 읽혀 AWS SDK가 키를
찾지 못하기 때문입니다. 저장소 설정이 없으면 API는 뜨지만 올리기는 503 `storage_not_configured`이고 재생 주소는 비어 있습니다.
