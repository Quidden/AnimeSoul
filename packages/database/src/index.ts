import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client.js";
export function createDatabase(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 3000, max: 10 }),
  });
}
export type Database = ReturnType<typeof createDatabase>;
