import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function initAdmin() {
  console.log("Checking for admin user...");

  const existing = await prisma.user.findUnique({
    where: { email: "samiksha.bhuvad@b2winfotech.ai" },
  });

  if (existing) {
    console.log("Admin user already exists");
    return;
  }

  const admin = await prisma.user.create({
    data: {
      fullName: "Samiksha Bhuvad",
      email: "samiksha.bhuvad@b2winfotech.ai",
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log("✓ Created admin user:", admin.email);
}

initAdmin()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Failed to initialize admin:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
