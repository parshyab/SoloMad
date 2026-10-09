import { z } from "zod";

export const recommendationSchema = z.object({
  ideas: z.array(z.object({
    venueId: z.string().uuid(),
    title: z.string().min(1).max(80),
    emoji: z.string().min(1).max(8),
    category: z.enum(["food", "coffee", "outdoors", "culture", "nightlife", "entertainment", "rideshare"]),
    reason: z.string().min(1).max(240),
  })).max(5),
});

export type RecommendationIdea = z.infer<typeof recommendationSchema>["ideas"][number];

export type VenueCandidate = {
  id: string;
  name: string;
  categoryHint: string;
  latitude: number;
  longitude: number;
};

export function rankVenues(venues: VenueCandidate[], interests: string[]): VenueCandidate[] {
  const interestText = interests.join(" ").toLowerCase();
  return [...venues].sort((left, right) => score(right, interestText) - score(left, interestText)).slice(0, 5);
}

function score(venue: VenueCandidate, interests: string): number {
  let value = 1;
  if (interests.includes(venue.categoryHint)) value += 5;
  if (interests.includes("food") && venue.categoryHint === "food") value += 2;
  return value;
}

export function acceptRecommendations(raw: unknown, allowedVenueIds: Set<string>): RecommendationIdea[] {
  const parsed = recommendationSchema.parse(raw);
  for (const idea of parsed.ideas) {
    if (!allowedVenueIds.has(idea.venueId)) {
      throw new Error("recommendation referenced an unknown venue");
    }
    if (/open until|closes at|opening hours/i.test(idea.reason)) {
      throw new Error("recommendation made an unsupported opening-hours claim");
    }
  }
  return parsed.ideas;
}
