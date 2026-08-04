# 개발 서버 배포 절차 (단일 EC2)

운영 VPC 안에 개발 전용 서브넷을 하나 만들고, EC2 **한 대**에 Next 서버·FastAPI·
PostgreSQL을 모두 올린다. 앞단은 Caddy가 맡는다.

```
Cloudflare → EC2 1대 (운영 VPC / dev 퍼블릭 서브넷)
              └ Caddy :443
                 └ 127.0.0.1:3000  acttub-web.service   (Next standalone)
                     └ rewrites /v2/*, /health → 127.0.0.1:8000
                                    acttub-api.service   (FastAPI)
                                      └ localhost:5432   PostgreSQL
```

**운영([`DEPLOY-VPC.md`](./DEPLOY-VPC.md))과 프로세스 구성이 같고 ALB·CloudFront만
없다.** 그래서 `deploy/` 스크립트와 systemd 유닛을 양쪽이 그대로 공유한다. 다른 것은
GitHub Environments의 variables 값뿐이다.

| | dev | prod |
| --- | --- | --- |
| 인스턴스 | 1대 (web+api+DB) | fe·be 2대 |
| 앞단 | Caddy (Cloudflare 뒤) | CloudFront → ALB 2단 |
| `API_ORIGIN` | `http://127.0.0.1:8000` | `http://<back-alb-dns>` |
| DB | 같은 박스의 PostgreSQL | RDS |
| 배포 트리거 | `dev` 브랜치 push → 자동 | Actions 탭에서 수동 |
| 마이그레이션 | 배포에 포함(자동) | 수동 |

기존 dev 서버(`3.38.235.185`, FastAPI 단일 프로세스가 `STATIC_DIR`로 정적 서빙)는 이
문서로 대체된다. 새 서버를 검증한 뒤 DNS를 옮기고 폐기한다(6장).

## 1. AWS 콘솔 체크리스트

운영과 **같은 VPC**를 쓴다. 격리는 VPC 경계가 아니라 보안그룹과 IAM으로 만든다.

### 1-1. 서브넷

- 운영 VPC 안에 새 서브넷 `acttub-dev-a` — 비어 있는 /24 대역을 고른다
- **퍼블릭 서브넷으로 만든다**: 라우팅 테이블의 `0.0.0.0/0` → Internet Gateway,
  「퍼블릭 IPv4 주소 자동 할당」 켜기
- NAT Gateway를 태우지 않는 이유: dev 아웃바운드(LLM 호출·apt·PyPI)가 운영 NAT의
  비용·대역폭에 섞이지 않게 하려는 것이다. 별도 NAT를 세우면 EC2보다 비싸다
- 태그 `env=dev`

### 1-2. 보안그룹 `acttub-dev-sg`

| 방향 | 포트 | 소스 |
| --- | --- | --- |
| 인바운드 | 80, 443 | `0.0.0.0/0` (Cloudflare 경유) |
| 아웃바운드 | 전체 | `0.0.0.0/0` |

- **22도 열지 않는다.** 접속은 SSM Session Manager로 한다(2장). 퍼블릭 IP가 붙는
  서버라 인바운드를 80/443로만 두는 편이 낫고, 운영과 접속 방식도 통일된다
- **3000·8000·5432는 열지 않는다.** 전부 loopback으로만 통신한다
- **운영 보안그룹을 소스로 참조하지 않는다.** 이 규칙 하나가 dev↔prod 경계다.
  반대로 운영 SG 쪽에도 이 SG를 추가하지 않는다

### 1-3. EC2

- Ubuntu 24.04, **t3.medium 권장** (프로세스 3개 + PostgreSQL이라 2GB는 빠듯하다)
- 위 서브넷·보안그룹, IAM 인스턴스 프로파일은 아래 1-5
- **키페어 없이 만든다.** 접속은 SSM으로 하므로 필요 없다
- EBS gp3 30GB 이상
- 태그 `env=dev`, Name `acttub-dev`

띄운 직후 SSM 등록부터 확인한다. 부트스트랩 전이라 등록이 안 되면(대개 인스턴스
프로파일 누락) 지우고 다시 만드는 것이 가장 빠르다.

```bash
aws ssm describe-instance-information \
  --query "InstanceInformationList[].{id:InstanceId,ping:PingStatus}" --output table
```

### 1-4. S3 배포 버킷

새 버킷 `acttub-deploy-dev`를 만든다(리전 `ap-northeast-2`, 퍼블릭 차단 유지).

버킷을 나누면 `deploy/` 스크립트의 `fe/`·`be/` prefix를 그대로 쓸 수 있고 IAM 정책도
버킷 단위로 깔끔해진다. **영상 업로드용 개발 S3 버킷은 기존 것을 그대로 쓴다** —
도메인이 `dev.acttub.com`으로 유지되므로 버킷 CORS는 건드릴 필요가 없다.

### 1-5. 인스턴스 프로파일 `acttub-dev-instance`

EC2에 붙일 role이다.

