#!/usr/bin/env bash
# Requires prebuilt, current API/web images; never builds apps or calls a real Cloud.
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/smoke.py"
