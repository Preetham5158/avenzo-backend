const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  // Create Restaurant
  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Avenzo Test Restaurant",
    },
  });

  console.log("Restaurant created:", restaurant);

  // Create Menu Items
  const menu1 = await prisma.menu.create({
    data: {
      name: "Dosa",
      price: 50,
      restaurantId: restaurant.id,
    },
  });

  const menu2 = await prisma.menu.create({
    data: {
      name: "Idli",
      price: 30,
      restaurantId: restaurant.id,
    },
  });

  console.log("Menu created:", menu1, menu2);
}

main()
  .then(() => {
    console.log("Seeding done ✅");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });