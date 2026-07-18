import hashlib


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_token(token: str) -> str:
    return _hash_secret(token)
