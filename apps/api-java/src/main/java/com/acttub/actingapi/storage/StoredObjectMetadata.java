package com.acttub.actingapi.storage;

public record StoredObjectMetadata(long sizeBytes, String contentType, String etag) {
}
