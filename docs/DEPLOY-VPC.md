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

새 인스턴스는 비어 있다. 배포 전에 런타임을 깔아야 한다.

**빌드는 전부 로컬에서 하므로 인스턴스에 git·pnpm은 필요 없다.** 산출물과 소스를 S3로
보내고, 인스턴스는 그것을 받아 실행하기만 한다. 저장소를 클론하지 않으니 deploy key도
필요 없다.

### 공통 — aws CLI

S3에서 아티팩트를 받으려면 필요하다. Ubuntu 24.04 기본 이미지에는 없다.

```bash
sudo snap install aws-cli --classic
aws sts get-caller-identity    # Arn에 인스턴스 role 이름이 나오면 정상
```

**인스턴스에서는 `aws configure`를 하지 않는다.** 인스턴스 role이 자격증명을 자동으로
제공하므로, 키를 넣으면 오히려 role을 덮어쓴다. `aws configure`는 업로드하는 로컬 맥에서만
필요하다.

Gateway VPC Endpoint는 S3로 가는 *경로*를 사설망으로 돌릴 뿐, 요청을 대신 만들어주지
않는다. 그래서 Endpoint가 있어도 인스턴스 안에 요청을 보낼 도구가 필요하다.

### front svc — Node만

**배포판 기본 Node로는 안 된다.** 루트 `package.json`이 `engines: node >= 24`를 요구하는데
Ubuntu/AL2023 기본은 18~20이다.

```bash
# nvm이 아니라 NodeSource로 깐다. nvm은 홈 디렉토리에 설치되어
# systemd 유닛의 ExecStart=/usr/bin/node 와 경로가 어긋난다.
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v            # v24.x 확인
sudo mkdir -p /svc/acttub/web && sudo chown ubuntu:ubuntu /svc/acttub/web
```

### back svc — uv만

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# 설치는 홈(~/.local/bin)에 들어간다. 시스템 경로로 옮겨 계정에 묶이지 않게 한다.
sudo mv ~/.local/bin/uv ~/.local/bin/uvx /usr/local/bin/
/usr/local/bin/uv --version

sudo mkdir -p /svc/acttub/acttub-platform/apps/api
sudo chown -R ubuntu:ubuntu /svc/acttub
```

**uv를 홈에 두면 안 된다.** SSM으로 접속하면 `ssm-user`로 들어가는데 서비스는 `ubuntu`로
돌기 때문에, 홈에 설치하면 서비스가 uv를 찾지 못한다. `acttub-api.service`의 `ExecStart`가
`/usr/local/bin/uv`를 가리키는 이유가 이것이다.

파이썬은 `uv python install`로 받지 말고 **시스템 python3을 쓴다** — uv가 받는 파이썬도
실행 계정의 홈에 깔려 같은 문제가 반복된다. `python3 --version`이 3.11 이상이면 그대로
쓰면 된다(`requires-python >= 3.11`).

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

**SSM 콘솔·CLI 접속은 `ssm-user` 계정으로 들어간다.** 서비스는 `ubuntu`로 돌기 때문에,
홈에 뭔가 설치하거나 파일을 만드는 작업은 `sudo su - ubuntu`로 계정을 바꾼 뒤에 한다.
`sudo`가 붙는 시스템 작업(패키지 설치, `mkdir`, `systemctl`)은 어느 계정에서 하든 같다.

파일 전송은 S3를 경유하므로(4장) SSH 키가 필요 없다. 굳이 `ssh`/`rsync`를 쓰고 싶다면
`~/.ssh/config`에 아래를 넣으면 되지만, 인스턴스에 키페어가 등록되어 있어야 한다.

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
S3_BUCKET=<운영 버킷 이름 — acttub-practice-videos-prod>
AWS_REGION=ap-northeast-2
ADMIN_OPS_TOKEN=<운영 대시보드 토큰>
```

S3 자격증명은 back svc의 EC2 instance role에서 boto3 기본 체인으로 받는다. 이 파일에
`AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY`를 넣으면 환경변수 provider가 role보다 우선하므로
정상 상태에서는 두 값을 두지 않는다.

