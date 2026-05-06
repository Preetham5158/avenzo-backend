const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function imageFor(name) {
  return `https://source.unsplash.com/900x700/?${encodeURIComponent(`${name} south indian food`)}`;
}

const hotels = [
  {
    name: "Udupi Upachar Hebbal",
    ownerEmail: "owner.udupi@avenzo.com",
    address: "156, Khata 142/141/156, Supradh Building, 11th Main, 3rd Cross Road, Hebbal, Bengaluru",
    locality: "Hebbal",
    pickupNote: "Show your pickup code at the self-service counter near the coffee section.",
    signatures: [
      ["Dosa", "Udupi Special Masala Dose", 95, "Crisp Udupi-style dose with potato palya, coconut chutney, and sambar."],
      ["Meals", "South Indian Meals", 140, "Rice, sambar, rasam, palya, curd, pickle, papad, and sweet served in hotel style."],
      ["Beverages", "Udupi Filter Coffee", 35, "Strong decoction coffee served hot with frothy milk."]
    ]
  },
  {
    name: "Taaza Thindi Jayanagar",
    ownerEmail: "owner.taaza@avenzo.com",
    address: "29th Cross Road, 4th Block, Jayanagar, Bengaluru",
    locality: "Jayanagar",
    pickupNote: "Collect from the pickup shelf beside the open kitchen once your code is called.",
    signatures: [
      ["Dosa", "Taaza Masala Dose", 60, "Fast-moving crisp dose with fresh potato palya and chutney."],
      ["Combos", "Chow Chow Bath", 70, "A classic serving of khara bath and kesari bath on one plate."],
      ["Beverages", "Taaza Filter Coffee", 30, "Quick-service Bengaluru filter coffee served piping hot."]
    ]
  },
  {
    name: "CTR Shri Sagar Malleshwaram",
    ownerEmail: "owner.ctr@avenzo.com",
    address: "7th Cross, Margosa Road, Malleshwaram, Bengaluru",
    locality: "Malleshwaram",
    pickupNote: "Pickup near the tiffin counter. Keep the code ready during rush hours.",
    signatures: [
      ["Dosa", "Benne Masala Dose", 110, "Butter-roasted Malleshwaram-style dose with crisp edges and soft center."],
      ["Snacks", "Mangalore Bajji", 60, "Hot goli bajji served with coconut chutney."],
      ["Beverages", "Strong Filter Coffee", 40, "Old Bengaluru filter coffee with bold decoction."]
    ]
  },
  {
    name: "Vidyarthi Bhavan Basavanagudi",
    ownerEmail: "owner.vidyarthi@avenzo.com",
    address: "32, Gandhi Bazaar Main Road, Basavanagudi, Bengaluru",
    locality: "Basavanagudi",
    pickupNote: "Collect at the parcel and pickup counter after the code appears as Ready.",
    signatures: [
      ["Dosa", "Vidyarthi Special Masala Dose", 115, "Thick, buttery heritage-style masala dose with chutney."],
      ["Snacks", "Maddur Vade", 55, "Crisp onion-rava snack inspired by old Bengaluru tiffin counters."],
      ["Beverages", "Degree Filter Coffee", 40, "Strong coffee served in classic steel tumbler style."]
    ]
  },
  {
    name: "Brahmin's Coffee Bar Shankarapura",
    ownerEmail: "owner.brahmins@avenzo.com",
    address: "Pushp Kiran, 19, Ranga Rao Road, near Shankar Mutt Road, Shankarapura, Bengaluru",
    locality: "Shankarapura",
    pickupNote: "Collect near the chutney counter. Food is packed for quick standing-service pickup.",
    signatures: [
      ["Idli & Vada", "Idli Vade Chutney", 85, "Soft idli and crisp vade with generous coconut chutney."],
      ["Bath", "Khara Bath", 45, "Soft rava bath with vegetables, cashew, and Bengaluru-style seasoning."],
      ["Beverages", "Brahmin's Filter Coffee", 35, "Thick, strong coffee built for a quick breakfast stop."]
    ]
  },
  {
    name: "Veena Stores Malleshwaram",
    ownerEmail: "owner.veena@avenzo.com",
    address: "187, 15th Cross, Margosa Road, Malleshwaram, Bengaluru",
    locality: "Malleshwaram",
    pickupNote: "Pickup at the standing counter. Best for quick idli, bath, and coffee orders.",
    signatures: [
      ["Idli & Vada", "Soft Idli Chutney", 55, "Pillowy idlis served with signature coconut-mint chutney."],
      ["Bath", "Bisi Bele Bath", 75, "Hot lentil-rice bath with vegetables, ghee, and spice blend."],
      ["Beverages", "Veena Filter Coffee", 35, "Classic Malleshwaram coffee for a quick finish."]
    ]
  }
];

