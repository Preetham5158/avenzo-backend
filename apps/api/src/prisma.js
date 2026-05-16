const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

function withPgLibpqCompat(connectionString) {
    if (!connectionString || !connectionString.startsWith("postgres")) {
        return connectionString;
    }

    const url = new URL(connectionString);
    if (url.searchParams.get("sslmode") === "require") {
        url.searchParams.set("uselibpqcompat", "true");
    }
    return url.toString();
}

function createPrismaClient() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return new PrismaClient();

    // Supabase pooler connections need Prisma's pg adapter with libpq-compatible SSL.
    const adapter = new PrismaPg({
        connectionString: withPgLibpqCompat(connectionString)
    });

    return new PrismaClient({ adapter });
}

module.exports = {
    createPrismaClient,
    withPgLibpqCompat
};
