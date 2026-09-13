#!/usr/bin/env bash
set -euo pipefail
cloud_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Downloads only pinned official tools into an ignored local cache. No Cloud or
# Slack credentials are required or used by this entrypoint.
python3 "$cloud_dir/tests/install_tools.py"
export TERRAFORM="${TERRAFORM:-$cloud_dir/.validation/tools/terraform}"
export PROMTOOL="${PROMTOOL:-$cloud_dir/.validation/tools/promtool}"
"$TERRAFORM" -chdir="$cloud_dir" init -backend=false -input=false -lockfile=readonly
"$TERRAFORM" -chdir="$cloud_dir" fmt -check -recursive
"$TERRAFORM" -chdir="$cloud_dir" validate -no-color
"$TERRAFORM" -chdir="$cloud_dir" test -no-color
python3 "$cloud_dir/tests/evaluate_rules.py"
python3 -m unittest discover -s "$cloud_dir/tests" -p 'test_*.py' -v
