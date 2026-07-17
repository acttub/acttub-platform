from acting_api.storage import DOWNLOAD_CHUNK_BYTES, S3Storage
from platform_test_support import FakeBotoS3Client


def test_presigned_put_and_playback_urls_use_expected_methods_and_ttls():
    client = FakeBotoS3Client()
    storage = S3Storage(bucket="videos", client=client)

    upload_url = storage.presign_upload(
        object_key="users/u/uploads/v.mp4",
        mime_type="video/mp4",
        size_bytes=123,
        expires_in_sec=1800,
    )
    playback_url = storage.presign_playback(
        object_key="users/u/uploads/v.mp4", expires_in_sec=900
    )

    assert "/put_object/" in upload_url
    assert "/get_object/" in playback_url
    put_method, put_call = client.presign_calls[0]
    assert put_method == "put_object"
    assert put_call["Params"] == {
        "Bucket": "videos",
        "Key": "users/u/uploads/v.mp4",
        "ContentType": "video/mp4",
        "ContentLength": 123,
    }
    assert put_call["ExpiresIn"] == 1800
    assert put_call["HttpMethod"] == "PUT"


def test_head_returns_metadata_or_none():
    client = FakeBotoS3Client()
    storage = S3Storage(bucket="videos", client=client)
    assert storage.head(object_key="missing.mp4") is None

    etag = client.put(
        bucket="videos",
        key="present.mp4",
        content=b"1234",
        mime_type="video/mp4",
    )
    metadata = storage.head(object_key="present.mp4")
    assert metadata.size_bytes == 4
    assert metadata.content_type == "video/mp4"
    assert metadata.etag == etag


def test_download_streams_chunks_to_disk_without_whole_object_read(tmp_path):
    content = b"x" * (DOWNLOAD_CHUNK_BYTES * 2 + 17)
    client = FakeBotoS3Client()
    etag = client.put(bucket="videos", key="large.mp4", content=content)
    storage = S3Storage(bucket="videos", client=client)
    destination = tmp_path / "nested" / "large.mp4"

    metadata = storage.download_to_path(
        object_key="large.mp4", destination=destination
    )

    assert destination.read_bytes() == content
    assert client.last_body.chunk_sizes == [
        DOWNLOAD_CHUNK_BYTES,
        DOWNLOAD_CHUNK_BYTES,
        17,
    ]
    assert client.last_body.closed is True
    assert metadata.etag == etag
    assert metadata.size_bytes == len(content)


def test_delete_removes_the_exact_object():
    client = FakeBotoS3Client()
    client.put(bucket="videos", key="orphan.mp4", content=b"orphan")
    storage = S3Storage(bucket="videos", client=client)

    storage.delete(object_key="orphan.mp4")

    assert client.delete_calls == [("videos", "orphan.mp4")]
    assert storage.head(object_key="orphan.mp4") is None
