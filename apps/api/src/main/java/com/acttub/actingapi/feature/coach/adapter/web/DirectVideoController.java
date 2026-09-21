package com.acttub.actingapi.feature.coach.adapter.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.DirectVideoSessions;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Temporary dev-only API, deliberately excluded from the supported public API schema. */
@Hidden
@RestController
@RequestMapping("/v2/coach/direct-video")
@ConditionalOnExpression("'${SITE_URL:}' == 'https://dev.acttub.com' && '${ACTTUB_DIRECT_VIDEO_ENABLED:true}' == 'true'")
class DirectVideoController {
    private final DirectVideoSessions sessions;
    private final AccessGate auth;
    DirectVideoController(DirectVideoSessions sessions, AccessGate auth) {
        this.sessions = sessions;
        this.auth = auth;
    }

    @PostMapping(consumes = "multipart/form-data")
    @ResponseStatus(HttpStatus.ACCEPTED)
    DirectVideoSessions.View start(@RequestPart("video") MultipartFile video, HttpServletRequest request) throws IOException {
        UUID owner = auth.gatedUser(request).id();
        String mime = video.getContentType();
        if (mime == null || !Set.of("video/mp4", "video/quicktime", "video/webm", "video/mpeg").contains(mime)) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (video.isEmpty()) throw new ApiException(422, "empty_video");
        if (video.getSize() > 50L * 1024 * 1024) throw new ApiException(413, "upload_too_large");
        Path path = Files.createTempFile("acttub-direct-video-", ".upload");
        boolean accepted = false;
        try {
            video.transferTo(path);
            var view = sessions.start(owner, path, mime);
            accepted = true;
            return view;
        } finally {
            if (!accepted) Files.deleteIfExists(path);
        }
    }

    @GetMapping("/{id}")
    DirectVideoSessions.View get(@PathVariable UUID id, HttpServletRequest request) {
        return sessions.get(auth.gatedUser(request).id(), id);
    }

    record Send(@NotBlank @Size(max = 2000) String text) {}

    @PostMapping("/{id}/messages")
    @ResponseStatus(HttpStatus.ACCEPTED)
    DirectVideoSessions.View send(@PathVariable UUID id, @Valid @RequestBody Send body, HttpServletRequest request) {
        return sessions.send(auth.gatedUser(request).id(), id, body.text());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable UUID id, HttpServletRequest request) {
        sessions.delete(auth.gatedUser(request).id(), id);
    }
}
