from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DOWNLOAD_CHUNK_BYTES = 1024 * 1024


class StorageConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredObjectMetadata:
    size_bytes: int
    content_type: str | None
    etag: str


class S3Storage:
    def __init__(self, *, bucket: str, client):
        if not bucket:
            raise StorageConfigurationError("S3 bucket must not be empty")
        self.bucket = bucket
        self._client = client

    @classmethod
    def from_credentials(
        cls,
        *,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        region: str,
    ) -> S3Storage:
        try:
            import boto3
        except ImportError as exc:
            raise StorageConfigurationError("boto3 is not installed") from exc
        client = boto3.client(
            "s3",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region,
        )
        return cls(bucket=bucket, client=client)

    def presign_upload(
        self,
        *,
        object_key: str,
        mime_type: str,
        size_bytes: int,
        expires_in_sec: int,
    ) -> str:
        return self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": object_key,
                "ContentType": mime_type,
                "ContentLength": size_bytes,
            },
            ExpiresIn=expires_in_sec,
            HttpMethod="PUT",
        )

    def presign_playback(self, *, object_key: str, expires_in_sec: int) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": object_key},
            ExpiresIn=expires_in_sec,
            HttpMethod="GET",
        )

    def head(self, *, object_key: str) -> StoredObjectMetadata | None:
        try:
            response = self._client.head_object(Bucket=self.bucket, Key=object_key)
        except Exception as exc:
            error = getattr(exc, "response", {}).get("Error", {})
            if error.get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise
        return StoredObjectMetadata(
            size_bytes=int(response["ContentLength"]),
            content_type=response.get("ContentType"),
            etag=str(response["ETag"]),
        )

    def download_to_path(
        self, *, object_key: str, destination: str | Path
    ) -> StoredObjectMetadata:
        response = self._client.get_object(Bucket=self.bucket, Key=object_key)
        body = response["Body"]
        destination_path = Path(destination)
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with destination_path.open("wb") as output:
                for chunk in body.iter_chunks(chunk_size=DOWNLOAD_CHUNK_BYTES):
                    if chunk:
                        output.write(chunk)
        finally:
            close = getattr(body, "close", None)
            if close is not None:
                close()
        return StoredObjectMetadata(
            size_bytes=int(
                response.get("ContentLength", destination_path.stat().st_size)
            ),
            content_type=response.get("ContentType"),
            etag=str(response["ETag"]),
        )

    def delete(self, *, object_key: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=object_key)
