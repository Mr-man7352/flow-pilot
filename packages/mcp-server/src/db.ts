import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

console.warn(
  `Initializing database pool with connection string: ${process.env.DATABASE_URL}`,
);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
