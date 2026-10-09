import postgres from "postgres";

export function createSql(databaseUrl: string, max = 10): postgres.Sql {
  return postgres(databaseUrl, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
}

export type Sql = postgres.Sql;
export type Queryable = postgres.Sql | postgres.TransactionSql;
