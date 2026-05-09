const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function hashLock(value) {
  return String(value).split("").reduce((sum, char) => sum + char.charCodeAt(0), 100);
}

function commons(file) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`;
}

const foodImages = {
  thatteIdli: commons("Idli Sambar.JPG"),
  miniIdli: commons("Idli Sambar.JPG"),
  ravaIdli: commons("Rava idli.jpg"),
  softIdli: commons("Idli Sambar.JPG"),
  meduVada: commons("Medu Vada.JPG"),
  sambarVada: commons("Medu Vada.JPG"),
  curdVada: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=900&q=80",
  masalaDosa: commons("Masala Dosa.jpg"),
  plainDosa: commons("Dosa with chutney and sambar.jpg"),
  setDosa: commons("Set dosa.jpg"),
  ravaDosa: commons("Rava dosa.jpg"),
  neerDosa: commons("Neer dosa.jpg"),
  mysoreDosa: commons("Mysore masala dosa.jpg"),
  poori: commons("Poori masala.jpg"),
  pongal: commons("Pongal.jpg"),
  upma: commons("Upma.jpg"),
  kesari: commons("Kesari bath.jpg"),
  bisiBeleBath: commons("Bisi bele bath.jpg"),
  puliyogare: commons("Puliyogare.jpg"),
  lemonRice: commons("Lemon rice.jpg"),
  tomatoRice: commons("Tomato rice.jpg"),
  curdRice: commons("Curd rice.jpg"),
  meals: commons("South Indian Meals.jpg"),
  chapati: commons("Chapati with vegetable kurma.jpg"),
  paneer: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=900&q=80",
  kurma: commons("Vegetable Kurma.jpg"),
  dal: commons("Dal tadka.jpg"),
  gobi: commons("Gobi Manchurian.jpg"),
  friedRice: commons("Fried Rice (3668697253).jpg"),
  noodles: commons("Veg Hakka Noodles.jpg"),
  bajji: commons("Mangalore bajji.jpg"),
  maddurVade: commons("Maddur vade.jpg"),
  masalaVada: commons("Masala Vada.jpg"),
  bonda: commons("Bonda soup.jpg"),
  samosa: commons("Samosa.jpg"),
  cutlet: commons("Vegetable cutlet.jpg"),
  mysorePak: commons("Mysore Pak.jpg"),
  halwa: commons("Badam Halwa.jpg"),
  payasa: commons("Payasam.jpg"),
  gulabJamun: commons("Gulab Jamun.jpg"),
  coffee: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=80",
  chicken: "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=900&q=80",
  biryani: "https://images.unsplash.com/photo-1563379091339-03246963d96c?auto=format&fit=crop&w=900&q=80",
  tea: commons("Indian Tea.jpg"),
  badamMilk: commons("Badam milk.jpg"),
  limeSoda: "https://images.unsplash.com/photo-1627662168223-7df99068099a?auto=format&fit=crop&w=900&q=80",
  buttermilk: commons("Buttermilk.JPG"),
  fallback: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=900&q=80"
};

function imageFor(name, category = "south indian food") {
  const lookup = [
    ["thatte idli", "thatteIdli"],
    ["mini idli", "miniIdli"],
    ["rava idli", "ravaIdli"],
    ["soft idli", "softIdli"],
    ["idli vada", "miniIdli"],
    ["ghee podi idli", "miniIdli"],
    ["curd vada", "curdVada"],
    ["sambar vada", "sambarVada"],
    ["medu vada", "meduVada"],
    ["maddur vade", "maddurVade"],
    ["masala vada", "masalaVada"],
    ["bonda", "bonda"],
    ["poori", "poori"],
    ["pongal", "pongal"],
    ["avalakki", "upma"],
    ["shavige", "upma"],
    ["khara bath", "upma"],
    ["kesari", "kesari"],
    ["chow chow", "kesari"],
    ["bisi bele", "bisiBeleBath"],
    ["puliyogare", "puliyogare"],
    ["lemon rice", "lemonRice"],
    ["tomato bath", "tomatoRice"],
    ["curd rice", "curdRice"],
    ["north indian meals", "meals"],
    ["mini meals", "meals"],
    ["full meals", "meals"],
    ["south indian meals", "meals"],
    ["chapati", "chapati"],
    ["paneer", "paneer"],
    ["kurma", "kurma"],
    ["dal", "dal"],
    ["gobi", "gobi"],
    ["fried rice", "friedRice"],
    ["noodles", "noodles"],
    ["bajji", "bajji"],
    ["samosa", "samosa"],
    ["cutlet", "cutlet"],
    ["mysore pak", "mysorePak"],
    ["halwa", "halwa"],
    ["payasa", "payasa"],
    ["gulab", "gulabJamun"],
    ["badam milk", "badamMilk"],
    ["lime", "limeSoda"],
    ["buttermilk", "buttermilk"],
    ["tea", "tea"],
    ["coffee", "coffee"],
    ["chicken", "chicken"],
    ["biryani", "biryani"],
    ["open butter", "masalaDosa"],
    ["mysore masala", "mysoreDosa"],
    ["cheese masala", "masalaDosa"],
    ["masala dose", "masalaDosa"],
    ["masala dosa", "masalaDosa"],
    ["plain dose", "plainDosa"],
    ["set dose", "setDosa"],
    ["rava dose", "ravaDosa"],
    ["neer dose", "neerDosa"],
    ["podi dose", "masalaDosa"],
    ["dosa", "masalaDosa"],
    ["dose", "masalaDosa"],
    ["idli", "thatteIdli"],
    ["vada", "meduVada"],
    ["rice", "lemonRice"]
  ];
  const lower = `${name} ${category}`.toLowerCase();
  const match = lookup.find(([key]) => lower.includes(key));
  const key = match ? match[1] : "fallback";
  const url = foodImages[key] || foodImages.fallback;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}sig=${hashLock(name)}`;
}