**`S3_BUCKET`이 있는데 자격증명을 못 찾으면 API가 아예 기동하지 않는다** — 업로드만 503이
되는 게 아니라 로그인을 포함한 전 기능이 멈춘다. 무자격증명으로 뜬 프로세스는 botocore가
클라이언트 생성 시점의 자격증명을 고정하는 탓에 IMDS가 회복돼도 스스로 낫지 못하므로,
조용히 반쯤 죽은 상태로 트래픽을 받느니 기동을 거부하고 systemd가 재시도하게 두는 쪽을
택했다. 그래서 role 권한을 손대거나 키를 지우기 전에 반드시 서비스 계정(`ubuntu`)으로
접근을 먼저 확인한다.

`STATIC_DIR`은 **주지 않는다**. front svc가 화면을 서빙하므로 백엔드는 API만 담당한다.
값을 주면 FastAPI가 정적 파일을 함께 물면서 역할이 겹친다.

front svc는 런타임 환경변수가 필요 없다 (아래 4-1 참고 — 웹 설정은 전부 빌드 시점에 고정된다).

### 3-4. S3 운영 버킷 CORS

presigned PUT은 브라우저에서 S3로 직접 나가므로 서비스 도메인을 버킷 CORS에
**추가**해야 한다. **기존 항목은 절대 지우지 않는다** — 지우면 그 오리진의 업로드가 즉시
깨진다.

버킷은 dev와 나눠 쓴다: 운영은 `acttub-practice-videos-prod`, dev는 `-dev`다. 각 EC2의
instance role이 자기 버킷 객체만 허용하므로 `S3_BUCKET`을 반대쪽으로 적으면 자격증명
해석과 `/health`는 성공하는데 실제 PUT/GET만 403이 된다.

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

**빌드는 로컬(맥)에서 하고 산출물만 보낸다.** EC2에는 git도 pnpm도 필요 없다.
아래 과정을 `deploy/upload-web.sh`가 대신하므로 평소에는 이것만 실행하면 된다.

```bash
DEPLOY_BUCKET=<배포 버킷> API_ORIGIN=http://<back-alb-dns> \
  deploy/upload-web.sh
```

빌드 → sharp 제외 → 정적 자산 병합 → 네이티브 바이너리 잔존 검사 → S3 업로드까지
하고, 인스턴스에서 이어서 칠 명령을 출력한다. 아래는 그 스크립트가 무슨 일을 하는지에
대한 설명이다.

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

### sharp를 제외해야 한다 ⚠️

standalone에는 `sharp`의 **빌드한 플랫폼 전용** 네이티브 바이너리가 딸려온다
(맥에서 빌드하면 `sharp-darwin-arm64.node`). `images.unoptimized`를 켜도 Next의 의존성
트레이싱이 무조건 포함시키므로 설정으로는 뺄 수 없다. 그대로 리눅스로 옮기면 로드에
실패하므로 **전송에서 제외한다.** 이미지 최적화를 쓰지 않아 실제로 로드되지 않는다.

제외하면 산출물에 네이티브 바이너리가 하나도 남지 않아(45M → 27M) 플랫폼 무관해진다.
맥에서 sharp를 뺀 채 기동해 페이지·정적 자산·프록시가 모두 정상 동작함을 확인했다.

`--exclude '*sharp*'`가 핵심이다. `upload-web.sh`는 패키징 후 `*.node` 파일이 남아 있으면
업로드하지 않고 멈춘다 — 리눅스에서 기동 실패로 이어지는 것을 미리 막기 위해서다.

**전송은 S3를 경유한다.** 배포 버킷 하나에 prefix로 나눈다(`fe/`, `be/`). 인스턴스는
S3 Gateway VPC Endpoint로 사설 경로를 통해 받으므로 SSH 키가 필요 없다.

```
s3://<배포 버킷>/
  fe/<타임스탬프>-<git sha>.tar.gz
  fe/latest.tar.gz          # 인스턴스에서 늘 같은 명령으로 받기 위한 별칭
  fe/acttub-web.service
```

디렉토리를 `s3 sync`로 올리지 않고 tar.gz 하나로 묶는 이유는, standalone이 27MB에 파일이
수천 개여서 요청 수가 많고 중간에 끊기면 반만 올라간 상태가 되기 때문이다.