const commonMenu = [
  ["Breakfast", "Thatte Idli", 45, "Large soft steamed idli served with coconut chutney and sambar."],
  ["Breakfast", "Mini Idli Sambar", 65, "Bite-sized idlis soaked in hot sambar with ghee."],
  ["Breakfast", "Rava Idli", 55, "Semolina idli steamed with cashew, carrot, and mild spices."],
  ["Breakfast", "Poori Sagu", 75, "Puffed pooris served with vegetable sagu and chutney."],
  ["Breakfast", "Khara Pongal", 65, "Rice and moong dal pongal with pepper, cumin, cashew, and ghee."],
  ["Breakfast", "Avalakki Bath", 55, "Flattened rice cooked with onion, peanuts, lemon, and curry leaves."],
  ["Breakfast", "Shavige Bath", 55, "Vermicelli upma with vegetables, mustard, curry leaves, and coconut."],
  ["Idli & Vada", "Idli Vada Combo", 80, "Two idlis and one crisp vada with chutney and sambar."],
  ["Idli & Vada", "Medu Vada", 45, "Crisp urad dal vada with fluffy center and peppery seasoning."],
  ["Idli & Vada", "Sambar Vada", 65, "Crisp vada dipped in hot sambar and topped with coriander."],
  ["Idli & Vada", "Ghee Podi Idli", 80, "Mini idlis tossed with ghee and spiced lentil podi."],
  ["Idli & Vada", "Curd Vada", 80, "Soft vada served in seasoned curd with boondi and spices."],
  ["Dosa", "Plain Dose", 60, "Classic crisp rice-lentil dose served with chutney and sambar."],
  ["Dosa", "Masala Dose", 75, "Crisp dose filled with potato palya and served with chutneys."],
  ["Dosa", "Set Dose", 70, "Three soft sponge dosas served with sagu and chutney."],
  ["Dosa", "Open Butter Masala Dose", 100, "Open dose topped with butter, podi, and potato masala."],
  ["Dosa", "Rava Dose", 80, "Lacy semolina dose with pepper, cumin, onion, and coriander."],
  ["Dosa", "Onion Rava Dose", 90, "Crisp rava dose topped with chopped onions and herbs."],
  ["Dosa", "Podi Dose", 85, "Crisp dose coated with spiced lentil podi and ghee."],
  ["Dosa", "Neer Dose", 70, "Soft coastal rice crepes served with chutney and sagu."],
  ["Dosa", "Mysore Masala Dose", 95, "Dose spread with red chutney and filled with potato masala."],
  ["Dosa", "Cheese Masala Dose", 115, "Masala dose finished with melted cheese for a richer bite."],
  ["Bath", "Khara Bath", 50, "Rava upma cooked with vegetables, curry leaves, and cashews."],
  ["Bath", "Kesari Bath", 50, "Semolina sweet with saffron color, ghee, raisins, and cashews."],
  ["Bath", "Chow Chow Bath", 85, "Khara bath and kesari bath served together as a breakfast classic."],
  ["Bath", "Bisi Bele Bath", 80, "Rice, lentils, vegetables, tamarind, and masala finished with ghee."],
  ["Bath", "Puliyogare", 65, "Tamarind rice with peanuts, sesame, jaggery, and curry leaves."],
  ["Bath", "Lemon Rice", 60, "Turmeric rice tossed with lemon, peanuts, and mustard tempering."],
  ["Bath", "Tomato Bath", 65, "Tomato rice cooked with spices, herbs, and cashews."],
  ["Bath", "Curd Rice", 60, "Comfort curd rice with ginger, curry leaves, mustard, and coriander."],
  ["Meals", "Mini Meals", 110, "Rice, sambar, rasam, palya, curd, papad, and pickle."],
  ["Meals", "Full Meals", 150, "Unlimited-style hotel meal plate with rice, sambar, rasam, curd, palya, and sweet."],
  ["Meals", "North Indian Meals", 170, "Roti, dal, sabzi, pulao, curd, salad, and sweet."],
  ["Meals", "Curd Rice Meal", 85, "Curd rice served with pickle, papad, and a small sweet."],
  ["Meals", "Chapati Kurma", 85, "Soft chapatis served with vegetable kurma."],
  ["North Indian", "Paneer Butter Masala", 170, "Paneer cooked in tomato, butter, cream, and mild spices."],
  ["North Indian", "Veg Kurma", 120, "Mixed vegetables in coconut-cashew gravy."],
  ["North Indian", "Dal Tadka", 110, "Yellow dal tempered with cumin, garlic, and ghee."],
  ["North Indian", "Gobi Manchurian", 120, "Crisp cauliflower tossed in Indo-Chinese garlic sauce."],
  ["North Indian", "Veg Fried Rice", 120, "Wok-tossed rice with vegetables, soy, and spring onion."],
  ["North Indian", "Veg Noodles", 120, "Noodles tossed with vegetables and light soy seasoning."],
  ["Snacks", "Mangalore Bajji", 55, "Fried fermented flour fritters served with chutney."],
  ["Snacks", "Maddur Vade", 55, "Crisp onion and rava snack with curry leaves."],
  ["Snacks", "Masala Vada", 45, "Chana dal fritter with onion, chilli, and herbs."],
  ["Snacks", "Bonda Soup", 70, "Urad dal bonda served in hot lentil soup."],
  ["Snacks", "Samosa", 35, "Crisp pastry stuffed with spiced potato filling."],
  ["Snacks", "Cutlet", 55, "Vegetable cutlet served with chutney and ketchup."],
  ["Sweets", "Mysore Pak", 60, "Gram flour sweet cooked with ghee and sugar."],
  ["Sweets", "Badam Halwa", 90, "Rich almond halwa with saffron and ghee."],
  ["Sweets", "Payasa", 55, "Traditional milk pudding with vermicelli, cardamom, and nuts."],
  ["Sweets", "Gulab Jamun", 60, "Warm syrup-soaked milk-solid dumplings."],
  ["Beverages", "Filter Coffee", 35, "Strong South Indian decoction coffee with frothy milk."],
  ["Beverages", "Tea", 25, "Hot milk tea brewed with hotel-style strength."],
  ["Beverages", "Badam Milk", 60, "Sweet saffron almond milk served hot or chilled."],
  ["Beverages", "Fresh Lime Soda", 60, "Sparkling lime drink served sweet, salt, or mixed."],
  ["Beverages", "Masala Buttermilk", 35, "Chilled buttermilk with cumin, ginger, coriander, and curry leaves."]
];

