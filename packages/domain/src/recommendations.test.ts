import { describe, expect, it } from "vitest";
import { acceptRecommendations, rankVenues } from "./recommendations";

const venue = "11111111-1111-4111-8111-111111111111";

describe("recommendations", () => {
  it("rejects invented venues and opening-hour claims", () => {
    expect(() => acceptRecommendations({
      ideas: [{
        venueId: "22222222-2222-4222-8222-222222222222",
        title: "mystery",
        emoji: "🍝",
        category: "food",
        reason: "a nice table",
      }],
    }, new Set([venue]))).toThrow(/unknown venue/);

    expect(() => acceptRecommendations({
      ideas: [{ venueId: venue, title: "dinner", emoji: "🍝", category: "food", reason: "open until 23:00" }],
    }, new Set([venue]))).toThrow(/opening-hours/);
  });

  it("ranks interest matches ahead of other venues", () => {
    const ranked = rankVenues([
      { id: "a", name: "Park", categoryHint: "outdoors", latitude: 0, longitude: 0 },
      { id: "b", name: "Cafe", categoryHint: "coffee", latitude: 0, longitude: 0 },
    ], ["coffee"]);
    expect(ranked[0]?.id).toBe("b");
  });
});
