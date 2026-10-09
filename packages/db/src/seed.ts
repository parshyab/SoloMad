import { createSql } from "./client";
import { cities, seedUsers } from "./ids";

export async function seed(databaseUrl: string): Promise<void> {
  const sql = createSql(databaseUrl, 1);
  try {
    await sql`
      INSERT INTO countries (code, name) VALUES
        ('PT', 'Portugal'),
        ('ES', 'Spain'),
        ('KR', 'South Korea'),
        ('FR', 'France')
      ON CONFLICT (code) DO NOTHING
    `;
    await sql`
      INSERT INTO cities (id, country_code, name, slug, timezone, location) VALUES
        (${cities.lisbon}, 'PT', 'Lisbon', 'lisbon', 'Europe/Lisbon', ST_SetSRID(ST_MakePoint(-9.1393, 38.7223), 4326)::geography),
        (${cities.barcelona}, 'ES', 'Barcelona', 'barcelona', 'Europe/Madrid', ST_SetSRID(ST_MakePoint(2.1734, 41.3851), 4326)::geography),
        (${cities.seoul}, 'KR', 'Seoul', 'seoul', 'Asia/Seoul', ST_SetSRID(ST_MakePoint(126.9780, 37.5665), 4326)::geography),
        (${cities.paris}, 'FR', 'Paris', 'paris', 'Europe/Paris', ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)::geography)
      ON CONFLICT (id) DO NOTHING
    `;
    const people = [
      { id: seedUsers.mina, name: "Mina Alves", subject: "dev:mina", country: "PT", city: cities.lisbon, interests: ["food", "coffee"], languages: ["pt", "en"] },
      { id: seedUsers.jonah, name: "Jonah Park", subject: "dev:jonah", country: "KR", city: cities.lisbon, interests: ["outdoors", "food"], languages: ["ko", "en"] },
      { id: seedUsers.leila, name: "Leila Benoit", subject: "dev:leila", country: "FR", city: cities.barcelona, interests: ["culture", "coffee"], languages: ["fr", "en"] },
      { id: seedUsers.admin, name: "Avery Admin", subject: "dev:admin", country: "PT", city: cities.lisbon, interests: ["food"], languages: ["en"] },
    ];
    for (const person of people) {
      await sql`
        INSERT INTO users (id, status, onboarding_step, onboarding_completed_at, birth_date, adult_eligible)
        VALUES (${person.id}, 'active', 'complete', now(), '1994-04-02', true)
        ON CONFLICT (id) DO UPDATE SET adult_eligible = true, onboarding_step = 'complete',
          onboarding_completed_at = COALESCE(users.onboarding_completed_at, now())
      `;
      await sql`
        INSERT INTO identities (user_id, provider, provider_subject, email)
        VALUES (${person.id}, 'apple', ${person.subject}, ${`${person.subject}@solomad.invalid`})
        ON CONFLICT (provider, provider_subject) DO NOTHING
      `;
      await sql`
        INSERT INTO profiles (user_id, display_name, home_country_code, bio, current_city_id, verification_status, visibility)
        VALUES (${person.id}, ${person.name}, ${person.country}, 'Fictional development profile.', ${person.city}, 'none', 'members')
        ON CONFLICT (user_id) DO NOTHING
      `;
      await sql`INSERT INTO preferences (user_id, push_enabled) VALUES (${person.id}, false) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO entitlements (user_id) VALUES (${person.id}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO user_roles (user_id, role) VALUES (${person.id}, 'member') ON CONFLICT DO NOTHING`;
      for (const language of person.languages) {
        await sql`INSERT INTO profile_languages (user_id, language_code) VALUES (${person.id}, ${language}) ON CONFLICT DO NOTHING`;
      }
      for (const interest of person.interests) {
        await sql`INSERT INTO profile_interests (user_id, interest) VALUES (${person.id}, ${interest}) ON CONFLICT DO NOTHING`;
      }
    }
    await sql`INSERT INTO user_roles (user_id, role) VALUES (${seedUsers.admin}, 'admin') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO user_roles (user_id, role) VALUES (${seedUsers.admin}, 'moderator') ON CONFLICT DO NOTHING`;

    const dinner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const coffee = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    const venue = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    await sql`
      INSERT INTO venues (id, city_id, name, address, location, provider, attribution)
      VALUES (${venue}, ${cities.lisbon}, 'Alfama Supper Club', 'Fictional venue in Alfama',
        ST_SetSRID(ST_MakePoint(-9.1306, 38.7126), 4326)::geography, 'seed', 'Fictional development venue')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO activities (
        id, host_user_id, city_id, venue_id, category, emoji, title, description, starts_at, ends_at, timezone,
        meeting_point, capacity, going_count, expense_guidance, status
      ) VALUES (
        ${dinner}, ${seedUsers.mina}, ${cities.lisbon}, ${venue}, 'food', '🍝', 'sunset dinner in Alfama',
        'A fictional supper for travelers. Pay for your own meal.',
        date_trunc('hour', now()) + interval '2 days' + interval '19 hours',
        date_trunc('hour', now()) + interval '2 days' + interval '21 hours',
        'Europe/Lisbon', ST_SetSRID(ST_MakePoint(-9.1306, 38.7126), 4326)::geography,
        6, 2, 'Each person pays for their own meal.', 'published'
      )
      ON CONFLICT (id) DO UPDATE SET
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        status = CASE WHEN activities.status IN ('cancelled', 'completed') THEN activities.status ELSE 'published' END
    `;
    await sql`
      INSERT INTO activities (
        id, host_user_id, city_id, venue_id, category, emoji, title, description, starts_at, timezone,
        meeting_point, capacity, going_count, expense_guidance, status
      ) VALUES (
        ${coffee}, ${seedUsers.leila}, ${cities.barcelona}, NULL, 'coffee', '☕', 'morning coffee in El Born',
        'Fictional coffee meetup.',
        date_trunc('hour', now()) + interval '1 day' + interval '10 hours',
        'Europe/Madrid', ST_SetSRID(ST_MakePoint(2.1822, 41.3858), 4326)::geography,
        4, 1, 'Coffee is inexpensive.', 'published'
      )
      ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at
    `;
    await sql`
      INSERT INTO activity_memberships (activity_id, user_id, status) VALUES
        (${dinner}, ${seedUsers.mina}, 'host'),
        (${dinner}, ${seedUsers.jonah}, 'active'),
        (${coffee}, ${seedUsers.leila}, 'host')
      ON CONFLICT DO NOTHING
    `;
    const dinnerChat = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    const cityChat = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
    await sql`
      INSERT INTO conversations (id, kind, activity_id, city_id, title) VALUES
        (${dinnerChat}, 'activity', ${dinner}, ${cities.lisbon}, 'sunset dinner in Alfama')
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO conversations (id, kind, city_id, shard, title, member_limit) VALUES
        (${cityChat}, 'city', ${cities.lisbon}, 0, 'Lisbon travelers', 500)
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO conversation_members (conversation_id, user_id, role) VALUES
        (${dinnerChat}, ${seedUsers.mina}, 'host'),
        (${dinnerChat}, ${seedUsers.jonah}, 'member'),
        (${cityChat}, ${seedUsers.mina}, 'member'),
        (${cityChat}, ${seedUsers.jonah}, 'member')
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO messages (conversation_id, sender_id, client_message_id, body, kind)
      VALUES (${dinnerChat}, ${seedUsers.mina}, 'seed-hello', 'See you by the viewpoint.', 'text')
      ON CONFLICT (conversation_id, client_message_id) DO NOTHING
    `;
    await sql`
      INSERT INTO trips (user_id, city_id, start_date, end_date)
      SELECT ${seedUsers.mina}, ${cities.lisbon}, CURRENT_DATE + 1, CURRENT_DATE + 7
      WHERE NOT EXISTS (SELECT 1 FROM trips WHERE user_id = ${seedUsers.mina} AND city_id = ${cities.lisbon})
    `;
    await sql`
      INSERT INTO trips (user_id, city_id, start_date, end_date)
      SELECT ${seedUsers.jonah}, ${cities.lisbon}, CURRENT_DATE + 5, CURRENT_DATE + 12
      WHERE NOT EXISTS (SELECT 1 FROM trips WHERE user_id = ${seedUsers.jonah} AND city_id = ${cities.lisbon})
    `;
    await sql`
      INSERT INTO trips (user_id, city_id, start_date, end_date)
      SELECT ${seedUsers.leila}, ${cities.barcelona}, CURRENT_DATE + 3, CURRENT_DATE + 6
      WHERE NOT EXISTS (SELECT 1 FROM trips WHERE user_id = ${seedUsers.leila} AND city_id = ${cities.barcelona})
    `;
    await sql`
      INSERT INTO feature_flags (key, value) VALUES
        ('ai_recommendations', '{"enabled": true}'::jsonb),
        ('plus_boost', '{"rankingBonus": 0.15}'::jsonb)
      ON CONFLICT (key) DO NOTHING
    `;
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  seed(databaseUrl)
    .then(() => console.log("seed complete"))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