인스턴스 쪽 (SSM으로 접속해서):

```bash
aws s3 cp s3://<배포 버킷>/fe/latest.tar.gz /tmp/web.tar.gz
sudo rm -rf /svc/acttub/web/* && sudo tar xzf /tmp/web.tar.gz -C /svc/acttub/web
sudo chown -R ubuntu:ubuntu /svc/acttub/web
```

인스턴스 IAM role에 해당 prefix 권한이 있어야 한다. 인라인 정책 예(front svc):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<배포 버킷>/fe/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<배포 버킷>",
      "Condition": { "StringLike": { "s3:prefix": "fe/*" } } }
  ]
}
```

back svc는 `fe`를 `be`로 바꾼다. **prefix 조건 때문에 버킷 루트 조회
(`aws s3 ls s3://<배포 버킷>/`)는 정책이 있어도 AccessDenied가 난다** — 의도된 동작이다.
확인은 `aws s3 ls s3://<배포 버킷>/fe/`로 한다.

systemd 유닛의 `WorkingDirectory`가 `/svc/acttub/web/apps/web`인 이유가 이것이다. 한 단계
위에서 실행하면 `server.js`를 못 찾고, `apps/web`만 떼어 옮기면 `node_modules`를 잃는다.

유닛 파일도 같은 버킷에 함께 올라간다.

```bash
aws s3 cp s3://<배포 버킷>/fe/acttub-web.service /tmp/
sudo mv /tmp/acttub-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now acttub-web
systemctl status acttub-web --no-pager
```

### 4-2. back svc (FastAPI)

여기도 git이 필요 없다. 파이썬 소스를 그대로 보내고 인스턴스에서는 의존성만 받는다.
`uv.lock`에 git 의존성이 없어(확인함) `uv sync`는 PyPI만 본다.

```bash
# 로컬에서
DEPLOY_BUCKET=<배포 버킷> deploy/upload-api.sh
```

`.venv`는 플랫폼 종속이라 보내지 않는다 — 인스턴스에서 `uv sync`로 새로 만든다.
`.env`도 제외한다. 운영 값은 `/etc/acttub/api.env`가 담당한다.

```bash
# SSM으로 접속해 인스턴스에서
aws s3 cp s3://<배포 버킷>/be/latest.tar.gz /tmp/api.tar.gz
sudo rm -rf /svc/acttub/acttub-platform/apps/api
sudo tar xzf /tmp/api.tar.gz -C /svc/acttub/acttub-platform/apps
sudo chown -R ubuntu:ubuntu /svc/acttub
sudo -u ubuntu bash -c 'cd /svc/acttub/acttub-platform/apps/api && uv sync'

aws s3 cp s3://<배포 버킷>/be/acttub-api.service /tmp/
sudo mv /tmp/acttub-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now acttub-api
```

`uv sync`는 반드시 `ubuntu` 계정으로 실행한다. SSM 접속 계정(`ssm-user`)으로 만들면
`.venv` 소유자가 어긋나 서비스가 기동하지 못한다.

유닛의 `ExecStart` 안 `uv` 경로는 설치 방식에 따라 다르다. `which uv`로 확인해 맞춘다.

### 4-3. DB 마이그레이션

back svc EC2가 이미 DB에 붙는 머신이므로, SSM으로 들어가 거기서 실행하면 된다.
별도 터널이 필요 없다.

```bash
aws ssm start-session --target <back-svc-instance-id>
cd /svc/acttub/acttub-platform/apps/api/acting-api
uv run alembic upgrade head
```

## 5. 검증 체크리스트

1. `curl http://<back-alb-dns>/health` — back svc 단독 확인 (front svc EC2 안에서 실행)
2. `curl https://<cloudfront-domain>/health` — 프록시 경로가 살아 있는지
3. 브라우저로 접속 → 스타일·JS가 정상인지 (4-1의 static 복사 검증)
4. 구글 로그인 → 401이 나면 CloudFront가 `Authorization`을 떨어뜨리는 것 (3-5)
5. 영상 업로드 → presigned PUT 실패 시 S3 CORS 확인 (3-4)
6. 분석 실행 → NAT를 통한 아웃바운드 LLM 호출 확인

## 6. GitHub Actions 자동 배포 (OIDC)

`.github/workflows/deploy.yml`이 빌드 → S3 업로드 → SSM 설치를 한 번에 한다. Actions
탭에서 수동 실행(`workflow_dispatch`)하며, 환경(`dev`/`prod`)과 대상(`fe`·`be`·`both`)을
고른다.

같은 워크플로가 개발 서버 배포도 담당한다(`dev` 브랜치 push 시 자동). 환경별로 다른
값은 GitHub Environments의 variables가 담당하므로 워크플로 안에는 환경 분기가 없다 —
개발 서버 쪽 절차는 [`DEPLOY-DEV.md`](./DEPLOY-DEV.md)를 본다.

**runner는 인스턴스에 접속하지 않는다.** SSM Run Command로 AWS에 실행을 위임하므로
private subnet이어도 되고, SSH 키나 VPN이 필요 없다.

### 6-1. AWS — OIDC 공급자 등록

IAM → 자격 증명 공급자 → 공급자 추가 → OpenID Connect

- 공급자 URL: `https://token.actions.githubusercontent.com`
- 대상(Audience): `sts.amazonaws.com`

### 6-2. AWS — 배포용 role 생성

신뢰 정책(trust policy). `sub` 조건이 **이 저장소로만** 제한하는 부분이라 빠뜨리면
안 된다 — 없으면 아무 GitHub 저장소나 이 role을 가져다 쓸 수 있다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<계정ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:acttub/acttub-platform:*"
        }
      }
    }
  ]
}
```

권한 정책:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::<배포 버킷>/*"
    },
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ssm:*::document/AWS-RunShellScript",
        "arn:aws:ec2:<리전>:<계정ID>:instance/<fe 인스턴스 ID>",
        "arn:aws:ec2:<리전>:<계정ID>:instance/<be 인스턴스 ID>"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

`ssm:SendCommand`의 Resource에 **문서와 인스턴스를 모두** 적어야 한다. 인스턴스만 적으면
document 권한이 없다고 거부된다.

### 6-3. GitHub — 저장소 변수 등록

Settings → Secrets and variables → Actions → **Variables** 탭. 민감한 값이 아니므로
Secrets가 아니라 Variables에 넣는다.

| 이름 | 값 |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<계정ID>:role/<role 이름>` |
| `DEPLOY_BUCKET` | 배포 버킷 이름 |
| `API_ORIGIN` | `http://<back-alb-dns>` |
| `NEXT_PUBLIC_SITE_URL` | CloudFront 도메인 (없으면 비워둔다) |
| `FE_INSTANCE_ID` | front svc 인스턴스 ID |
| `BE_INSTANCE_ID` | back svc 인스턴스 ID |

`API_ORIGIN`을 바꾸면 **반드시 fe를 재배포해야 한다.** 빌드 시점에 굳는 값이라 인스턴스만
재시작해서는 반영되지 않는다.

### 6-4. 운영 마이그레이션은 자동화하지 않는다

운영 배포에서 workflow는 `alembic upgrade head`를 실행하지 않는다. 스키마 변경은
되돌리기 어렵고 배포와 수명주기가 다르므로, 4-3처럼 SSM으로 접속해 수동으로 실행한다.

dev 배포에서는 자동으로 돈다(`ssm-deploy.sh`의 `MIGRATE=1`). 개발 DB는 되돌리기보다
다시 만드는 편이 빠르고, 스키마 변경을 즉시 반영하는 쪽이 실용적이기 때문이다.

## 7. 아직 남은 것

- 루트 `CLAUDE.md`의 "운영 형태" 서술은 아직 단일 프로세스 방식을 가리킨다. 실제 운영이
  이 구조로 넘어간 뒤에 갱신한다 — 지금 바꾸면 현행 dev/prod 설명이 틀리게 된다.
  (`apps/web/CLAUDE.md`는 빌드 모드가 실제로 둘이 되었으므로 이미 갱신했다.)