- 관리형 정책 `AmazonSSMManagedInstanceCore` (SSM 접속·Run Command에 필수)
- 인라인 정책:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::acttub-deploy-dev/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::acttub-deploy-dev" }
  ]
}
```

### 1-6. 배포용 role `acttub-github-deploy-dev` (OIDC)

OIDC 공급자는 운영 설정 때 이미 등록되어 있다(`DEPLOY-VPC.md` 6-1). role만 새로 만든다.

신뢰 정책 — `sub`의 `environment:dev`가 **핵심**이다. 이게 있어야 dev 워크플로가 이
role만 쓸 수 있고, 반대로 dev 잡이 운영 인스턴스에 손댈 수 없다.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::<계정ID>:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:acttub/acttub-platform:environment:dev"
      }
    }
  }]
}
```

권한 정책 — 인스턴스 ID를 dev 것 **하나만** 적는다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::acttub-deploy-dev/*" },
    { "Effect": "Allow", "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ssm:*::document/AWS-RunShellScript",
        "arn:aws:ec2:ap-northeast-2:<계정ID>:instance/<dev 인스턴스 ID>"
      ] },
    { "Effect": "Allow", "Action": "ssm:GetCommandInvocation", "Resource": "*" }
  ]
}
```

> **함께 할 것**: 운영 role의 신뢰 정책에도 `"...:sub": "repo:acttub/acttub-platform:environment:prod"`
> 조건을 넣어 좁힌다. 지금은 `repo:acttub/acttub-platform:*`라 이론상 dev 잡에서도
> assume할 수 있다.

## 2. 인스턴스 부트스트랩

한 번만 수행한다. SSH가 아니라 SSM으로 접속한다(로컬에 플러그인이 필요하다:
`brew install --cask session-manager-plugin`).

```bash
aws ssm start-session --target <dev 인스턴스 ID>
```

**SSM은 `ssm-user` 계정으로 들어온다.** 서비스는 `ubuntu`로 돌기 때문에, 홈에 뭔가
설치하거나 파일을 만드는 작업은 `sudo su - ubuntu`로 계정을 바꾼 뒤에 한다. `sudo`가
붙는 시스템 작업(패키지 설치·`mkdir`·`systemctl`)은 어느 계정에서 하든 같다.

### 2-1. 런타임

```bash
# aws CLI — S3에서 아티팩트를 받는다
sudo snap install aws-cli --classic
aws sts get-caller-identity          # Arn에 acttub-dev-instance가 보이면 정상

# Node 24 — 루트 package.json이 engines: node >= 24 를 요구한다.
# nvm이 아니라 NodeSource로 깐다(유닛의 ExecStart=/usr/bin/node 와 맞춰야 한다).
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs && node -v

# uv — 홈이 아니라 시스템 경로에 둔다. SSM은 ssm-user로 들어오는데 서비스는
# ubuntu로 돌기 때문에, 홈에 두면 서비스가 uv를 못 찾는다.
curl -LsSf https://astral.sh/uv/install.sh | sh
sudo mv ~/.local/bin/uv ~/.local/bin/uvx /usr/local/bin/
/usr/local/bin/uv --version
```

인스턴스에 git·pnpm은 필요 없다. 빌드는 전부 GitHub Actions runner에서 한다.

### 2-2. PostgreSQL

```bash
sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE USER acttub WITH PASSWORD '<비밀번호>';"
sudo -u postgres psql -c "CREATE DATABASE acttub OWNER acttub;"
psql "postgresql://acttub:<비밀번호>@localhost:5432/acttub" -c '\conninfo'
```

외부에 열지 않는다(`listen_addresses`는 기본값 localhost 그대로). DataGrip 등 GUI 툴로
붙을 때는 SSM 포트 포워딩을 쓴다 — DB가 인스턴스 안에 있으므로 `RemoteHost` 문서가
아니라 아래 기본 문서다. 이후 `localhost:15432`로 접속한다.

```bash
aws ssm start-session --target <dev 인스턴스 ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["15432"]}'
```

### 2-3. 디렉토리와 환경변수

```bash
sudo mkdir -p /svc/acttub/web /svc/acttub/acttub-platform/apps/api
sudo chown -R ubuntu:ubuntu /svc/acttub
sudo mkdir -p /etc/acttub
```

`/etc/acttub/api.env` (권한 `600`) — 기존 dev 서버의 `apps/api/acting-api/.env`를 그대로
옮기고 `DATABASE_URL`만 바꾸는 것이 가장 안전하다. 값 누락은 배포가 아니라 런타임에
드러나므로, 양쪽 키 목록을 비교해 빠진 것이 없는지 확인한다.

```bash
# 기존 dev 서버에서 (선행 공백이 있는 줄이 있으므로 = 앞을 그대로 잘라낸다)
grep -oE '^[[:space:]]*[A-Za-z0-9_]+=' .env | tr -d ' ='
```

```
DATABASE_URL=postgresql://acttub:<비밀번호>@localhost:5432/acttub
JWT_SECRET=<랜덤 문자열>
GEMINI_API_KEY=<키>
S3_BUCKET=<기존 개발 버킷>
AWS_ACCESS_KEY_ID=<키>
AWS_SECRET_ACCESS_KEY=<시크릿>
AWS_REGION=ap-northeast-2
ADMIN_OPS_TOKEN=<토큰>
APPLE_OAUTH_CLIENT_ID=com.acttub.app,com.acttub.web
DEVELOPMENT_AUTH_PROVIDER=1
```

**`STATIC_DIR`은 주지 않는다.** 화면은 Next 서버가 서빙한다. 값을 주면 FastAPI가 정적
파일까지 물면서 역할이 겹친다 — 기존 dev 서버와 가장 크게 달라지는 지점이다.

### 2-4. Caddy

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```
# Cloudflare 뒤라 내부 인증서로 충분하다(기존 dev 서버와 같은 구성).
dev.acttub.com {
	tls internal
	reverse_proxy 127.0.0.1:3000
}

# DNS를 옮기기 전, 퍼블릭 IP로 직접 검증하기 위한 임시 블록. 전환이 끝나면 지운다.
:80 {
	reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

`/v2/*`와 `/health`는 Caddy에서 나누지 않는다 — Next의 rewrites가 백엔드로 넘긴다.
운영에서도 같은 경로를 타므로 프록시 동작이 dev에서 그대로 검증된다.

## 3. GitHub 설정

Settings → Environments → **`dev`** 생성. 보호 규칙(승인자)은 걸지 않는다 — 자동 배포가
목적이다. 운영용 `prod` 환경에는 필요하면 승인자를 건다.

`dev` 환경의 **Variables**:

| 이름 | 값 |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<계정ID>:role/acttub-github-deploy-dev` |
| `DEPLOY_BUCKET` | `acttub-deploy-dev` |
| `API_ORIGIN` | `http://127.0.0.1:8000` |
| `NEXT_PUBLIC_SITE_URL` | `https://dev.acttub.com` |
| `FE_INSTANCE_ID` | dev 인스턴스 ID |
| `BE_INSTANCE_ID` | **같은** dev 인스턴스 ID |

환경 variables는 저장소 variables보다 우선하므로, 운영 값은 저장소 쪽에 그대로 두거나
`prod` 환경으로 옮기면 된다.

## 4. 배포

`.github/workflows/deploy.yml` 하나가 dev·prod를 모두 처리한다.

- **자동**: `dev` 브랜치에 머지되면 `fe`·`be` 두 잡이 함께 돈다. dev로 들어오는 경로는
  PR뿐이고 그 PR은 `ci.yml` 게이트를 통과했으므로 배포 워크플로는 테스트를 다시 돌리지
  않는다
- **수동**: Actions → Deploy → Run workflow에서 환경(`dev`/`prod`)과 대상(`fe`/`be`/`both`)을
  고른다

dev는 인스턴스가 한 대라 두 잡이 같은 박스에 동시에 설치된다. 경로가 겹치지 않아
충돌하지 않지만, 잡이 끝나는 순서에 따라 잠깐 새 프론트 + 옛 API 조합이 될 수 있다.
계약이 깨지는 변경을 확인할 때는 `both` 대신 `be` → `fe` 순으로 수동 실행한다.

**마이그레이션은 dev에서만 자동으로 돈다.** `deploy/ssm-deploy.sh`가 `MIGRATE=1`일 때
`uv sync` 뒤·재시작 전에 `alembic upgrade head`를 실행한다. 운영은 되돌리기가 어려워
지금처럼 수동이다(`DEPLOY-VPC.md` 4-3).

## 5. 검증 체크리스트

DNS를 옮기기 전에는 퍼블릭 IP로 확인한다.

1. `systemctl status acttub-api acttub-web caddy` — 셋 다 active
2. `curl localhost:8000/health` — 백엔드 단독
3. `curl localhost:3000/health` — Next rewrites가 백엔드로 넘기는지 (**dev·prod 공통 경로**)
4. `curl http://<퍼블릭 IP>/` — Caddy 경유
5. 브라우저로 접속 → 스타일·JS 정상 (standalone의 `.next/static` 병합 검증)
6. 구글 로그인 → 영상 업로드 → 분석 실행
7. `sudo -u ubuntu env DATABASE_URL=... /usr/local/bin/uv run --no-dev alembic current` — 리비전 확인

## 6. DNS 전환과 기존 서버 폐기

1. 위 검증을 모두 통과시킨다
2. Cloudflare에서 `dev.acttub.com` A 레코드를 새 인스턴스 퍼블릭 IP로 변경
3. `curl https://dev.acttub.com/health` 확인. 문제가 생기면 **레코드를 되돌리면 끝이다** —
   기존 서버는 아직 그대로 떠 있다
4. 며칠 지켜본 뒤 기존 인스턴스(`3.38.235.185`)를 중지 → 스냅샷 → 종료
5. Caddyfile의 임시 `:80` 블록을 지우고 `sudo systemctl reload caddy`
6. 루트 `CLAUDE.md`의 "운영 형태" 서술과 dev 관련 문서를 이 구조로 갱신
