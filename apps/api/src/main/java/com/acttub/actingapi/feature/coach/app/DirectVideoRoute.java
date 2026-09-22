package com.acttub.actingapi.feature.coach.app;

enum DirectVideoRoute {
    OPENING("opening"), INTENTION("intention"), CORRECTION("correction"),
    UNSURE("unsure"), METHOD("method"), ACKNOWLEDGEMENT("acknowledgement"),
    CLOSING("closing"), GENERAL("general");

    final String id;
    DirectVideoRoute(String id) { this.id = id; }
}
