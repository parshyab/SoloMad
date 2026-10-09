const apiOrigin = process.env.API_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";

type PublicActivity = {
  id: string;
  title: string;
  emoji: string;
  category: string;
  cityName: string;
  venueName: string | null;
  startsAt: string;
  timezone: string;
  hostName: string;
};

export default async function ActivitySharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await fetch(`${apiOrigin}/v1/public/activities/${id}`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) {
    return <p>This activity is not available.</p>;
  }
  const activity = (await response.json()) as PublicActivity;
  return (
    <article>
      <p>{activity.emoji} {activity.category}</p>
      <h1>{activity.title}</h1>
      <p>{activity.cityName}{activity.venueName ? ` · ${activity.venueName}` : ""}</p>
      <p>{activity.startsAt} · {activity.timezone}</p>
      <p>Hosted by {activity.hostName}</p>
      <p>Open the solomad app to join. Participant lists and chats stay in the app.</p>
    </article>
  );
}