async function main() {
  console.log("Clearing existing data...");
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.category.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({
    data: {
      email: "admin@avenzo.com",
      password: await bcrypt.hash("Admin@123", 10),
      name: "Avenzo Admin",
      role: "ADMIN"
    }
  });

  for (const hotel of hotels) {
    const owner = await prisma.user.create({
      data: {
        email: hotel.ownerEmail,
        password: await bcrypt.hash("Owner@123", 10),
        name: `${hotel.name} Owner`,
        role: "RESTAURANT_OWNER"
      }
    });

    const restaurant = await prisma.restaurant.create({
      data: {
        name: hotel.name,
        slug: slugify(hotel.name),
        address: hotel.address,
        locality: hotel.locality,
        pickupNote: hotel.pickupNote,
        ownerId: owner.id || admin.id
      }
    });

    const merged = [...hotel.signatures, ...commonMenu].filter((row, index, rows) =>
      rows.findIndex(other => other[1] === row[1]) === index
    );
    const categories = [...new Set(merged.map(row => row[0]))];
    const categoryRecords = {};

    for (const [index, name] of categories.entries()) {
      categoryRecords[name] = await prisma.category.create({
        data: { name, restaurantId: restaurant.id, sortOrder: index + 1 }
      });
    }

    await prisma.menu.createMany({
      data: merged.map(([category, name, price, description]) => ({
        name,
        price,
        description,
        imageUrl: imageFor(name),
        restaurantId: restaurant.id,
        categoryId: categoryRecords[category].id,
        isAvailable: true,
        isActive: true
      }))
    });

    console.log(`Seeded ${hotel.name} with ${merged.length} menu items.`);
  }

  console.log("Seed completed.");
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
