const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {

  /* ================================
     CLEANUP (VERY IMPORTANT)
     Order matters due to FK constraints
  ================================ */

  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.restaurant.deleteMany();

  console.log("🧹 Old data cleared");

  /* ================================
     RESTAURANT 1
  ================================ */
  const restaurant1 = await prisma.restaurant.create({
    data: {
      name: "Avenzo Cafe"
    }
  });

  await prisma.menu.createMany({
    data: [
      { name: "Garlic Bread", price: 120, category: "Starters", isAvailable: true, restaurantId: restaurant1.id },
      { name: "Tomato Soup", price: 90, category: "Starters", isAvailable: true, restaurantId: restaurant1.id },

      { name: "Veg Biryani", price: 180, category: "Main Course", isAvailable: true, restaurantId: restaurant1.id },
      { name: "Paneer Butter Masala", price: 220, category: "Main Course", isAvailable: true, restaurantId: restaurant1.id },

      { name: "Coke", price: 40, category: "Drinks", isAvailable: true, restaurantId: restaurant1.id },
      { name: "Lime Juice", price: 60, category: "Drinks", isAvailable: true, restaurantId: restaurant1.id }
    ]
  });

  /* ================================
     RESTAURANT 2
  ================================ */
  const restaurant2 = await prisma.restaurant.create({
    data: {
      name: "Spice Garden"
    }
  });

  await prisma.menu.createMany({
    data: [
      { name: "Chicken Biryani", price: 250, category: "Main Course", isAvailable: true, restaurantId: restaurant2.id },
      { name: "Tandoori Chicken", price: 300, category: "Starters", isAvailable: true, restaurantId: restaurant2.id },
      { name: "Pepsi", price: 50, category: "Drinks", isAvailable: true, restaurantId: restaurant2.id }
    ]
  });

  /* ================================
     LOG OUTPUT (VERY USEFUL)
  ================================ */
  console.log("✅ Seed completed successfully");

  console.log("\n🔗 Restaurant URLs:\n");

  console.log(`Avenzo Cafe:
https://avenzo.app/menu.html?restaurantId=${restaurant1.id}
`);

  console.log(`Spice Garden:
https://avenzo.app/menu.html?restaurantId=${restaurant2.id}
`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });