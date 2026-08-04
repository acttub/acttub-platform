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

echo "=== 1. swap 4GB ==="
# t2.micro(1GB)에서 Next·uvicorn·PostgreSQL 셋을 띄우려면 필수다. 배포마다 도는
# uv sync가 특히 피크를 만든다.
if swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  echo "  이미 있음"
else
  fallocate -l 4G /swapfile
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

echo "=== 5. uv ==="
# 홈이 아니라 /usr/local/bin에 둔다. SSM 접속 계정(ssm-user)과 서비스 실행 계정
# (ubuntu)이 다르기 때문에, 홈에 두면 서비스가 uv를 찾지 못한다.
if [ -x /usr/local/bin/uv ]; then echo "  이미 있음"; else
  curl -LsSf https://astral.sh/uv/install.sh \
    | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh >/dev/null
fi
/usr/local/bin/uv --version
# 파이썬은 uv로 받지 않고 시스템 것을 쓴다 — uv가 받는 파이썬도 실행 계정의 홈에
# 깔려 같은 문제가 반복된다. requires-python >= 3.11 이면 그대로 쓴다.
python3 --version

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
  echo "  DB·유저 생성, api.env 뼈대 작성 완료 (나머지 키는 손으로 채운다)"
fi

echo "=== 7. 서비스 디렉토리 ==="
# 배포가 여기에 아티팩트를 푼다. 유닛의 WorkingDirectory와 맞아야 한다.
mkdir -p /svc/acttub/web /svc/acttub/acttub-platform/apps/api
chown -R ubuntu:ubuntu /svc/acttub
chmod 755 /svc /svc/acttub /svc/acttub/web /svc/acttub/acttub-platform \
          /svc/acttub/acttub-platform/apps /svc/acttub/acttub-platform/apps/api

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
