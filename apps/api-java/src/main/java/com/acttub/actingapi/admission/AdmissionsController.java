package com.acttub.actingapi.admission;

import com.acttub.actingapi.admission.AdmissionDtos.AdmissionsResponse;
import com.acttub.actingapi.web.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import org.springframework.boot.autoconfigure.condition.ConditionalOnResource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/admissions")
@ConditionalOnResource(resources = "classpath:admissions/notices.json")
class AdmissionsController {
    private final AdmissionsCatalog catalog;

    AdmissionsController(AdmissionsCatalog catalog) {
        this.catalog = catalog;
    }

    @Operation(
            summary = "List Admissions",
            operationId = "list_admissions_v2_admissions_get",
            tags = "v2-admissions")
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdmissionsResponse.class)))
    @GetMapping
    AdmissionsResponse list() {
        return catalog.all();
    }

    @Operation(
            summary = "Get University",
            operationId = "get_university_v2_admissions__university_id__get",
            tags = "v2-admissions")
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = AdmissionsResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/{university_id}")
    AdmissionsResponse university(@PathVariable("university_id") String universityId) {
        AdmissionsResponse response = catalog.university(universityId);
        if (response == null) {
            throw new ApiException(404, "university_not_found");
        }
        return response;
    }
}
