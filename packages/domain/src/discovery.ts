import type { Client } from "./db";

export type DiscoveryQuery = {
  userId: string | null;
  category?: string;
  north?: number;
  south?: number;
  east?: number;
  west?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  availableOnly?: boolean;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
  zoom?: number;
};

export async function searchDiscovery(sql: Client, query: DiscoveryQuery) {
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 50);
  const radius = Math.min(Math.max(query.radiusMeters ?? 25000, 100), 100_000);
  const zoom = query.zoom ?? 13;
  if (zoom < 11 && query.north !== undefined && query.south !== undefined && query.east !== undefined && query.west !== undefined) {
    const clusters = await sql<{ latitude: number; longitude: number; count: string }[]>`
      SELECT ST_Y(ST_Centroid(ST_Collect(meeting_point::geometry))) AS latitude,
             ST_X(ST_Centroid(ST_Collect(meeting_point::geometry))) AS longitude,
             count(*)::text AS count
      FROM activities a
      WHERE a.status = 'published'
        AND a.starts_at > now()
        AND ST_Intersects(a.meeting_point, ST_MakeEnvelope(${query.west}, ${query.south}, ${query.east}, ${query.north}, 4326)::geography)
        AND (${query.category ?? null}::text IS NULL OR a.category = ${query.category ?? null})
      GROUP BY ST_SnapToGrid(a.meeting_point::geometry, 0.02)
      LIMIT 100
    `;
    return { mode: "clusters" as const, clusters, items: [] as DiscoveryItem[] };
  }
  const items = await sql<DiscoveryItem[]>`
    SELECT a.id, a.title, a.emoji, a.category, a.starts_at, a.timezone, a.capacity, a.going_count, a.status,
           a.host_user_id, a.version, c.name AS city_name, v.name AS venue_name,
           ST_Y(a.meeting_point::geometry) AS latitude,
           ST_X(a.meeting_point::geometry) AS longitude,
           p.display_name AS host_name,
           m.status AS membership
    FROM activities a
    JOIN cities c ON c.id = a.city_id
    LEFT JOIN venues v ON v.id = a.venue_id
    JOIN profiles p ON p.user_id = a.host_user_id
    LEFT JOIN activity_memberships m ON m.activity_id = a.id AND m.user_id = ${query.userId}
    WHERE a.status = 'published'
      AND a.starts_at > now()
      AND (${query.category ?? null}::text IS NULL OR a.category = ${query.category ?? null})
      AND (${query.from ?? null}::timestamptz IS NULL OR a.starts_at >= ${query.from ?? null})
      AND (${query.to ?? null}::timestamptz IS NULL OR a.starts_at <= ${query.to ?? null})
      AND (${query.availableOnly ?? false} = false OR a.going_count < a.capacity)
      AND (
        ${query.latitude ?? null}::float8 IS NULL
        OR ST_DWithin(a.meeting_point, ST_SetSRID(ST_MakePoint(${query.longitude ?? 0}, ${query.latitude ?? 0}), 4326)::geography, ${radius})
      )
      AND (
        ${query.north ?? null}::float8 IS NULL
        OR ST_Intersects(a.meeting_point, ST_MakeEnvelope(${query.west ?? -180}, ${query.south ?? -90}, ${query.east ?? 180}, ${query.north ?? 90}, 4326)::geography)
      )
      AND (${query.userId}::uuid IS NULL OR NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${query.userId} AND b.blocked_id = a.host_user_id)
           OR (b.blocker_id = a.host_user_id AND b.blocked_id = ${query.userId})
      ))
    ORDER BY a.starts_at, a.id
    LIMIT ${limit}
  `;
  return { mode: "items" as const, clusters: [], items };
}

export type DiscoveryItem = {
  id: string;
  title: string;
  emoji: string;
  category: string;
  starts_at: Date;
  timezone: string;
  capacity: number;
  going_count: number;
  status: string;
  host_user_id: string;
  version: number;
  city_name: string;
  venue_name: string | null;
  latitude: number;
  longitude: number;
  host_name: string;
  membership: string | null;
};

export async function searchPlaces(sql: Client, text: string) {
  const pattern = `%${text.trim().slice(0, 80)}%`;
  const cities = await sql<{ id: string; name: string; kind: string }[]>`
    SELECT id, name, 'city' AS kind FROM cities WHERE name ILIKE ${pattern} ORDER BY name LIMIT 8
  `;
  const activities = await sql<{ id: string; name: string; kind: string }[]>`
    SELECT id, title AS name, 'activity' AS kind FROM activities
    WHERE status = 'published' AND starts_at > now() AND title ILIKE ${pattern}
    ORDER BY starts_at LIMIT 8
  `;
  const venues = await sql<{ id: string; name: string; kind: string }[]>`
    SELECT id, name, 'venue' AS kind FROM venues WHERE name ILIKE ${pattern} ORDER BY name LIMIT 8
  `;
  return { cities, activities, venues };
}
