import { Signer } from "@aws-sdk/rds-signer";
import postgres from "postgres";

function parsePostgresUrl(databaseUrl: string) {
  const url = new URL(databaseUrl.replace(/^postgres:\/\//, "http://"));
  const database = url.pathname.replace(/^\//, "") || "postgres";
  const username = decodeURIComponent(url.username || "postgres");
  const port = url.port ? Number(url.port) : 5432;
  return { host: url.hostname, port, database, username };
}

export function createSql(databaseUrl: string, max = 10): postgres.Sql {
  const shared = {
    max,
    idle_timeout: 20,
    connect_timeout: 20,
    onnotice: () => undefined,
  };
  if (process.env.DATABASE_IAM_AUTH === "true") {
    const { host, port, database, username } = parsePostgresUrl(databaseUrl);
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
    const signer = new Signer({ hostname: host, port, username, region });
    return postgres({
      ...shared,
      host,
      port,
      database,
      username,
      password: async () => signer.getAuthToken(),
      ssl: "require",
    });
  }
  return postgres(databaseUrl, shared);
}

export type Sql = postgres.Sql;
export type Queryable = postgres.Sql | postgres.TransactionSql;
