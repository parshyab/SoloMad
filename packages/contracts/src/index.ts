export type HttpMethod = "get" | "post" | "patch" | "delete";

export type RouteSpec = {
  method: HttpMethod;
  path: string;
  auth: "public" | "user" | "admin" | "webhook";
  summary: string;
};

export const routes: RouteSpec[] = [
  { method: "get", path: "/health", auth: "public", summary: "Liveness" },
  { method: "get", path: "/ready", auth: "public", summary: "Readiness" },
  { method: "get", path: "/v1/openapi.json", auth: "public", summary: "OpenAPI document" },
  { method: "post", path: "/v1/auth/session", auth: "public", summary: "Exchange a verified provider token for the current account" },
  { method: "get", path: "/v1/public/stats", auth: "public", summary: "Aggregate active traveler count" },
  { method: "get", path: "/v1/public/activities/{id}", auth: "public", summary: "Public activity share metadata" },
  { method: "get", path: "/v1/me", auth: "user", summary: "Current account and onboarding" },
  { method: "patch", path: "/v1/me/onboarding", auth: "user", summary: "Save an onboarding step" },
  { method: "patch", path: "/v1/me/profile", auth: "user", summary: "Update profile fields" },
  { method: "post", path: "/v1/me/identities/link", auth: "user", summary: "Link a verified provider identity" },
  { method: "get", path: "/v1/me/activities", auth: "user", summary: "Hosted and joined activities" },
  { method: "get", path: "/v1/me/saves", auth: "user", summary: "Saved activities" },
  { method: "get", path: "/v1/me/viewers", auth: "user", summary: "Plus profile viewers" },
  { method: "post", path: "/v1/me/export", auth: "user", summary: "Queue a data export" },
  { method: "post", path: "/v1/me/deletion", auth: "user", summary: "Queue account deletion" },
  { method: "get", path: "/v1/profiles/{id}", auth: "user", summary: "Permitted public profile" },
  { method: "get", path: "/v1/discovery", auth: "user", summary: "Map and list discovery" },
  { method: "get", path: "/v1/search", auth: "user", summary: "Search cities, activities, and venues" },
  { method: "get", path: "/v1/cities", auth: "user", summary: "Canonical cities" },
  { method: "post", path: "/v1/activities", auth: "user", summary: "Publish an activity" },
  { method: "get", path: "/v1/activities/{id}", auth: "user", summary: "Activity detail" },
  { method: "patch", path: "/v1/activities/{id}", auth: "user", summary: "Host edit" },
  { method: "post", path: "/v1/activities/{id}/join", auth: "user", summary: "Join an activity" },
  { method: "post", path: "/v1/activities/{id}/leave", auth: "user", summary: "Leave an activity" },
  { method: "post", path: "/v1/activities/{id}/cancel", auth: "user", summary: "Host cancellation" },
  { method: "post", path: "/v1/activities/{id}/complete", auth: "user", summary: "Host completion" },
  { method: "post", path: "/v1/activities/{id}/attendance", auth: "user", summary: "Confirm attendance" },
  { method: "post", path: "/v1/activities/{id}/feedback", auth: "user", summary: "Private feedback" },
  { method: "post", path: "/v1/activities/{id}/save", auth: "user", summary: "Save an activity" },
  { method: "delete", path: "/v1/activities/{id}/save", auth: "user", summary: "Unsave an activity" },
  { method: "post", path: "/v1/drafts", auth: "user", summary: "Save an activity draft" },
  { method: "get", path: "/v1/trips", auth: "user", summary: "Upcoming and past trips" },
  { method: "post", path: "/v1/trips", auth: "user", summary: "Create a trip" },
  { method: "get", path: "/v1/trips/{id}", auth: "user", summary: "Trip detail" },
  { method: "patch", path: "/v1/trips/{id}", auth: "user", summary: "Edit trip dates" },
  { method: "delete", path: "/v1/trips/{id}", auth: "user", summary: "Delete a trip" },
  { method: "get", path: "/v1/trips/{id}/overlaps", auth: "user", summary: "Travelers with shared dates" },
  { method: "get", path: "/v1/conversations", auth: "user", summary: "Inbox" },
  { method: "get", path: "/v1/conversations/{id}/messages", auth: "user", summary: "Paginated history and catch-up" },
  { method: "post", path: "/v1/conversations/{id}/messages", auth: "user", summary: "Send a durable message" },
  { method: "post", path: "/v1/conversations/{id}/read", auth: "user", summary: "Advance read cursor" },
  { method: "post", path: "/v1/polls", auth: "user", summary: "Create a poll" },
  { method: "post", path: "/v1/polls/{id}/votes", auth: "user", summary: "Vote or change a vote" },
  { method: "post", path: "/v1/polls/{id}/close", auth: "user", summary: "Close a poll" },
  { method: "post", path: "/v1/location-shares", auth: "user", summary: "Start time-limited location sharing" },
  { method: "post", path: "/v1/location-shares/{id}", auth: "user", summary: "Update a live location" },
  { method: "post", path: "/v1/location-shares/{id}/stop", auth: "user", summary: "Stop sharing" },
  { method: "get", path: "/v1/conversations/{id}/location-shares", auth: "user", summary: "Active location shares" },
  { method: "post", path: "/v1/uploads", auth: "user", summary: "Start an upload" },
  { method: "post", path: "/v1/uploads/{id}/finalize", auth: "user", summary: "Finalize an upload" },
  { method: "post", path: "/v1/verification", auth: "user", summary: "Submit verification" },
  { method: "get", path: "/v1/recommendations", auth: "user", summary: "Venue ideas" },
  { method: "get", path: "/v1/notifications", auth: "user", summary: "In-app notifications" },
  { method: "post", path: "/v1/devices", auth: "user", summary: "Register an APNs device token" },
  { method: "get", path: "/v1/entitlements", auth: "user", summary: "Authoritative entitlements" },
  { method: "post", path: "/v1/reports", auth: "user", summary: "Report content" },
  { method: "post", path: "/v1/blocks", auth: "user", summary: "Block an account" },
  { method: "get", path: "/v1/blocks", auth: "user", summary: "Blocked accounts" },
  { method: "post", path: "/v1/support/tickets", auth: "user", summary: "Open a support ticket" },
  { method: "post", path: "/v1/webhooks/revenuecat", auth: "webhook", summary: "RevenueCat webhook" },
  { method: "post", path: "/v1/admin/session", auth: "public", summary: "Admin session" },
  { method: "get", path: "/v1/admin/health", auth: "admin", summary: "Operational overview" },
  { method: "get", path: "/v1/admin/users", auth: "admin", summary: "Search users" },
  { method: "post", path: "/v1/admin/reports/{id}", auth: "admin", summary: "Moderate a report" },
  { method: "post", path: "/v1/admin/verification/{id}", auth: "admin", summary: "Review verification" },
  { method: "get", path: "/v1/admin/audit", auth: "admin", summary: "Audit history" },
];

export const realtimeEvents = [
  "message.created",
  "activity.joined",
  "activity.left",
  "activity.updated",
  "activity.cancelled",
  "typing",
  "presence",
  "location.updated",
] as const;

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const methods = paths[route.path] ?? {};
    methods[route.method] = {
      operationId: `${route.method}_${route.path.replace(/[/{}/]/g, "_")}`,
      summary: route.summary,
      security: route.auth === "public" ? [] : [{ bearer: [] }],
      responses: {
        "200": { description: "Success" },
        "401": { description: "Unauthorized" },
        "409": { description: "Conflict" },
      },
    };
    paths[route.path] = methods;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "solomad API",
      version: "1.0.0",
      description: "Versioned HTTP contract. Authorization is enforced on the server from the verified identity, never from a client-supplied user id.",
    },
    paths,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    },
  };
}
