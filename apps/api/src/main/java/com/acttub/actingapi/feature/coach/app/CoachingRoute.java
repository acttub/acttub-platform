package com.acttub.actingapi.feature.coach.app;

/** The only four coaching routes. The generator cannot select or change this value. */
enum CoachingRoute {
    UNDERSTAND_SCENE("understand_scene", "explain"),
    ASSESS_PERFORMANCE("assess_performance", "assess"),
    DESIGN_PERFORMANCE("design_performance", "suggest"),
    ADJUST_PERFORMANCE("adjust_performance", "suggest");

    final String id;
    final String move;
    CoachingRoute(String id, String move) { this.id = id; this.move = move; }

    static CoachingRoute parse(String id) {
        for (var route : values()) if (route.id.equals(id)) return route;
        throw new IllegalArgumentException("unknown coaching route");
    }
}
