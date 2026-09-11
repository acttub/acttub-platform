#!/usr/bin/env python3
"""로그인 없는 유료 코칭 평가. 키를 읽어 출력하거나 .env를 자동으로 로드하지 않는다."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

API = Path(__file__).resolve().parents[1]
SCENARIOS = API / "src/test/resources/coach/quality-scenarios.json"


def selected_cases(selection):
    cases = json.loads(SCENARIOS.read_text(encoding="utf-8"))
    known = {item["id"] for item in cases}
    selected = ([part.strip() for part in selection.split(",")] if selection
                else [item["id"] for item in cases if item.get("branch") == "그 외"])
    if not selected or set(selected) - known or len(selected) != len(set(selected)):
        raise ValueError("평가 사례 ID가 잘못됐거나 중복됐다. quality-scenarios.json을 확인한다.")
    return [item for item in cases if item["id"] in selected]


def preflight(mode, video, environment):
    missing = []
    keys = ["OPENAI_API_KEY"] + (["GEMINI_API_KEY"] if mode == "video" else [])
    for key in keys:
        if not environment.get(key, "").strip():
            missing.append(key + " 환경변수")
    java_home = environment.get("JAVA_HOME")
    javac = str(Path(java_home) / "bin/javac") if java_home else shutil.which("javac")
    try:
        if not javac:
            raise OSError("javac missing")
        result = subprocess.run([javac, "-version"], capture_output=True, text=True, timeout=10)
        version = re.search(r"javac (\d+)", result.stdout + result.stderr)
        # 저장소의 Gradle toolchain과 같은 버전이어야 한다.
        if result.returncode or not version or int(version.group(1)) != 21:
            raise OSError("JDK 21 missing")
    except (OSError, subprocess.TimeoutExpired):
        missing.append("JDK 21 (JAVA_HOME 또는 PATH)")
    if mode == "video":
        for command in ("ffmpeg", "ffprobe"):
            if not shutil.which(command):
                missing.append(command)
        if not video or not video.is_file() or not os.access(video, os.R_OK):
            missing.append("읽을 수 있는 평가용 연기 영상")
        elif video.suffix.lower() not in {".mp4", ".mov", ".webm"}:
            missing.append("mp4, mov, webm 영상")
        elif not 0 < video.stat().st_size <= 100_000_000:
            missing.append("100MB 이하의 비어 있지 않은 영상")
    return missing


def verify_results(directory, expected):
    """Gradle의 skipped/up-to-date/0개 성공을 모델 평가 통과로 바꾸지 않는다."""
    issues = []
    for case_id, count in expected.items():
        path = directory / (case_id + ".json")
        if not path.is_file():
            issues.append(case_id + ": 실호출 결과 없음")
            continue
        try:
            result = json.loads(path.read_text(encoding="utf-8"))
            if result.get("id") != case_id or result.get("contract_checks") != "passed":
                issues.append(case_id + ": 계약 검사 실패")
            if len(result.get("steps", [])) != count or not result.get("calls"):
                issues.append(case_id + ": 예정된 대화/모델 호출이 끝나지 않음")
            if result.get("semantic_review") != "pending":
                issues.append(case_id + ": 자동 검사가 의미 품질 판정을 대신함")
        except (ValueError, OSError, AttributeError):
            issues.append(case_id + ": 결과를 읽을 수 없음")
    return issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("synthetic", "video"))
    parser.add_argument("video", nargs="?", type=Path)
    parser.add_argument("--check", action="store_true", help="준비 상태만 검사하고 모델은 호출하지 않음")
    parser.add_argument("--cases", default=os.environ.get("ACTTUB_COACH_EVAL_CASES", ""))
    args = parser.parse_args()
    if args.mode == "synthetic" and args.video:
        parser.error("영상 파일은 video 모드에서만 지정한다.")
    if args.mode == "video" and args.cases:
        parser.error("video 모드는 영상 1건과 고정된 4개 응답을 평가한다. --cases/ACTTUB_COACH_EVAL_CASES를 비운다.")
    try:
        cases = selected_cases(args.cases) if args.mode == "synthetic" else []
    except ValueError as error:
        parser.error(str(error))
    expected = ({item["id"]: 1 + len(item.get("followups", [])) for item in cases}
                if cases else {"real_video": 4})
    video = args.video.expanduser().resolve() if args.video else None
    environment = dict(os.environ)
    missing = preflight(args.mode, video, environment)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    directory = API / "build/coach-quality-eval" / run_id
    directory.mkdir(parents=True)
    manifest = {"mode": args.mode, "expected_responses": expected,
                "execution_status": "blocked" if missing else "ready", "blockers": missing,
                "semantic_review": "pending", "check_only": args.check}
    manifest_path = directory / "run.json"

    def save():
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    save()
    print("결과: " + str(directory), flush=True)
    if missing:
        print("실호출 미실행: " + ", ".join(missing), file=sys.stderr)
        return 2
    if args.check:
        print("실행 준비 완료. --check를 빼면 유료 모델을 호출한다.")
        return 0
    # 이전 실험 opt-in과 Gradle 캐시가 이번 선택을 바꾸지 못하게 한다.
    environment.pop("ACTTUB_COACH_EVAL", None)
    environment.pop("ACTTUB_COACH_VIDEO_EVAL", None)
    environment.pop("M4_ENVELOPE_SPIKE", None)
    environment["ACTTUB_COACH_EVAL_OUTPUT_DIR"] = str(directory)
    if shutil.which("git"):
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=API, capture_output=True, text=True)
        if commit.returncode == 0:
            environment["ACTTUB_COACH_EVAL_COMMIT"] = commit.stdout.strip()
            manifest["commit"] = commit.stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=API, capture_output=True, text=True)
        manifest["working_tree_dirty"] = bool(dirty.stdout.strip()) if dirty.returncode == 0 else None
    if args.mode == "synthetic":
        environment["ACTTUB_COACH_EVAL"] = "1"
        environment["ACTTUB_COACH_EVAL_CASES"] = ",".join(expected)
        test_class = "com.acttub.actingapi.feature.coach.app.CoachQualityEvalTest"
    else:
        environment["ACTTUB_COACH_VIDEO_EVAL"] = "1"
        environment["ACTTUB_COACH_EVAL_VIDEO"] = str(video)
        test_class = "com.acttub.actingapi.integration.observation.VideoCoachQualityEvalTest"
    manifest["execution_status"] = "running"
    save()
    print(f"{len(expected)}개 사례, 코치 응답 {sum(expected.values())}회 예정. 재생성·전송 재시도는 추가 호출이다.", flush=True)
    # 이 평가에는 제공한 영상만 필요하다. 기존 SDK 스파이크의 Docker 합성 영상 생성을 제외한다.
    command = [str(API / "gradlew"), "test", "--tests", test_class, "-x", "prepareSpikeVideo",
               "--rerun-tasks", "--no-build-cache", "--no-daemon"]
    try:
        completed = subprocess.run(command, cwd=API, env=environment)
        issues = verify_results(directory, expected)
        manifest["gradle_exit_code"] = completed.returncode
        manifest["result_issues"] = issues
        manifest["execution_status"] = "completed" if completed.returncode == 0 and not issues else "failed"
    except (OSError, KeyboardInterrupt) as error:
        manifest["execution_status"] = "failed"
        manifest["failure_type"] = type(error).__name__
    finally:
        save()
    if manifest["execution_status"] != "completed":
        print("실호출 평가 실패 또는 미완료. run.json과 개별 결과를 확인한다.", file=sys.stderr)
        return 1
    print("실호출·계약 검사 완료. 의미 품질은 아직 미판정이며 원본/사례와 실제 답변을 대조해야 한다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
