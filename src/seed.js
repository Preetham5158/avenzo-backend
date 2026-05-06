const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function createCategories(restaurantId) {
  const categories = await prisma.category.createMany({
    data: [
      { name: "Breakfast", restaurantId },
      { name: "Starters", restaurantId },
      { name: "Main Course", restaurantId },
      { name: "Desserts", restaurantId },
      { name: "Drinks", restaurantId },
      { name: "Sides", restaurantId },
      { name: "Burgers", restaurantId }
    ],
    skipDuplicates: true
  });

  return prisma.category.findMany({ where: { restaurantId } });
}

function getCatId(cats, name) {
  return cats.find(c => c.name === name)?.id;
}

async function main() {

  console.log("🧹 Clearing old data...");

  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.category.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.user.deleteMany();

  console.log("✅ Old data cleared");

  /* ================= USERS ================= */

  const admin = await prisma.user.create({
    data: {
      email: "admin@avenzo.com",
      password: await bcrypt.hash("Admin@123", 10),
      name: "Super Admin",
      role: "ADMIN"
    }
  });

  const owner = await prisma.user.create({
    data: {
      email: "owner@avenzo.com",
      password: await bcrypt.hash("Owner@123", 10),
      name: "Restaurant Owner"
    }
  });

  console.log("👤 Users created");

  /* ================= RESTAURANTS ================= */

  const r1 = await prisma.restaurant.create({
    data: { name: "A2B", slug: "a2b", ownerId: owner.id }
  });

  const r2 = await prisma.restaurant.create({
    data: { name: "Empire", slug: "empire", ownerId: owner.id }
  });

  const r3 = await prisma.restaurant.create({
    data: { name: "Sattvam", slug: "sattvam", ownerId: owner.id }
  });

  const r4 = await prisma.restaurant.create({
    data: { name: "Burger King", slug: "bk", ownerId: admin.id } // admin owns this
  });

  const allRestaurants = [r1, r2, r3, r4];

  /* ================= MENU + CATEGORIES ================= */

  for (const r of allRestaurants) {

    const cats = await createCategories(r.id);

    await prisma.menu.createMany({
      data: [
        {
          name: "Masala Dosa",
          price: 80,
          categoryId: getCatId(cats, "Breakfast"),
          restaurantId: r.id
        },
        {
          name: "Paneer Butter Masala",
          price: 220,
          categoryId: getCatId(cats, "Main Course"),
          restaurantId: r.id
        },
        {
          name: "Gulab Jamun",
          price: 70,
          categoryId: getCatId(cats, "Desserts"),
          restaurantId: r.id
        },
        {
          name: "Coke",
          price: 50,
          categoryId: getCatId(cats, "Drinks"),
          restaurantId: r.id
        }
      ]
    });
  }

  console.log("🎉 Seed completed!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());