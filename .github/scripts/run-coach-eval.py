"""Run opt-in synthetic evaluations with the deployed dev model configuration.

Only two configuration fields cross the existing trusted deployment SSH channel.
Credentials stay in process memory and are never printed or written to artifacts.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

REMOTE_CONFIG = r'''
import json, subprocess
command = ["docker", "compose", "--env-file", ".env", "--env-file", "release.env",
           "-f", "compose.yml", "exec", "-T", "api", "printenv"]
result = subprocess.run(command, cwd="/svc/acttub/dev", capture_output=True, text=True)
if result.returncode:
    raise SystemExit("dev model configuration unavailable")
allowed = {"OPENAI_API_KEY", "OPENAI_CHAT_MODEL"}
values = dict(line.split("=", 1) for line in result.stdout.splitlines()
              if "=" in line and line.split("=", 1)[0] in allowed)
print(json.dumps(values))
'''

def main():
    suite = sys.argv[1] if len(sys.argv) > 1 else "coach"
    if suite not in {"coach", "note", "continuity"}:
        raise SystemExit("Unknown synthetic evaluation suite")
    classes = ("DialogueContinuityEvalTest",) if suite == "continuity" else ("NoteContinuityEvalTest",) if suite == "note" else (
        "ResponseSelectionEvalTest", "SceneContextConversationEvalTest", "StructuredCoachConversationEvalTest")
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
         "-o", "ConnectTimeout=20", "deploy@insung-server", "python3", "-"],
        input=REMOTE_CONFIG, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise SystemExit("Could not access dev model configuration over deployment SSH")
    values = json.loads(result.stdout)
    if not values.get("OPENAI_API_KEY", "").strip():
        raise SystemExit("Dev OpenAI credential is missing; evaluation cannot be skipped")
    environment = os.environ.copy()
    environment.update(values)
    environment["ACTTUB_COACH_EVAL"] = "1"
    # Independent synthetic sessions can run together; turns within a session stay sequential.
    environment["JAVA_TOOL_OPTIONS"] = environment.get("JAVA_TOOL_OPTIONS", "") + (
        " -Djunit.jupiter.execution.parallel.enabled=true"
        " -Djunit.jupiter.execution.parallel.mode.default=concurrent"
        " -Djunit.jupiter.execution.parallel.config.strategy=fixed"
        " -Djunit.jupiter.execution.parallel.config.fixed.parallelism=3"
        " -Djunit.jupiter.execution.parallel.config.fixed.max-pool-size=3")
    root = Path(__file__).resolve().parents[2]
    tests = [arg for name in classes for arg in ("--tests", "*" + name)]
    completed = subprocess.run(
        ["./gradlew", "test", "--no-daemon", "--rerun-tasks", *tests],
        cwd=root / "apps/api", env=environment)
    if completed.returncode:
        return completed.returncode
    reports = root / "apps/api/build/test-results/test"
    total = 0
    for name in classes:
        matches = list(reports.glob("TEST-*." + name + ".xml"))
        if len(matches) != 1:
            raise SystemExit("Expected live evaluation report is missing: " + name)
        report = ET.parse(matches[0]).getroot()
        if any(int(report.get(field, "0")) for field in ("skipped", "failures", "errors")):
            raise SystemExit("Live evaluation must complete without skipped or failed cases: " + name)
        total += int(report.get("tests", "0"))
    if total < (4 if suite == "continuity" else 8 if suite == "note" else 16):
        raise SystemExit("Live evaluation did not run every required scenario")
    print("Completed synthetic model evaluations:", total)
    return 0

if __name__ == "__main__":
    sys.exit(main())
