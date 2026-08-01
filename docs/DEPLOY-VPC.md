# VPC 2계층 배포 절차 (front svc + back svc)

CloudFront → front alb → front svc(Next 서버) → back alb → back svc(FastAPI) → DB 구조로
배포한다. 기존 dev/prod의 "FastAPI 단일 프로세스가 정적+API를 함께 서빙"과 다른 형태이며,
두 방식은 공존한다 — 기존 인스턴스는 이 문서의 영향을 받지 않는다.

가장 큰 차이는 **백엔드가 private subnet에 있어 브라우저가 직접 닿지 못한다**는 점이다.
모든 API 호출은 front svc의 Next rewrites 프록시를 통과한다. 덕분에 브라우저 입장에서는
CloudFront 도메인 하나만 보이므로 same-origin이 유지되고 CORS 설정이 필요 없다.

## 1. 저장소 쪽 변경 (완료됨)

- `apps/web/next.config.ts` — 서버 모드에 `output:'standalone'` 추가, 프록시 대상 환경변수를
  `API_ORIGIN`으로 통일(`DEV_API_ORIGIN`은 폴백으로 유지).
- `apps/web/package.json` — `build:server` 추가. 기존 `build`(정적 export)는 그대로 두어
  현행 dev/prod 배포가 계속 동작한다.
- `deploy/systemd/acttub-{web,api}.service` — 두 인스턴스용 유닛.

## 2. 인스턴스 부트스트랩 (런타임 설치)

새 인스턴스는 비어 있다. 배포 전에 런타임을 깔아야 한다. **배포판 기본 Node로는 안 된다** —
루트 `package.json`이 `engines: node >= 24`를 요구하는데 Ubuntu/AL2023 기본은 18~20이다.

### front svc

```bash
# Node 24 — nvm이 아니라 NodeSource로 깐다. nvm은 홈 디렉토리에 설치되어
# systemd 유닛의 ExecStart=/usr/bin/node 와 경로가 어긋난다.
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v            # v24.x 확인
sudo corepack enable
corepack prepare pnpm@11.1.2 --activate    # 루트 package.json의 packageManager와 일치
```

빌드를 EC2에서 하므로(4-1 참고) Next 빌드가 메모리를 꽤 쓴다. 인스턴스 메모리가 2GB
이하라면 스왑을 잡아두는 편이 안전하다.

### back svc

```bash
sudo apt-get install -y git
curl -LsSf https://astral.sh/uv/install.sh | sh
uv python install 3.11    # requires-python >= 3.11
which uv                  # systemd 유닛의 ExecStart 경로와 맞출 것
```

`uv`는 기본적으로 `~/.local/bin/uv`에 깔린다. `acttub-api.service`의 `ExecStart`가 이 경로를
가정하고 있으니 다르면 유닛을 고친다.

### 공통

저장소를 `/srv/acttub/acttub-platform`에 클론한다. private 저장소이므로 deploy key나
`gh auth`가 필요하다. 인스턴스는 NAT로 아웃바운드가 되므로 GitHub 접근 자체는 문제없다.

## 3. AWS 준비

### 3-1. SSM Session Manager (bastion 대체)

두 인스턴스 모두 private subnet이라 SSH로 직접 못 붙는다. bastion을 세우는 대신 SSM을 쓴다.

- 각 인스턴스의 **인스턴스 프로파일에 `AmazonSSMManagedInstanceCore` 정책**을 부착
- SSM Agent 실행 확인 (Amazon Linux 2023 / Ubuntu 공식 AMI는 기본 탑재)
- 아웃바운드 443이 NAT로 나가면 됨 — 인바운드 포트는 하나도 열지 않는다
- 로컬: `brew install --cask session-manager-plugin`

접속:

```bash
aws ssm start-session --target i-xxxxxxxx
```

`ssh`/`rsync`를 그대로 쓰려면 `~/.ssh/config`에 다음을 추가한다. 기존 배포 명령의 형태를
바꾸지 않아도 된다.

```
Host i-* mi-*
  ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p"
```

