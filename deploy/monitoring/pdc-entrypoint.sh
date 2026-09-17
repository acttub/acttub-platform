#!/bin/sh
set -eu
# Read at runtime: neither Compose config nor container argv contain the token.
GCLOUD_PDC_SIGNING_TOKEN="$(cat /etc/acttub/pdc-token)"
export GCLOUD_PDC_SIGNING_TOKEN
exec /usr/bin/pdc "$@"
