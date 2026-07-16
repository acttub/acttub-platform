import argparse
import secrets
import sys
from collections.abc import Callable, Sequence
from uuid import UUID

from acting_api.config import load_gateway_settings
from acting_api.db.store import PostgresStore
from acting_api.security import hash_api_key


def generate_api_key() -> str:
    return f"act_{secrets.token_urlsafe(32)}"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DB-backed API key management")
    commands = parser.add_subparsers(dest="command", required=True)

    issue = commands.add_parser("issue", help="issue a new API key")
    issue.add_argument("--label", required=True)
    issue.add_argument("--rate-limit-per-min", type=int, default=10)

    revoke = commands.add_parser("revoke", help="revoke an API key by UUID")
    revoke.add_argument("key_id", type=UUID)

    commands.add_parser("list", help="list API key metadata")
    return parser


def _create_store() -> PostgresStore:
    settings = load_gateway_settings()
    return PostgresStore.from_url(settings.database_url)


def main(
    argv: Sequence[str] | None = None,
    *,
    store=None,
    token_factory: Callable[[], str] = generate_api_key,
) -> int:
    args = _parser().parse_args(argv)
    owns_store = store is None
    if store is None:
        store = _create_store()
    try:
        if args.command == "issue":
            if args.rate_limit_per_min <= 0:
                raise SystemExit("--rate-limit-per-min must be positive")
            api_key = token_factory()
            record = store.create_api_key(
                key_hash=hash_api_key(api_key),
                label=args.label,
                rate_limit_per_min=args.rate_limit_per_min,
            )
            print(f"id={record.id}")
            print(f"api_key={api_key}")
            print("Store this value now; it will not be shown again.")
            return 0

        if args.command == "revoke":
            if not store.revoke_api_key(args.key_id):
                print("API key not found or already revoked", file=sys.stderr)
                return 1
            print(f"revoked={args.key_id}")
            return 0

        print("id\tlabel\trate_limit_per_min\tis_active\tcreated_at\trevoked_at")
        for record in store.list_api_keys():
            print(
                f"{record.id}\t{record.label}\t{record.rate_limit_per_min}\t"
                f"{record.is_active}\t{record.created_at.isoformat()}\t"
                f"{record.revoked_at.isoformat() if record.revoked_at else ''}"
            )
        return 0
    finally:
        if owns_store:
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
