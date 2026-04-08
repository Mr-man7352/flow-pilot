import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing environment variable: DATABASE_URL");
}
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
