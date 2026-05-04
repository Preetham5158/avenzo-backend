const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {

  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Avenzo Cafe"
    }
  });

  await prisma.menu.createMany({
    data: [
      { name: "Garlic Bread", price: 120, category: "Starters", restaurantId: restaurant.id },
      { name: "Tomato Soup", price: 90, category: "Starters", restaurantId: restaurant.id },

      { name: "Veg Biryani", price: 180, category: "Main Course", restaurantId: restaurant.id },
      { name: "Paneer Butter Masala", price: 220, category: "Main Course", restaurantId: restaurant.id },

      { name: "Coke", price: 40, category: "Drinks", restaurantId: restaurant.id },
      { name: "Lime Juice", price: 60, category: "Drinks", restaurantId: restaurant.id }
    ]
  });

  console.log("✅ Seeded successfully");
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());