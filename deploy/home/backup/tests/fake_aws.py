#!/usr/bin/env python3
"""테스트 전용 AWS CLI 경계: 임시 디렉터리에 객체와 메타데이터를 보관한다."""
import json
import os
from pathlib import Path
import shutil
import sys

args = sys.argv[1:]
root = Path(os.environ["FAKE_S3_DIR"])
mode = os.environ.get("FAKE_AWS_MODE", "")
root.mkdir(parents=True, exist_ok=True)
with (root / "calls.jsonl").open("a") as calls:
    calls.write(json.dumps(args) + "\n")

if args[:2] == ["s3", "cp"]:
    source, target = args[2:4]
    if source.startswith("s3://"):
        shutil.copyfile(root / source[5:], target)
    else:
        if mode == "fail-upload":
            print("simulated secret MUST_NOT_LEAK", file=sys.stderr)
            sys.exit(9)
        dest = root / target[5:]
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
        metadata = dict(item.split("=", 1) for item in args[args.index("--metadata") + 1].split(","))
        dest.with_suffix(".metadata.json").write_text(json.dumps(metadata))
elif args[:2] == ["s3api", "head-object"]:
    if mode == "fail-head":
        sys.exit(8)
    dest = root / args[args.index("--bucket") + 1] / args[args.index("--key") + 1]
    metadata = json.loads(dest.with_suffix(".metadata.json").read_text())
    if mode == "corrupt-checksum":
        metadata["sha256"] = "wrong"
    print(json.dumps({"ContentLength": dest.stat().st_size + (1 if mode == "corrupt-length" else 0), "Metadata": metadata}))
else:
    sys.exit(2)