const hotels = [
  {
    name: "Udupi Upachar Hebbal",
    ownerEmail: "owner.udupi@avenzo.com",
    address: "156, Khata 142/141/156, Supradh Building, 11th Main, 3rd Cross Road, Hebbal, Bengaluru",
    locality: "Hebbal",
    foodType: "PURE_VEG",
    pickupNote: "Please stay nearby after ordering. The team will guide you when your food is ready.",
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
    foodType: "PURE_VEG",
    pickupNote: "Place your order from the table and enjoy a smoother dine-in experience.",
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
    foodType: "PURE_VEG",
    pickupNote: "Your order code helps the team serve you quickly during busy hours.",
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
    foodType: "PURE_VEG",
    pickupNote: "Relax after ordering. The restaurant team will keep your food status updated.",
    signatures: [
      ["Dosa", "Vidyarthi Special Masala Dose", 115, "Thick, buttery heritage-style masala dose with chutney."],
      ["Snacks", "Maddur Vade", 55, "Crisp onion-rava snack inspired by old Bengaluru tiffin shops."],
      ["Beverages", "Degree Filter Coffee", 40, "Strong coffee served in classic steel tumbler style."]
    ]
  },
  {
    name: "Brahmin's Coffee Bar Shankarapura",
    ownerEmail: "owner.brahmins@avenzo.com",
    address: "Pushp Kiran, 19, Ranga Rao Road, near Shankar Mutt Road, Shankarapura, Bengaluru",
    locality: "Shankarapura",
    foodType: "PURE_VEG",
    pickupNote: "A quick, warm dine-in flow for classic idli, chutney, and coffee orders.",
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
    foodType: "PURE_VEG",
    pickupNote: "Best enjoyed fresh at the restaurant after a quick Avenzo order.",
    signatures: [
      ["Idli & Vada", "Soft Idli Chutney", 55, "Pillowy idlis served with signature coconut-mint chutney."],
      ["Bath", "Bisi Bele Bath", 75, "Hot lentil-rice bath with vegetables, ghee, and spice blend."],
      ["Beverages", "Veena Filter Coffee", 35, "Classic Malleshwaram coffee for a quick finish."]
    ]
  },
  {
    name: "Avenzo Tandoor House Indiranagar",
    ownerEmail: "owner.tandoor@avenzo.com",
    address: "100 Feet Road, Indiranagar, Bengaluru",
    locality: "Indiranagar",
    foodType: "BOTH",
    pickupNote: "Use your order code at the dine-in counter when the team marks it ready.",
    signatures: [
      ["Starters", "Chicken Tikka", 240, "Char-grilled chicken pieces marinated with yogurt, chilli, ginger, and tandoor spices.", "NON_VEG"],
      ["Rice", "Chicken Biryani", 260, "Aromatic rice layered with chicken, fried onions, mint, and warm spices.", "NON_VEG"],
      ["North Indian", "Paneer Tikka", 210, "Smoky paneer cubes with capsicum, onion, and mild tandoor spices.", "VEG"]
    ]
  },
  {
    name: "Coastal Chicken Corner Koramangala",
    ownerEmail: "owner.coastalchicken@avenzo.com",
    address: "80 Feet Road, Koramangala, Bengaluru",
    locality: "Koramangala",
    foodType: "NON_VEG",
    pickupNote: "Keep your order code ready. The counter team will call it when your food is ready.",
    signatures: [
      ["Starters", "Pepper Chicken", 230, "Boneless chicken tossed with pepper, curry leaves, and coastal spices.", "NON_VEG"],
      ["Rice", "Chicken Ghee Roast Biryani", 280, "Spiced chicken biryani finished with ghee roast masala.", "NON_VEG"],
      ["Curries", "Mangalore Chicken Curry", 260, "Chicken simmered in coconut, chilli, coriander, and coastal masala.", "NON_VEG"]
    ]
  },
  {
    name: "Nandana Family Kitchen HSR",
    ownerEmail: "owner.nandana@avenzo.com",
    address: "27th Main Road, HSR Layout, Bengaluru",
    locality: "HSR Layout",
    foodType: "BOTH",
    pickupNote: "Track your order on Avenzo and collect it using the pickup code.",
    signatures: [
      ["Starters", "Andhra Chilli Chicken", 250, "Chicken tossed with green chilli, curry leaves, and Andhra-style spices.", "NON_VEG"],
      ["Meals", "Veg Andhra Meals", 180, "Rice, dal, sambar, rasam, vegetable curry, curd, pickle, and papad.", "VEG"],
      ["North Indian", "Paneer Pepper Fry", 190, "Paneer tossed with pepper, onion, capsicum, and curry leaves.", "VEG"]
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

const commonNonVegMenu = [
  ["Starters", "Chicken Kabab", 180, "Crisp chicken pieces marinated with chilli, ginger, garlic, and house spices.", "NON_VEG"],
  ["Starters", "Chicken Lollipop", 220, "Fried chicken wings tossed with garlic and chilli sauce.", "NON_VEG"],
  ["Starters", "Tandoori Chicken Half", 260, "Smoky tandoor-roasted chicken with yogurt and spice marinade.", "NON_VEG"],
  ["Rice", "Chicken Biryani", 260, "Aromatic rice layered with chicken, herbs, fried onion, and warm spices.", "NON_VEG"],
  ["Rice", "Egg Biryani", 180, "Biryani rice served with boiled egg, raita, and salna.", "NON_VEG"],
  ["Curries", "Butter Chicken", 280, "Chicken in a buttery tomato gravy with cream and mild spices.", "NON_VEG"],
  ["Curries", "Chicken Chettinad", 270, "Chicken curry with roasted spices, pepper, coconut, and curry leaves.", "NON_VEG"]
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
        foodType: hotel.foodType || "BOTH",
        ownerId: owner.id || admin.id,
        isActive: true,
        subscriptionStatus: "ACTIVE",
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    await prisma.user.create({
      data: {
        email: hotel.ownerEmail.replace("owner.", "staff."),
        password: await bcrypt.hash("Staff@123", 10),
        name: `${hotel.name} Service Team`,
        role: "EMPLOYEE",
        staffRestaurantId: restaurant.id
      }
    });

    const baseMenu = hotel.foodType === "NON_VEG"
      ? commonNonVegMenu
      : hotel.foodType === "BOTH"
        ? [...commonMenu, ...commonNonVegMenu]
        : commonMenu;

    const merged = [...hotel.signatures, ...baseMenu].filter((row, index, rows) =>
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
      data: merged.map(([category, name, price, description, foodType = "VEG"]) => ({
        name,
        price,
        description,
        foodType,
        imageUrl: imageFor(name, category),
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
