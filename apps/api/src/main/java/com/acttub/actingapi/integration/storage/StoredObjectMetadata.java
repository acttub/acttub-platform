package com.acttub.actingapi.integration.storage;

public record StoredObjectMetadata(long sizeBytes, String contentType, String etag) {
}
