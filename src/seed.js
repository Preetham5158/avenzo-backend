const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {

  console.log("🧹 Clearing old data...");

  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.user.deleteMany();

  console.log("✅ Old data cleared");

  /* ================================
     USERS (HASHED PASSWORDS)
  ================================ */

  const password = await bcrypt.hash("Admin@123", 10);

  const admin = await prisma.user.create({
    data: {
      email: "admin@avenzo.com",
      password,
      name: "Avenzo Admin",
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

  /* ================================
     RESTAURANT 1 (VEG)
  ================================ */

  const r1 = await prisma.restaurant.create({
    data: {
      name: "A2B - Adyar Ananda Bhavan",
      slug: "a2b-bangalore",
      ownerId: owner.id
    }
  });

  await prisma.menu.createMany({
    data: [
      { name: "Masala Dosa", price: 80, category: "Breakfast", restaurantId: r1.id },
      { name: "Idli Vada", price: 60, category: "Breakfast", restaurantId: r1.id },
      { name: "Meals", price: 150, category: "Main Course", restaurantId: r1.id },
      { name: "Paneer Butter Masala", price: 220, category: "Main Course", restaurantId: r1.id },
      { name: "Gulab Jamun", price: 70, category: "Desserts", restaurantId: r1.id },
      { name: "Filter Coffee", price: 30, category: "Drinks", restaurantId: r1.id }
    ]
  });

  /* ================================
     RESTAURANT 2 (NON-VEG)
  ================================ */

  const r2 = await prisma.restaurant.create({
    data: {
      name: "Empire Restaurant",
      slug: "empire-bangalore",
      ownerId: owner.id
    }
  });

  await prisma.menu.createMany({
    data: [
      { name: "Chicken Biryani", price: 250, category: "Main Course", restaurantId: r2.id },
      { name: "Mutton Biryani", price: 320, category: "Main Course", restaurantId: r2.id },
      { name: "Tandoori Chicken", price: 300, category: "Starters", restaurantId: r2.id },
      { name: "Butter Chicken", price: 280, category: "Main Course", restaurantId: r2.id },
      { name: "Chicken Kebabs", price: 220, category: "Starters", restaurantId: r2.id },
      { name: "Pepsi", price: 50, category: "Drinks", restaurantId: r2.id }
    ]
  });

  /* ================================
     RESTAURANT 3 (VEG MODERN)
  ================================ */

  const r3 = await prisma.restaurant.create({
    data: {
      name: "Sattvam Pure Veg",
      slug: "sattvam",
      ownerId: owner.id
    }
  });

  await prisma.menu.createMany({
    data: [
      { name: "Paneer Tikka", price: 240, category: "Starters", restaurantId: r3.id },
      { name: "Veg Biryani", price: 180, category: "Main Course", restaurantId: r3.id },
      { name: "Dal Makhani", price: 160, category: "Main Course", restaurantId: r3.id },
      { name: "Roti Basket", price: 120, category: "Main Course", restaurantId: r3.id },
      { name: "Brownie", price: 150, category: "Desserts", restaurantId: r3.id },
      { name: "Fresh Lime Soda", price: 70, category: "Drinks", restaurantId: r3.id }
    ]
  });

  /* ================================
     RESTAURANT 4 (FAST FOOD)
  ================================ */

  const r4 = await prisma.restaurant.create({
    data: {
      name: "Burger King",
      slug: "burger-king",
      ownerId: admin.id
    }
  });

  await prisma.menu.createMany({
    data: [
      { name: "Veg Whopper", price: 180, category: "Burgers", restaurantId: r4.id },
      { name: "Chicken Whopper", price: 220, category: "Burgers", restaurantId: r4.id },
      { name: "French Fries", price: 120, category: "Sides", restaurantId: r4.id },
      { name: "Chicken Nuggets", price: 150, category: "Sides", restaurantId: r4.id },
      { name: "Coke Float", price: 90, category: "Drinks", restaurantId: r4.id },
      { name: "Chocolate Sundae", price: 110, category: "Desserts", restaurantId: r4.id }
    ]
  });

  /* ================================
     OUTPUT
  ================================ */

  console.log("\n🎉 Seed completed successfully!\n");

  console.log("🔐 Login Users:");
  console.log("admin@avenzo.com / Admin@123");
  console.log("owner@avenzo.com / Owner@123\n");

  console.log("🍽 Restaurant Links:\n");

  const all = [r1, r2, r3, r4];

  all.forEach(r => {
    console.log(`${r.name}:
https://avenzo.app/menu.html?restaurantId=${r.id}\n`);
  });

}

main()
  .catch(e => console.error("❌ Seed failed:", e))
  .finally(async () => {
    await prisma.$disconnect();
  });