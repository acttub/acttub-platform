#!/usr/bin/env bash
# 개발 서버(단일 EC2) 런타임을 설치한다. 인스턴스 안에서 root로 실행한다.
#
# SSM Run Command로 보내는 것이 가장 간단하다(로컬 맥에서):
#
#   B64=$(base64 -i deploy/bootstrap-dev.sh | tr -d '\n')
#   aws ssm send-command --instance-ids <dev 인스턴스 ID> \
#     --document-name AWS-RunShellScript --timeout-seconds 3600 \
#     --parameters "commands=[\"echo $B64 | base64 -d | bash\"]"
#
# 여러 번 실행해도 안전하다(멱등). 단 DB와 api.env는 이미 있으면 건드리지 않는다 —
# 비밀번호를 다시 만들면 기존 DATABASE_URL과 어긋나기 때문이다.
#
# 설치하지 않는 것: 애플리케이션. 그건 GitHub Actions가 S3+SSM으로 배포한다.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
umask 022

echo "=== 0. 파일시스템 확장 확인 ==="
# 콘솔에서 EBS를 키워도 파티션·파일시스템은 따라 늘지 않는 경우가 있다.
ROOT_SRC=$(findmnt -no SOURCE /)
DISK=$(lsblk -no PKNAME "$ROOT_SRC")
PART=$(echo "$ROOT_SRC" | grep -oE '[0-9]+$')
growpart "/dev/$DISK" "$PART" || true
resize2fs "$ROOT_SRC" || true
df -h / | tail -1

echo "=== 1. swap 2GB ==="
# Next 빌드 산출물 전개와 JVM 기동이 겹치는 순간을 위해 완충은 남겨둔다. 다만 크게
# 잡지 않는다 — JVM이 swap에 들어가면 GC가 힙 전체를 디스크에서 훑게 되어 응답시간이
# 초 단위로 튄다(docs/archive/soma287/M5-cutover.md §B). t2.micro(1GB) 시절에는 4GB였다.
if swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  echo "  이미 있음"
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# 상시 스와핑은 t2 CPU 크레딧을 갉아먹으므로 기본값(60)보다 낮춘다.
sysctl -w vm.swappiness=20 >/dev/null
grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=20' >> /etc/sysctl.conf
free -h | head -2

echo "=== 2. apt 갱신 ==="
apt-get update -qq

echo "=== 3. aws CLI ==="
# S3에서 배포 아티팩트를 받는 데 필요하다. Ubuntu 기본 이미지에는 없다.
if command -v aws >/dev/null; then echo "  이미 있음"; else snap install aws-cli --classic; fi
aws --version 2>&1 | head -1

echo "=== 4. Node 24 ==="
# 루트 package.json이 engines: node >= 24 를 요구한다(배포판 기본은 18~20).
# nvm이 아니라 NodeSource로 깐다 — nvm은 홈에 설치되어 유닛의
# ExecStart=/usr/bin/node 와 경로가 어긋난다.
if command -v node >/dev/null && node -v | grep -q '^v24'; then echo "  이미 있음"; else
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
node -v

echo "=== 5. JRE 21 ==="
# 백엔드 배포 아티팩트는 jar 하나뿐이라 인스턴스에 필요한 것은 JRE 다(SOMA-403 5단계).
# ssm-deploy.sh 의 be-java 모드도 없으면 여기서 깔지만, 첫 배포를 4분짜리 apt 설치로
# 시작하지 않도록 새 서버를 세울 때 미리 깐다. 둘 다 멱등이다.
if command -v java >/dev/null; then echo "  이미 있음"; else
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jre-headless
fi
java -version

echo "=== 6. PostgreSQL ==="
apt-get install -y -qq postgresql
systemctl enable --now postgresql
mkdir -p /etc/acttub
if [ -f /etc/acttub/api.env ]; then
  echo "  api.env가 이미 있어 DB 생성을 건너뜁니다"
else
  # 비밀값은 이 인스턴스 안에서만 만들어지고 파일 밖으로 나가지 않는다.
  # SSM 명령 파라미터에 담기지 않으므로 CloudTrail에도 남지 않는다.
  PW=$(openssl rand -hex 24)
  JWT=$(openssl rand -hex 32)
  sudo -u postgres psql -qc "CREATE USER acttub WITH PASSWORD '$PW';"
  sudo -u postgres psql -qc "CREATE DATABASE acttub OWNER acttub;"
  # umask는 서브셸 안에서만 바꾼다. 밖으로 새면 뒤따르는 apt 키링·디렉토리가
  # 0600으로 만들어져 apt가 저장소 서명을 검증하지 못한다.
  ( umask 077
    cat > /etc/acttub/api.env <<ENVEOF
DATABASE_URL=postgresql://acttub:$PW@localhost:5432/acttub
JWT_SECRET=$JWT
AWS_REGION=ap-northeast-2
DEVELOPMENT_AUTH_PROVIDER=1
ENVEOF
  )
  chmod 600 /etc/acttub/api.env
  unset PW JWT
  echo "  DB·유저 생성, api.env 뼈대 작성 완료"
  echo "  GEMINI_API_KEY·S3_BUCKET 등은 손으로 채우고 S3 자격증명은 instance role을 쓴다"
fi

echo "=== 7. 서비스 디렉토리 ==="
# 배포가 여기에 아티팩트를 푼다. 유닛의 WorkingDirectory와 맞아야 한다.
# 백엔드는 jar 한 개가 /svc/acttub/api-java/acting-api.jar 로 간다 — 디렉토리 이름은
# systemd 유닛(acttub-api-java)을 따르고, 소스 트리의 이름(apps/api)과는 무관하다.
mkdir -p /svc/acttub/web /svc/acttub/api-java
chown -R ubuntu:ubuntu /svc/acttub
chmod 755 /svc /svc/acttub /svc/acttub/web /svc/acttub/api-java

echo "=== 8. Caddy ==="
if command -v caddy >/dev/null; then echo "  이미 있음"; else
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  # apt는 _apt 계정으로 저장소를 읽는다. 키링이 0600이면 NO_PUBKEY로 실패한다.
  chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod 644 /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi
caddy version

# /v2/*·/health를 Caddy에서 나누지 않는다 — Next의 rewrites가 백엔드로 넘긴다.
# 운영도 같은 경로를 타므로 프록시 동작이 dev에서 그대로 검증된다.
cat > /etc/caddy/Caddyfile <<'CADDYEOF'
# Cloudflare 뒤라 내부 인증서로 충분하다.
dev.acttub.com {
	tls internal
	reverse_proxy 127.0.0.1:3000
}

# DNS 전환 전, 퍼블릭 IP로 직접 검증하기 위한 임시 블록. 전환 후 지운다.
:80 {
	reverse_proxy 127.0.0.1:3000
}
CADDYEOF
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo "=== 완료 ==="
systemctl is-active postgresql caddy
echo "api.env 키 목록(값 제외):"
grep -oE '^[A-Za-z0-9_]+=' /etc/acttub/api.env | tr -d '='
