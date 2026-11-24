#!/bin/sh
# 백업 컨테이너의 aws CLI 가 S3_ENDPOINT 의 S3 호환 저장소(Cloudflare R2)에서 backup.py 와 같은 호출을 할 수 있는지 본다.
# 백업 이미지 안에서 돈다. 읽는 환경 변수: BACKUP_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_ENDPOINT.
# 버킷 안에서는 _probe/<무작위>/ 아래에만 쓰고 끝에 지운다. 키·값·aws 출력은 찍지 않고 단계와 종료 코드만 찍는다.
#
#   docker run -i --rm --env-file <다섯 줄 파일> --entrypoint sh <백업 이미지> -s < deploy/home/backup/tests/s3_endpoint_probe.sh
set -u
: "${S3_ENDPOINT:?S3_ENDPOINT 가 없다}" "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET 이 없다}"
export AWS_EC2_METADATA_DISABLED=true AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=3 AWS_PAGER=""
work=$(mktemp -d)
prefix="_probe/$(cat /proc/sys/kernel/random/uuid)"
failed=0
opts="--endpoint-url $S3_ENDPOINT --cli-connect-timeout 10 --cli-read-timeout 60"
result() { if [ "$1" -eq 0 ]; then echo "PASS $2"; else echo "FAIL $2 (exit $1)"; failed=1; fi; }

# 20MB: aws CLI 는 8MB 부터 멀티파트로 올린다. 실제 덤프와 같은 길이다.
head -c 20000003 /dev/urandom > "$work/backup.dump"
sum=$(sha256sum "$work/backup.dump" | cut -d' ' -f1)
size=$(wc -c < "$work/backup.dump" | tr -d ' ')

# shellcheck disable=SC2086
aws s3 cp "$work/backup.dump" "s3://$BACKUP_S3_BUCKET/$prefix/backup.dump" --only-show-errors \
  --metadata "sha256=$sum" $opts >/dev/null 2>&1
result $? "01 aws s3 cp 올리기(멀티파트, sha256 메타데이터) — backup.py upload"

# shellcheck disable=SC2086
aws s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$prefix/backup.dump" --output json $opts > "$work/head.json" 2>/dev/null
code=$?
if [ "$code" -eq 0 ]; then
  python3 -c 'import json,sys; h=json.load(open(sys.argv[1])); sys.exit(0 if h["ContentLength"]==int(sys.argv[2]) and h["Metadata"]["sha256"]==sys.argv[3] else 1)' \
    "$work/head.json" "$size" "$sum" 2>/dev/null
  code=$?
fi
result $code "02 aws s3api head-object 크기·sha256 메타데이터 일치 — backup.py remote verification"

# shellcheck disable=SC2086
aws s3 cp "s3://$BACKUP_S3_BUCKET/$prefix/backup.dump" "$work/download.dump" --only-show-errors $opts >/dev/null 2>&1
code=$?
[ "$code" -ne 0 ] || [ "$(sha256sum "$work/download.dump" | cut -d' ' -f1)" = "$sum" ] || code=1
result $code "03 aws s3 cp 내려받기 sha256 일치 — 복원 때 받는 명령"

# backup.py 는 S3_ENDPOINT 가 있으면 --sse AES256 을 빼고 보낸다. 저장소가 이 요청을 받는지는 정보로만 남긴다.
printf 'probe' > "$work/small"
# shellcheck disable=SC2086
aws s3 cp "$work/small" "s3://$BACKUP_S3_BUCKET/$prefix/sse" --only-show-errors --sse AES256 $opts >/dev/null 2>&1
echo "INFO --sse AES256 올리기 종료 코드 $? (0 이면 받아 줌, 아니면 거절)"

# 목록 조회(ListObjects) 없이 이번에 쓴 키만 하나씩 지운다. 토큰에 객체 권한만 있어도 된다.
code=0
for key in backup.dump sse; do
  # shellcheck disable=SC2086
  aws s3api delete-object --bucket "$BACKUP_S3_BUCKET" --key "$prefix/$key" $opts >/dev/null 2>&1 || code=1
  # shellcheck disable=SC2086
  aws s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$prefix/$key" $opts >/dev/null 2>&1 && code=1
done
result $code "04 정리: _probe/ 아래 이번 객체 지움"
rm -rf "$work"
exit $failed
