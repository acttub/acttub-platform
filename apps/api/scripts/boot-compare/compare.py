"""snapshot.sh 로 떠 둔 두 폴더를 견준다. 다른 곳을 모두 찍고, 하나라도 다르면 1 로 끝난다.

    python3 -I compare.py <전 폴더> <후 폴더>

매번 달라지는 값(UUID, JWT·가입 토큰, 시각, 소요 시간, JVM 지표 값)은 같은 자리표로 바꾼 뒤 견준다.
"""
import difflib
import json
import re
import sys
from pathlib import Path

before, after = Path(sys.argv[1]), Path(sys.argv[2])

MASKS = [
    (re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)?"), "<token>"),
    (re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"), "<uuid>"),
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:\d{2})?)?"), "<time>"),
]


def mask(text):
    for pattern, placeholder in MASKS:
        text = pattern.sub(placeholder, text)
    return text


def lines_of(path):
    if not path.exists():
        return ["(파일 없음)"]
    text = path.read_text(errors="replace")
    if path.name == "api-docs.txt":
        head, _, body = text.partition("\n\n")
        try:
            body = json.dumps(json.loads(body), indent=1, sort_keys=True, ensure_ascii=False)
        except ValueError:
            pass
        text = head + "\n\n" + body
    lines = mask(text).splitlines()
    if path.suffix == ".sql":
        # pg_dump 18 은 \restrict 줄에 매번 다른 열쇠를 적는다.
        lines = [line for line in lines if not line.startswith(("\\restrict", "\\unrestrict"))]
    if path.name == "db-data.sql":
        # 행 순서는 UUID 를 지운 뒤에 다시 정렬한다. 리프레시 토큰은 매번 새로 뽑아 해시가 다르다.
        lines = sorted(re.sub(r"'[0-9a-f]{64}'", "'<hash>'", line) if "public.refresh_tokens" in line else line
                       for line in lines)
    return lines


targets = ["log-keys.txt", "startup-warn.txt", "request-log.txt", "metrics.txt", "metrics-http.txt",
           "db-schema.sql", "db-data.sql"]
targets += sorted({p.relative_to(before).as_posix() for p in (before / "responses").glob("*.txt")}
                  | {p.relative_to(after).as_posix() for p in (after / "responses").glob("*.txt")})

def same_json(a, b):
    """본문이 같은 JSON 인데 키 순서만 다른가. 순서는 지우지 않고 표시만 한다(직렬화기가 바꾸는 순서도 볼거리다)."""
    try:
        return json.loads("\n".join(a).partition("\n\n")[2]) == json.loads("\n".join(b).partition("\n\n")[2])
    except ValueError:
        return False


different = 0
for name in targets:
    a, b = lines_of(before / name), lines_of(after / name)
    if a == b:
        continue
    different += 1
    note = " (키 순서만 다름)" if name.startswith("responses/") and a[:1] == b[:1] and same_json(a, b) else ""
    print(f"### {name}{note}")
    sys.stdout.writelines(line + "\n" for line in difflib.unified_diff(a, b, "전", "후", n=1, lineterm=""))
    print()

print(f"견준 파일 {len(targets)}개 중 다른 파일 {different}개")
sys.exit(1 if different else 0)