DB에 GUI 툴로 붙을 때만 포트 포워딩을 추가로 쓴다.

```bash
aws ssm start-session --target <back-svc-instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

### 3-2. 보안그룹

| 대상 | 인바운드 |
| --- | --- |
| front alb | CloudFront에서 443/80 |
| front svc | front alb SG에서 3000 |
| back alb | front svc SG에서 80 |
| back svc | back alb SG에서 8000 |
| DB | back svc SG에서 5432 |

back svc에 직접 인바운드를 열지 않는다. 브라우저는 back alb를 볼 일이 없다.

### 3-3. 환경변수 파일

`/etc/acttub/api.env` (back svc, 권한 `600`):

```
DATABASE_URL=postgresql://<user>:<pw>@<rds-endpoint>:5432/<db>
JWT_SECRET=<랜덤 문자열>
GEMINI_API_KEY=<키>
S3_BUCKET=<개발 버킷 이름>
AWS_ACCESS_KEY_ID=<키>
AWS_SECRET_ACCESS_KEY=<시크릿>
AWS_REGION=ap-northeast-2
ADMIN_OPS_TOKEN=<운영 대시보드 토큰>
```

`STATIC_DIR`은 **주지 않는다**. front svc가 화면을 서빙하므로 백엔드는 API만 담당한다.
값을 주면 FastAPI가 정적 파일을 함께 물면서 역할이 겹친다.

front svc는 런타임 환경변수가 필요 없다 (아래 4-1 참고 — 웹 설정은 전부 빌드 시점에 고정된다).

### 3-4. S3 개발 버킷 CORS

presigned PUT은 브라우저에서 S3로 직접 나가므로 버킷 CORS에 새 CloudFront 도메인을
**추가**해야 한다. dev와 공유하는 버킷이므로 **기존 항목은 절대 지우지 않는다** — 지우면
현재 dev 업로드가 즉시 깨진다.

```json
{
  "AllowedOrigins": ["https://<cloudfront-domain>"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"]
}
```

### 3-5. CloudFront 캐시 정책 ⚠️

기본 캐시 정책은 `Authorization` 헤더를 오리진으로 전달하지 않는다. 그대로 두면 로그인
직후부터 전 API가 401로 떨어진다.

- `/v2/*`, `/health` → **CachingDisabled** + Origin Request Policy에 `Authorization`,
  `Content-Type`, `X-Request-Id` 포함 (`AllViewer` 관리형 정책이 가장 간단)
- `/_next/static/*` → 캐싱 허용 (콘텐츠 해시가 붙어 안전)
- 기본 동작(`*`) → 캐싱 최소화. Next 서버가 HTML을 만들므로 과한 캐싱은 배포 반영을 늦춘다

### 3-6. ALB 헬스체크

- front alb → front svc: `/` (HTTP 200)
- back alb → back svc: `/health` — DB를 건드리지 않는 핸들러라 헬스체크로 안전하다

## 4. 배포

### 4-1. front svc (Next 서버)

**웹 설정은 전부 빌드 시점에 번들·매니페스트로 고정된다.** 런타임 환경변수로는 바뀌지 않는다.

- `API_ORIGIN` — rewrites는 빌드 시 `routes-manifest.json`으로 직렬화된다
- `NEXT_PUBLIC_*` — 클라이언트 번들에 그대로 새겨진다
- `NEXT_PUBLIC_API_BASE_URL`은 **비워둔다**. 값을 주면 브라우저가 백엔드를 직접 호출하는데,
  back alb는 private이라 전부 실패한다. 비어 있어야 상대 경로로 나가 프록시를 탄다

빌드 명령:

```bash
API_ORIGIN=http://<back-alb-dns> \
NEXT_PUBLIC_SITE_URL=https://<cloudfront-domain> \
pnpm --filter web build:server
```

**빌드는 front svc EC2에서 직접 하는 편을 권한다.** standalone 산출물은 `node_modules`
일부를 포함하므로 macOS에서 만든 결과가 리눅스에서 그대로 돈다는 보장이 없다. 기존
정적 export는 순수 HTML/JS라 플랫폼 무관이었지만 서버 모드는 다르다.

EC2에서 빌드하는 경우:

```bash
cd /srv/acttub/acttub-platform
git pull
pnpm install --frozen-lockfile
API_ORIGIN=http://<back-alb-dns> NEXT_PUBLIC_SITE_URL=https://<cloudfront-domain> \
  pnpm --filter web build:server
```

**standalone은 정적 자산을 자동으로 포함하지 않는다.** 빌드 직후 `.next/static`은 산출물
안에 없다(확인함). 이 복사를 빠뜨리면 화면이 스타일 없이 뜨거나 JS가 404로 죽는다 —
가장 흔한 실수다.

모노레포라 산출물이 트리 구조를 유지한다. `server.js`는 `apps/web/` 아래, `node_modules`는
그 상위에 놓이므로 **트리 전체를 통째로** 옮겨야 한다.

```
.next/standalone/
  node_modules/
  apps/web/
    server.js
```

```bash
rsync -a --delete apps/web/.next/standalone/ /srv/acttub/web/
mkdir -p /srv/acttub/web/apps/web/.next
cp -r apps/web/.next/static /srv/acttub/web/apps/web/.next/static
cp -r apps/web/public /srv/acttub/web/apps/web/public
```

systemd 유닛의 `WorkingDirectory`가 `/srv/acttub/web/apps/web`인 이유가 이것이다. 한 단계
위에서 실행하면 `server.js`를 못 찾고, `apps/web`만 떼어 옮기면 `node_modules`를 잃는다.

```bash
sudo cp deploy/systemd/acttub-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now acttub-web
```

### 4-2. back svc (FastAPI)

```bash
cd /srv/acttub/acttub-platform
git pull
cd apps/api && uv sync
sudo cp ../../deploy/systemd/acttub-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now acttub-api
```

유닛의 `ExecStart` 안 `uv` 경로는 설치 방식에 따라 다르다. `which uv`로 확인해 맞춘다.

### 4-3. DB 마이그레이션

back svc EC2가 이미 DB에 붙는 머신이므로, SSM으로 들어가 거기서 실행하면 된다.
별도 터널이 필요 없다.

```bash
aws ssm start-session --target <back-svc-instance-id>
cd /srv/acttub/acttub-platform/apps/api/acting-api
uv run alembic upgrade head
```

## 5. 검증 체크리스트

1. `curl http://<back-alb-dns>/health` — back svc 단독 확인 (front svc EC2 안에서 실행)
2. `curl https://<cloudfront-domain>/health` — 프록시 경로가 살아 있는지
3. 브라우저로 접속 → 스타일·JS가 정상인지 (4-1의 static 복사 검증)
4. 구글 로그인 → 401이 나면 CloudFront가 `Authorization`을 떨어뜨리는 것 (3-5)
5. 영상 업로드 → presigned PUT 실패 시 S3 CORS 확인 (3-4)
6. 분석 실행 → NAT를 통한 아웃바운드 LLM 호출 확인

## 6. 아직 남은 것

- **S3 자격증명이 access key 방식이다.** `apps/api/acting-api/src/acting_api/config.py`의
  `s3_configured`가 bucket/key/secret/region **넷 다** 있어야 True를 준다. 인스턴스 프로파일
  (IAM role)로 전환하려면 이 조건과 `storage.py`의 클라이언트 생성부를 함께 고쳐야 하며,
  별도 작업으로 분리한다. 지금은 개발 버킷의 access key를 그대로 주입해 넘어간다.
  S3 Gateway VPC Endpoint는 라우팅 계층이라 access key를 쓰더라도 사설 경로로 나간다.
- 루트 `CLAUDE.md`의 "운영 형태" 서술은 아직 단일 프로세스 방식을 가리킨다. 실제 운영이
  이 구조로 넘어간 뒤에 갱신한다 — 지금 바꾸면 현행 dev/prod 설명이 틀리게 된다.
  (`apps/web/CLAUDE.md`는 빌드 모드가 실제로 둘이 되었으므로 이미 갱신했다.)
