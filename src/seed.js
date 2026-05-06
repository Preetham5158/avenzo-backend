const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function imageFor(name, cuisine) {
  const query = encodeURIComponent(`${name} ${cuisine} restaurant food`);
  return `https://source.unsplash.com/900x700/?${query}`;
}

function item(category, name, price, description, cuisine) {
  return {
    category,
    name,
    price,
    description,
    imageUrl: imageFor(name, cuisine)
  };
}

function withDescriptions(cuisine, rows) {
  return rows.map(([category, name, price, note]) =>
    item(category, name, price, note, cuisine)
  );
}

const restaurantMenus = [
  {
    name: "Aaranya South Kitchen",
    ownerEmail: "owner.south@avenzo.com",
    cuisine: "south indian",
    categories: ["Breakfast", "Dosa & Uttapam", "Idli & Vada", "Rice Bowls", "Curries", "Breads", "Sweets", "Beverages"],
    items: withDescriptions("south indian", [
      ["Breakfast", "Ghee Pongal", 95, "Soft rice and moong dal cooked with pepper, cumin, curry leaves, and warm ghee."],
      ["Breakfast", "Rava Upma", 75, "Roasted semolina tossed with vegetables, mustard, curry leaves, and cashews."],
      ["Breakfast", "Kesari Bath", 70, "Saffron-tinted semolina sweet finished with ghee, raisins, and roasted cashews."],
      ["Breakfast", "Poori Sagu", 115, "Puffed pooris served with Karnataka-style vegetable sagu and coconut chutney."],
      ["Breakfast", "Akki Roti", 105, "Rice flour flatbread with onion, coriander, green chilli, and coconut."],
      ["Breakfast", "Set Dosa", 110, "Three soft sponge dosas served with vegetable sagu and chutney."],
      ["Breakfast", "Mangalore Buns", 95, "Fluffy banana pooris served with coconut chutney and mildly spiced sambar."],
      ["Dosa & Uttapam", "Classic Masala Dosa", 125, "Crisp rice-lentil dosa filled with potato masala and served with sambar."],
      ["Dosa & Uttapam", "Mysore Masala Dosa", 145, "Crisp dosa layered with red chutney and filled with potato masala."],
      ["Dosa & Uttapam", "Paper Plain Dosa", 120, "Extra-thin golden dosa served with chutneys and sambar."],
      ["Dosa & Uttapam", "Rava Onion Dosa", 135, "Lacy semolina dosa with onion, pepper, ginger, and coriander."],
      ["Dosa & Uttapam", "Podi Ghee Dosa", 145, "Crisp dosa brushed with ghee and coated with spiced lentil podi."],
      ["Dosa & Uttapam", "Cheese Masala Dosa", 165, "Masala dosa finished with melted cheese for a richer bite."],
      ["Dosa & Uttapam", "Onion Uttapam", 130, "Thick fermented pancake topped with onions, chillies, and coriander."],
      ["Idli & Vada", "Steamed Idli", 65, "Soft steamed rice cakes served with sambar and fresh coconut chutney."],
      ["Idli & Vada", "Ghee Podi Idli", 95, "Mini idlis tossed in ghee and house-made spiced podi."],
      ["Idli & Vada", "Rava Idli", 85, "Semolina idlis steamed with cashews, herbs, and grated carrot."],
      ["Idli & Vada", "Medu Vada", 75, "Crisp urad dal doughnuts with fluffy centers and peppery seasoning."],
      ["Idli & Vada", "Sambar Vada", 95, "Medu vada soaked in hot sambar and topped with onion and coriander."],
      ["Idli & Vada", "Curd Vada", 110, "Soft vada in chilled curd with boondi, spices, and tempered mustard."],
      ["Idli & Vada", "Thatte Idli", 80, "Large plate idli with a soft texture and classic chutney pairing."],
      ["Rice Bowls", "Bisi Bele Bath", 135, "Rice, lentils, vegetables, tamarind, and spice blend finished with ghee."],
      ["Rice Bowls", "Lemon Rice", 95, "Turmeric rice tossed with lemon, peanuts, curry leaves, and mustard."],
      ["Rice Bowls", "Curd Rice", 90, "Comforting curd rice tempered with mustard, ginger, and curry leaves."],
      ["Rice Bowls", "Tomato Bath", 105, "Tomato rice cooked with spices, herbs, and roasted cashews."],
      ["Rice Bowls", "Vegetable Pulao", 145, "Fragrant rice cooked with mixed vegetables, mint, and whole spices."],
      ["Rice Bowls", "Sambar Rice", 120, "Rice simmered with lentil sambar, vegetables, and aromatic tempering."],
      ["Rice Bowls", "Puliyogare", 105, "Tamarind rice with peanuts, sesame, curry leaves, and jaggery balance."],
      ["Curries", "Vegetable Kurma", 150, "Mixed vegetables in a creamy coconut-cashew gravy with mild spices."],
      ["Curries", "Paneer Chettinad", 210, "Paneer cubes cooked in roasted coconut, pepper, fennel, and curry leaf masala."],
      ["Curries", "Mushroom Pepper Fry", 190, "Button mushrooms tossed with black pepper, onion, and curry leaves."],
      ["Curries", "Avial", 155, "Kerala-style vegetables in coconut yogurt gravy with curry leaf oil."],
      ["Curries", "Drumstick Sambar", 120, "Lentil stew with drumstick, tamarind, vegetables, and sambar spices."],
      ["Curries", "Kara Kuzhambu", 145, "Tangy tamarind curry with shallots, garlic, and southern spice paste."],
      ["Curries", "Cabbage Poriyal", 95, "Shredded cabbage stir-fried with coconut, mustard, and curry leaves."],
      ["Breads", "Malabar Parotta", 45, "Layered flaky flatbread griddled until crisp on the outside."],
      ["Breads", "Chapati", 35, "Whole wheat flatbread made fresh and served warm."],
      ["Breads", "Appam", 55, "Lacy fermented rice pancake with a soft spongy center."],
      ["Breads", "Neer Dosa", 65, "Thin coastal rice crepes served soft and delicate."],
      ["Breads", "Mini Podi Dosa", 80, "Small crisp dosas dusted with spiced lentil powder."],
      ["Breads", "Ghee Roast Dosa", 150, "Long crisp dosa roasted with generous ghee."],
      ["Breads", "Coin Parotta", 75, "Mini flaky parottas perfect with kurma or Chettinad gravies."],
      ["Sweets", "Mysore Pak", 85, "Rich gram flour sweet cooked with ghee and sugar until melt-in-mouth."],
      ["Sweets", "Payasam", 90, "Traditional milk pudding with vermicelli, cardamom, raisins, and cashews."],
      ["Sweets", "Rava Ladoo", 70, "Semolina ladoos with coconut, ghee, cardamom, and nuts."],
      ["Sweets", "Coconut Holige", 95, "Sweet stuffed flatbread with coconut and jaggery filling."],
      ["Sweets", "Badam Halwa", 130, "Slow-cooked almond halwa with saffron and ghee."],
      ["Beverages", "Filter Coffee", 55, "Strong South Indian decoction coffee with frothy milk."],
      ["Beverages", "Masala Buttermilk", 50, "Chilled buttermilk with ginger, cumin, curry leaves, and coriander."],
      ["Beverages", "Fresh Lime Soda", 70, "Refreshing lime soda served sweet, salted, or mixed."],
      ["Beverages", "Panakam", 65, "Jaggery and ginger cooler with cardamom and lemon."],
      ["Beverages", "Tender Coconut Water", 85, "Naturally sweet coconut water served chilled."]
    ])
  },
  {
    name: "Dilli Darbar North Indian",
    ownerEmail: "owner.north@avenzo.com",
    cuisine: "north indian",
    categories: ["Starters", "Tandoor", "Curries", "Dal & Rice", "Breads", "Biryanis", "Desserts", "Beverages"],
    items: withDescriptions("north indian", [
      ["Starters", "Paneer Tikka", 240, "Paneer cubes marinated in yogurt, spices, and roasted in the tandoor."],
      ["Starters", "Hara Bhara Kebab", 190, "Spinach, peas, and potato patties grilled with aromatic spices."],
      ["Starters", "Dahi Ke Kebab", 220, "Hung-curd kebabs with soft centers and crisp golden crust."],
      ["Starters", "Amritsari Fish", 290, "Crisp gram-flour coated fish with ajwain, chilli, and lemon."],
      ["Starters", "Chicken Malai Tikka", 310, "Creamy chicken tikka marinated with cheese, cardamom, and cashew."],
      ["Starters", "Tandoori Soya Chaap", 220, "Soya chaap roasted with smoky spices and mint chutney."],
      ["Starters", "Aloo Tikki Chaat", 160, "Crisp potato patties topped with yogurt, chutneys, and sev."],
      ["Tandoor", "Tandoori Chicken Half", 360, "Classic bone-in chicken roasted with yogurt, chilli, and garam masala."],
      ["Tandoor", "Chicken Seekh Kebab", 320, "Minced chicken skewers with herbs, spices, and smoky char."],
      ["Tandoor", "Mutton Seekh Kebab", 390, "Juicy mutton skewers grilled with coriander, chilli, and warm spices."],
      ["Tandoor", "Tandoori Mushroom", 230, "Mushrooms marinated in spiced yogurt and roasted until smoky."],
      ["Tandoor", "Afghani Chicken", 380, "Mild creamy tandoori chicken with cashew, cream, and cardamom."],
      ["Tandoor", "Stuffed Tandoori Aloo", 210, "Potatoes filled with paneer, nuts, and spices, roasted in tandoor."],
      ["Tandoor", "Mixed Veg Platter", 420, "Assorted paneer, mushroom, potato, and vegetable tandoori bites."],
      ["Curries", "Butter Chicken", 360, "Tender chicken in a silky tomato-butter gravy with kasuri methi."],
      ["Curries", "Paneer Butter Masala", 280, "Paneer simmered in rich tomato, butter, cashew, and cream gravy."],
      ["Curries", "Kadhai Paneer", 270, "Paneer tossed with peppers, onion, and freshly crushed kadhai masala."],
      ["Curries", "Palak Paneer", 260, "Paneer cubes in smooth spinach gravy with garlic and spices."],
      ["Curries", "Chicken Rara", 380, "Chicken curry enriched with minced chicken and robust Punjabi spices."],
      ["Curries", "Mutton Rogan Josh", 430, "Slow-cooked mutton curry with Kashmiri chilli and aromatic spices."],
      ["Curries", "Chole Masala", 210, "Chickpeas cooked in a dark, tangy Punjabi masala."],
      ["Dal & Rice", "Dal Makhani", 240, "Black lentils simmered overnight with butter, cream, and tomato."],
      ["Dal & Rice", "Dal Tadka", 180, "Yellow lentils finished with cumin, garlic, chilli, and ghee."],
      ["Dal & Rice", "Jeera Rice", 150, "Basmati rice tempered with cumin and ghee."],
      ["Dal & Rice", "Peas Pulao", 175, "Basmati rice with green peas, whole spices, and herbs."],
      ["Dal & Rice", "Rajma Chawal", 230, "Kidney bean curry served with steamed basmati rice."],
      ["Dal & Rice", "Kadhi Chawal", 210, "Yogurt gram-flour curry with pakoras and steamed rice."],
      ["Dal & Rice", "Plain Basmati Rice", 120, "Long-grain basmati rice steamed until fluffy."],
      ["Breads", "Butter Naan", 55, "Soft tandoor-baked naan brushed with butter."],
      ["Breads", "Garlic Naan", 70, "Naan topped with garlic, coriander, and butter."],
      ["Breads", "Tandoori Roti", 35, "Whole wheat roti cooked in the tandoor."],
      ["Breads", "Lachha Paratha", 75, "Layered flaky paratha with crisp edges."],
      ["Breads", "Aloo Kulcha", 95, "Tandoori kulcha stuffed with spiced mashed potatoes."],
      ["Breads", "Paneer Kulcha", 120, "Soft kulcha filled with seasoned paneer."],
      ["Breads", "Roomali Roti", 65, "Thin handkerchief-style roti cooked on an inverted griddle."],
      ["Biryanis", "Veg Dum Biryani", 250, "Layered basmati rice with vegetables, saffron, herbs, and fried onions."],
      ["Biryanis", "Chicken Dum Biryani", 320, "Chicken and basmati rice sealed and slow-cooked with spices."],
      ["Biryanis", "Mutton Dum Biryani", 430, "Tender mutton layered with saffron rice and dum-cooked."],
      ["Biryanis", "Paneer Tikka Biryani", 290, "Paneer tikka layered with fragrant rice and biryani masala."],
      ["Biryanis", "Egg Biryani", 260, "Basmati rice cooked with boiled eggs and aromatic spices."],
      ["Biryanis", "Chicken Tikka Pulao", 310, "Smoky chicken tikka tossed with mildly spiced basmati rice."],
      ["Biryanis", "Kashmiri Pulao", 260, "Sweet-savory pulao with nuts, raisins, and mild spices."],
      ["Desserts", "Gulab Jamun", 95, "Warm milk-solid dumplings soaked in cardamom sugar syrup."],
      ["Desserts", "Rasmalai", 130, "Soft chenna patties in saffron-cardamom milk."],
      ["Desserts", "Phirni", 110, "Ground rice pudding with milk, saffron, and pistachio."],
      ["Desserts", "Gajar Halwa", 125, "Carrot halwa slow-cooked with milk, ghee, and nuts."],
      ["Desserts", "Kulfi Falooda", 150, "Dense kulfi served with falooda, rose syrup, and nuts."],
      ["Beverages", "Sweet Lassi", 95, "Thick Punjabi yogurt drink served chilled."],
      ["Beverages", "Salted Lassi", 85, "Savory yogurt drink with roasted cumin and mint."],
      ["Beverages", "Masala Chaas", 70, "Spiced buttermilk with cumin, ginger, and coriander."],
      ["Beverages", "Jaljeera", 80, "Tangy cumin-mint cooler with black salt."],
      ["Beverages", "Kesar Badam Milk", 135, "Saffron almond milk served chilled or warm."]
    ])
  },
  {
    name: "Nawab's Biryani House",
    ownerEmail: "owner.biryani@avenzo.com",
    cuisine: "biryani indian",
    categories: ["Hyderabadi", "Lucknowi", "Kebabs", "Curries", "Rice & Sides", "Rolls", "Desserts", "Beverages"],
    items: withDescriptions("biryani indian", [
      ["Hyderabadi", "Hyderabadi Chicken Dum Biryani", 330, "Chicken and long-grain rice dum-cooked with saffron, mint, and fried onions."],
      ["Hyderabadi", "Hyderabadi Mutton Dum Biryani", 460, "Tender mutton layered with aromatic rice and slow-cooked in sealed handi."],
      ["Hyderabadi", "Paneer Dum Biryani", 290, "Paneer cubes and basmati rice cooked with biryani spices and herbs."],
      ["Hyderabadi", "Egg Dum Biryani", 260, "Boiled eggs layered with basmati rice, mint, and masala."],
      ["Hyderabadi", "Veg Handi Biryani", 250, "Seasonal vegetables and rice dum-cooked in a clay-style handi."],
      ["Hyderabadi", "Prawns Biryani", 480, "Juicy prawns cooked with rice, saffron, and coastal spice notes."],
      ["Hyderabadi", "Boneless Chicken Biryani", 360, "Boneless chicken pieces layered with fragrant rice and dum masala."],
      ["Lucknowi", "Awadhi Chicken Biryani", 350, "Subtle Lucknowi biryani with fragrant stock, saffron, and tender chicken."],
      ["Lucknowi", "Awadhi Mutton Biryani", 470, "Mutton and rice cooked with gentle spices and slow dum technique."],
      ["Lucknowi", "Murgh Yakhni Pulao", 330, "Chicken pulao cooked in aromatic yakhni stock."],
      ["Lucknowi", "Gosht Yakhni Pulao", 450, "Mutton pulao with delicate whole spices and rich broth."],
      ["Lucknowi", "Soya Chaap Biryani", 280, "Soya chaap layered with rice, saffron, and Awadhi masala."],
      ["Lucknowi", "Mushroom Biryani", 270, "Mushrooms and basmati rice cooked with mild biryani spices."],
      ["Lucknowi", "Subz Noor Mahal Biryani", 260, "Vegetable biryani with nuts, saffron, and aromatic herbs."],
      ["Kebabs", "Galouti Kebab", 430, "Melt-in-mouth minced mutton kebabs with traditional Awadhi spices."],
      ["Kebabs", "Shami Kebab", 330, "Minced meat and chana dal patties pan-seared until crisp."],
      ["Kebabs", "Chicken Reshmi Kebab", 320, "Soft creamy chicken kebabs with cashew and mild spices."],
      ["Kebabs", "Tangdi Kebab", 340, "Chicken drumsticks roasted with yogurt, chilli, and garam masala."],
      ["Kebabs", "Paneer Shashlik", 270, "Paneer and vegetables skewered with tangy tandoori marinade."],
      ["Kebabs", "Boti Kebab", 430, "Mutton cubes marinated and grilled until smoky and tender."],
      ["Kebabs", "Fish Tikka", 390, "Fish cubes roasted with mustard, lemon, and spices."],
      ["Curries", "Mirchi Ka Salan", 150, "Hyderabadi peanut-sesame chilli curry served with biryani."],
      ["Curries", "Chicken Korma", 340, "Chicken cooked in creamy nut-based gravy with aromatic spices."],
      ["Curries", "Mutton Korma", 450, "Slow-cooked mutton curry with browned onions, yogurt, and spices."],
      ["Curries", "Bagara Baingan", 180, "Baby brinjals cooked in peanut, sesame, and tamarind gravy."],
      ["Curries", "Nihari Gosht", 470, "Slow-braised mutton stew with deep spices and ginger."],
      ["Curries", "Paneer Korma", 280, "Paneer simmered in mild cashew and onion gravy."],
      ["Curries", "Chicken Chaap", 360, "Rich Kolkata-style chicken curry with yogurt and spices."],
      ["Rice & Sides", "Burani Raita", 80, "Garlic-seasoned yogurt raita that pairs beautifully with biryani."],
      ["Rice & Sides", "Onion Raita", 70, "Chilled curd with onion, cucumber, and roasted cumin."],
      ["Rice & Sides", "Boondi Raita", 75, "Crisp boondi folded into seasoned yogurt."],
      ["Rice & Sides", "Salan Bowl", 90, "A side portion of tangy peanut chilli salan."],
      ["Rice & Sides", "Steamed Basmati", 120, "Plain basmati rice for curry pairings."],
      ["Rice & Sides", "Masala Papad", 70, "Crisp papad topped with onion, tomato, coriander, and spices."],
      ["Rice & Sides", "Green Salad", 80, "Fresh cucumber, onion, carrot, lemon, and green chilli."],
      ["Rolls", "Chicken Kebab Roll", 220, "Roomali roti wrapped with chicken kebab, onion, and mint chutney."],
      ["Rolls", "Mutton Seekh Roll", 260, "Mutton seekh wrapped with salad and smoky chutney."],
      ["Rolls", "Paneer Tikka Roll", 200, "Paneer tikka wrapped with onions and tangy chutney."],
      ["Rolls", "Egg Kathi Roll", 170, "Paratha layered with egg, onions, and house masala."],
      ["Rolls", "Chicken Biryani Roll", 230, "Biryani-spiced chicken wrapped with rice, onion, and sauce."],
      ["Rolls", "Veg Kebab Roll", 180, "Vegetable kebab roll with mint chutney and onions."],
      ["Rolls", "Double Egg Chicken Roll", 260, "Chicken roll with double egg layer and spiced onions."],
      ["Desserts", "Double Ka Meetha", 120, "Hyderabadi bread pudding with milk, saffron, and nuts."],
      ["Desserts", "Shahi Tukda", 130, "Fried bread soaked in rabri and topped with pistachio."],
      ["Desserts", "Qubani Ka Meetha", 150, "Stewed apricot dessert served with cream."],
      ["Desserts", "Phirni", 110, "Set rice pudding flavored with cardamom and saffron."],
      ["Desserts", "Gulab Jamun", 95, "Warm syrup-soaked dumplings with cardamom."],
      ["Beverages", "Mint Lime Cooler", 90, "Fresh lime with mint, soda, and a sweet-salt balance."],
      ["Beverages", "Rose Milk", 95, "Chilled milk flavored with rose syrup."],
      ["Beverages", "Irani Chai", 60, "Strong milky tea brewed in Hyderabadi cafe style."],
      ["Beverages", "Lassi", 100, "Thick chilled yogurt drink with sugar and cardamom."],
      ["Beverages", "Masala Soda", 85, "Sparkling soda with lime, spices, and black salt."]
    ])
  },
  {
    name: "Burger Forge",
    ownerEmail: "owner.western@avenzo.com",
    cuisine: "burger american",
    categories: ["Burgers", "Fried Chicken", "Sandwiches", "Fries & Sides", "Salads", "Shakes", "Desserts", "Drinks"],
    items: withDescriptions("burger american", [
      ["Burgers", "Classic Cheeseburger", 240, "Juicy grilled patty with cheddar, lettuce, tomato, onion, and house sauce."],
      ["Burgers", "Smoky BBQ Burger", 280, "Patty stacked with BBQ sauce, caramelized onions, cheddar, and pickles."],
      ["Burgers", "Double Smash Burger", 340, "Two smashed patties with cheese, onions, pickles, and burger sauce."],
      ["Burgers", "Crispy Chicken Burger", 260, "Crunchy fried chicken fillet with slaw, pickles, and spicy mayo."],
      ["Burgers", "Peri Peri Chicken Burger", 280, "Grilled chicken with peri peri glaze, lettuce, and garlic mayo."],
      ["Burgers", "Mushroom Swiss Burger", 310, "Patty topped with sauteed mushrooms, Swiss cheese, and aioli."],
      ["Burgers", "Veggie Bean Burger", 220, "Spiced bean patty with lettuce, onion, tomato, and chipotle sauce."],
      ["Fried Chicken", "Classic Fried Chicken", 280, "Bone-in chicken marinated overnight and fried crisp."],
      ["Fried Chicken", "Hot Honey Chicken", 320, "Crispy chicken tossed in sweet chilli honey glaze."],
      ["Fried Chicken", "Chicken Tenders", 240, "Boneless chicken strips with ranch and hot sauce."],
      ["Fried Chicken", "Korean Glazed Wings", 300, "Wings tossed in sticky gochujang-style glaze and sesame."],
      ["Fried Chicken", "Buffalo Wings", 290, "Spicy buffalo wings served with cooling dip."],
      ["Fried Chicken", "Popcorn Chicken", 210, "Bite-sized fried chicken with seasoned crumbs."],
      ["Fried Chicken", "Chicken & Fries Box", 340, "Fried chicken pieces served with seasoned fries and dip."],
      ["Sandwiches", "Grilled Cheese Sandwich", 180, "Toasted sourdough filled with melted cheddar and mozzarella."],
      ["Sandwiches", "Club Sandwich", 260, "Layered sandwich with chicken, egg, lettuce, tomato, and mayo."],
      ["Sandwiches", "BBQ Chicken Sandwich", 250, "Pulled BBQ chicken in toasted bread with slaw."],
      ["Sandwiches", "Paneer Melt Sandwich", 230, "Spiced paneer, cheese, peppers, and onion grilled until golden."],
      ["Sandwiches", "Tuna Mayo Sandwich", 260, "Tuna salad with cucumber, onion, lettuce, and creamy mayo."],
      ["Sandwiches", "Egg Salad Sandwich", 190, "Creamy egg salad with herbs on toasted bread."],
      ["Sandwiches", "Mushroom Melt", 220, "Mushrooms, cheese, garlic butter, and caramelized onions."],
      ["Fries & Sides", "Classic Fries", 130, "Golden fries seasoned with sea salt."],
      ["Fries & Sides", "Peri Peri Fries", 150, "Crisp fries tossed with peri peri seasoning."],
      ["Fries & Sides", "Loaded Cheese Fries", 220, "Fries topped with cheese sauce, jalapenos, and onions."],
      ["Fries & Sides", "Onion Rings", 160, "Crisp battered onion rings served with dip."],
      ["Fries & Sides", "Mozzarella Sticks", 210, "Breaded mozzarella sticks fried until stretchy and golden."],
      ["Fries & Sides", "Mac & Cheese", 240, "Creamy macaroni with cheddar and toasted crumbs."],
      ["Fries & Sides", "Garlic Bread", 150, "Toasted bread brushed with garlic butter and herbs."],
      ["Salads", "Caesar Salad", 230, "Romaine lettuce with Caesar dressing, parmesan, and croutons."],
      ["Salads", "Grilled Chicken Salad", 280, "Grilled chicken with mixed greens, vegetables, and vinaigrette."],
      ["Salads", "Greek Salad", 240, "Cucumber, tomato, olives, feta, and oregano dressing."],
      ["Salads", "Crispy Paneer Salad", 250, "Crunchy paneer bites over greens with spicy ranch."],
      ["Salads", "Coleslaw Bowl", 120, "Cabbage and carrot slaw with creamy dressing."],
      ["Salads", "Avocado Corn Salad", 290, "Avocado, corn, greens, tomato, and lime dressing."],
      ["Salads", "Southwest Bean Salad", 220, "Beans, corn, peppers, lettuce, and chipotle dressing."],
      ["Shakes", "Chocolate Shake", 190, "Thick chocolate milkshake topped with whipped cream."],
      ["Shakes", "Vanilla Bean Shake", 180, "Classic vanilla shake made with ice cream."],
      ["Shakes", "Strawberry Shake", 190, "Fresh strawberry-flavored shake with creamy texture."],
      ["Shakes", "Oreo Shake", 220, "Cookies and cream shake blended with vanilla ice cream."],
      ["Shakes", "Peanut Butter Shake", 240, "Rich shake with peanut butter, chocolate, and cream."],
      ["Shakes", "Salted Caramel Shake", 230, "Caramel shake with a light salted finish."],
      ["Shakes", "Cold Coffee Shake", 210, "Coffee, milk, ice cream, and chocolate drizzle."],
      ["Desserts", "Chocolate Brownie", 160, "Dense chocolate brownie with fudgy center."],
      ["Desserts", "Brownie Sundae", 240, "Warm brownie with vanilla ice cream and chocolate sauce."],
      ["Desserts", "New York Cheesecake", 260, "Creamy baked cheesecake with biscuit crust."],
      ["Desserts", "Apple Pie", 220, "Warm apple pie with cinnamon and flaky crust."],
      ["Desserts", "Choco Chip Cookie", 120, "Large cookie with melted chocolate chips."],
      ["Drinks", "Iced Tea", 120, "Chilled lemon iced tea with balanced sweetness."],
      ["Drinks", "Fresh Lime Soda", 110, "Sparkling lime drink served sweet or salted."],
      ["Drinks", "Cola", 80, "Chilled classic cola."],
      ["Drinks", "Ginger Ale", 100, "Crisp ginger-flavored sparkling drink."],
      ["Drinks", "Mineral Water", 50, "Sealed bottle of drinking water."]
    ])
  },
  {
    name: "Mandarin Wok Asian Bistro",
    ownerEmail: "owner.asian@avenzo.com",
    cuisine: "asian chinese thai",
    categories: ["Soups", "Dim Sum", "Starters", "Noodles", "Rice", "Wok Mains", "Thai Specials", "Desserts & Drinks"],
    items: withDescriptions("asian chinese thai", [
      ["Soups", "Tom Yum Soup", 180, "Hot and sour Thai soup with lemongrass, lime leaf, chilli, and mushrooms."],
      ["Soups", "Sweet Corn Soup", 150, "Comforting corn soup with vegetables and gentle seasoning."],
      ["Soups", "Manchow Soup", 170, "Spicy Indo-Chinese soup topped with crisp fried noodles."],
      ["Soups", "Hot & Sour Soup", 170, "Peppery soup with vegetables, soy, vinegar, and chilli."],
      ["Soups", "Wonton Soup", 210, "Clear broth with delicate wontons and spring onion."],
      ["Soups", "Thai Coconut Soup", 210, "Coconut milk soup with galangal, lemongrass, and mushrooms."],
      ["Soups", "Noodle Broth Bowl", 230, "Light broth with noodles, vegetables, and herbs."],
      ["Dim Sum", "Veg Dumplings", 210, "Steamed dumplings filled with seasoned vegetables."],
      ["Dim Sum", "Chicken Dumplings", 250, "Steamed chicken dumplings with ginger and spring onion."],
      ["Dim Sum", "Prawn Har Gow", 330, "Translucent dumplings filled with prawns and bamboo shoot."],
      ["Dim Sum", "Pan Fried Gyoza", 260, "Crisp-bottom dumplings served with soy chilli dip."],
      ["Dim Sum", "Crystal Veg Dumplings", 240, "Delicate crystal dumplings with crunchy vegetable filling."],
      ["Dim Sum", "Chicken Bao", 260, "Soft bao buns filled with saucy chicken."],
      ["Dim Sum", "Mushroom Bao", 240, "Steamed bao with mushrooms, soy glaze, and sesame."],
      ["Starters", "Chilli Paneer", 240, "Paneer tossed with peppers, onion, soy, garlic, and chilli."],
      ["Starters", "Dragon Chicken", 310, "Crispy chicken tossed in spicy-sweet sauce with cashews."],
      ["Starters", "Crispy Lotus Stem", 260, "Thin lotus stem slices fried and glazed with honey chilli."],
      ["Starters", "Honey Chilli Potato", 210, "Crispy potato fingers tossed in honey chilli sauce."],
      ["Starters", "Sesame Prawns", 360, "Prawns coated with sesame and fried crisp."],
      ["Starters", "Chicken Lollipop", 290, "Frenched chicken wings served with spicy sauce."],
      ["Starters", "Salt Pepper Tofu", 230, "Crisp tofu with peppers, garlic, and cracked pepper."],
      ["Noodles", "Veg Hakka Noodles", 210, "Wok-tossed noodles with vegetables and soy seasoning."],
      ["Noodles", "Chicken Hakka Noodles", 250, "Noodles tossed with chicken, vegetables, and spring onion."],
      ["Noodles", "Schezwan Noodles", 240, "Spicy noodles tossed with house Schezwan sauce."],
      ["Noodles", "Pad Thai", 300, "Thai rice noodles with tamarind, peanuts, sprouts, and lime."],
      ["Noodles", "Chilli Garlic Noodles", 230, "Noodles tossed with garlic, chilli oil, and vegetables."],
      ["Noodles", "Singapore Noodles", 270, "Curried rice noodles with vegetables and light spice."],
      ["Noodles", "Ramen Style Bowl", 340, "Noodles in savory broth with vegetables and soft egg."],
      ["Rice", "Veg Fried Rice", 200, "Wok-fried rice with vegetables, soy, and spring onion."],
      ["Rice", "Chicken Fried Rice", 240, "Fried rice with chicken, egg, vegetables, and soy."],
      ["Rice", "Schezwan Fried Rice", 230, "Spicy fried rice with Schezwan sauce and vegetables."],
      ["Rice", "Burnt Garlic Rice", 220, "Rice tossed with crisp garlic and spring onion."],
      ["Rice", "Thai Basil Rice", 280, "Jasmine rice tossed with basil, chilli, and vegetables."],
      ["Rice", "Prawn Fried Rice", 330, "Wok-fried rice with prawns, egg, and vegetables."],
      ["Rice", "Kimchi Fried Rice", 300, "Spicy tangy fried rice with kimchi and sesame."],
      ["Wok Mains", "Veg Manchurian Gravy", 240, "Vegetable dumplings in classic Indo-Chinese gravy."],
      ["Wok Mains", "Chicken Manchurian", 290, "Chicken dumplings tossed in garlic-soy gravy."],
      ["Wok Mains", "Kung Pao Chicken", 330, "Chicken with peanuts, peppers, and spicy-sweet sauce."],
      ["Wok Mains", "Black Bean Fish", 380, "Fish cooked with black bean sauce, peppers, and onion."],
      ["Wok Mains", "Mapo Tofu", 290, "Tofu in spicy bean sauce with garlic and spring onion."],
      ["Wok Mains", "Stir Fried Asian Greens", 220, "Seasonal greens tossed with garlic and light soy."],
      ["Wok Mains", "Teriyaki Chicken", 330, "Chicken glazed with sweet soy teriyaki sauce."],
      ["Thai Specials", "Thai Green Curry Veg", 310, "Vegetables simmered in green curry coconut sauce."],
      ["Thai Specials", "Thai Green Curry Chicken", 350, "Chicken in fragrant green curry with coconut milk."],
      ["Thai Specials", "Thai Red Curry Prawns", 420, "Prawns cooked in red curry coconut sauce."],
      ["Thai Specials", "Massaman Curry", 360, "Mild coconut curry with potatoes, peanuts, and warm spices."],
      ["Thai Specials", "Basil Chicken", 330, "Minced chicken stir-fried with basil, chilli, and garlic."],
      ["Desserts & Drinks", "Mango Sticky Rice", 240, "Sweet coconut sticky rice served with mango."],
      ["Desserts & Drinks", "Date Pancake", 220, "Crisp pancake filled with warm dates and nuts."],
      ["Desserts & Drinks", "Jasmine Tea", 120, "Fragrant hot jasmine tea."],
      ["Desserts & Drinks", "Thai Iced Tea", 170, "Chilled Thai tea with milk and gentle sweetness."],
      ["Desserts & Drinks", "Lemongrass Cooler", 160, "Refreshing lemongrass drink with lime."]
    ])
  },
  {
    name: "Cocoa & Crust Cafe",
    ownerEmail: "owner.cafe@avenzo.com",
    cuisine: "cafe bakery",
    categories: ["Coffee", "Breakfast", "Toast & Bagels", "Pasta", "Pizza", "Bakery", "Desserts", "Coolers"],
    items: withDescriptions("cafe bakery", [
      ["Coffee", "Espresso", 100, "A short, intense shot of freshly extracted coffee."],
      ["Coffee", "Americano", 120, "Espresso diluted with hot water for a clean coffee finish."],
      ["Coffee", "Cappuccino", 150, "Espresso topped with steamed milk and velvety foam."],
      ["Coffee", "Cafe Latte", 160, "Smooth espresso with steamed milk and a light foam cap."],
      ["Coffee", "Mocha", 180, "Espresso, chocolate, and steamed milk finished with cocoa."],
      ["Coffee", "Caramel Macchiato", 210, "Vanilla milk, espresso, and caramel drizzle."],
      ["Coffee", "Cold Brew", 190, "Slow-steeped coffee served chilled over ice."],
      ["Breakfast", "Classic English Breakfast", 340, "Eggs, toast, mushrooms, beans, grilled tomato, and hash brown."],
      ["Breakfast", "Masala Omelette", 160, "Egg omelette with onion, tomato, green chilli, and coriander."],
      ["Breakfast", "Avocado Toast", 290, "Sourdough topped with avocado, lime, chilli flakes, and seeds."],
      ["Breakfast", "Pancake Stack", 260, "Fluffy pancakes with maple syrup and butter."],
      ["Breakfast", "French Toast", 250, "Brioche soaked in custard and pan-seared golden."],
      ["Breakfast", "Granola Bowl", 230, "Yogurt with granola, seasonal fruit, nuts, and honey."],
      ["Breakfast", "Scrambled Eggs on Toast", 220, "Creamy scrambled eggs served on buttered toast."],
      ["Toast & Bagels", "Cream Cheese Bagel", 210, "Toasted bagel with generous cream cheese."],
      ["Toast & Bagels", "Smoked Chicken Bagel", 290, "Bagel filled with smoked chicken, lettuce, and mayo."],
      ["Toast & Bagels", "Pesto Tomato Toast", 230, "Sourdough with pesto, tomato, mozzarella, and basil."],
      ["Toast & Bagels", "Mushroom Cheese Toast", 250, "Garlic mushrooms and cheese on toasted sourdough."],
      ["Toast & Bagels", "Peanut Butter Banana Toast", 190, "Toast with peanut butter, banana slices, and honey."],
      ["Toast & Bagels", "Egg Mayo Sandwich", 210, "Creamy egg mayo sandwich with herbs."],
      ["Toast & Bagels", "Paneer Tikka Sandwich", 260, "Grilled sandwich with paneer tikka, peppers, and cheese."],
      ["Pasta", "Penne Arrabbiata", 290, "Penne pasta in spicy tomato garlic sauce."],
      ["Pasta", "Creamy Alfredo Pasta", 320, "Pasta in parmesan cream sauce with herbs."],
      ["Pasta", "Pesto Fusilli", 340, "Fusilli tossed in basil pesto with parmesan."],
      ["Pasta", "Mac and Cheese", 300, "Macaroni baked with creamy cheese sauce."],
      ["Pasta", "Chicken Alfredo", 380, "Creamy pasta with grilled chicken and parmesan."],
      ["Pasta", "Mushroom Stroganoff Pasta", 350, "Pasta with mushrooms in a rich creamy sauce."],
      ["Pasta", "Aglio Olio", 280, "Spaghetti with garlic, chilli flakes, olive oil, and parsley."],
      ["Pizza", "Margherita Pizza", 320, "Classic pizza with tomato sauce, mozzarella, and basil."],
      ["Pizza", "Farmhouse Pizza", 390, "Vegetable pizza with peppers, onion, corn, olives, and cheese."],
      ["Pizza", "Paneer Tikka Pizza", 420, "Pizza topped with paneer tikka, onion, peppers, and mozzarella."],
      ["Pizza", "Chicken Pepperoni Pizza", 480, "Cheesy pizza with chicken pepperoni and oregano."],
      ["Pizza", "BBQ Chicken Pizza", 460, "Pizza with BBQ chicken, onion, and smoky sauce."],
      ["Pizza", "Four Cheese Pizza", 450, "Mozzarella, cheddar, parmesan, and processed cheese blend."],
      ["Pizza", "Mushroom Truffle Pizza", 520, "Mushrooms, cheese, and truffle-style oil on crisp base."],
      ["Bakery", "Butter Croissant", 160, "Flaky laminated croissant baked fresh."],
      ["Bakery", "Almond Croissant", 210, "Croissant filled with almond cream and topped with flakes."],
      ["Bakery", "Blueberry Muffin", 160, "Soft muffin loaded with blueberries."],
      ["Bakery", "Chocolate Danish", 190, "Flaky pastry filled with chocolate."],
      ["Bakery", "Cinnamon Roll", 180, "Soft roll swirled with cinnamon sugar and glaze."],
      ["Bakery", "Garlic Cream Cheese Bun", 210, "Soft bun filled with cream cheese and garlic butter."],
      ["Bakery", "Banana Walnut Bread", 150, "Moist banana bread with toasted walnuts."],
      ["Desserts", "Tiramisu", 280, "Coffee-soaked layers with mascarpone-style cream and cocoa."],
      ["Desserts", "Chocolate Truffle Cake", 260, "Rich chocolate cake layered with ganache."],
      ["Desserts", "Baked Cheesecake", 290, "Creamy cheesecake with biscuit base."],
      ["Desserts", "Apple Crumble", 240, "Warm apple dessert with buttery crumble topping."],
      ["Desserts", "Lemon Tart", 230, "Tangy lemon curd tart with crisp pastry shell."],
      ["Coolers", "Iced Americano", 150, "Espresso over chilled water and ice."],
      ["Coolers", "Iced Latte", 180, "Espresso and chilled milk over ice."],
      ["Coolers", "Peach Iced Tea", 160, "Black tea with peach flavor served cold."],
      ["Coolers", "Watermelon Mint Cooler", 170, "Fresh watermelon cooler with mint and lime."],
      ["Coolers", "Strawberry Lemonade", 180, "Lemonade with strawberry and ice."]
    ])
  }
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

  const ownerEmails = [...new Set(restaurantMenus.map(r => r.ownerEmail))];
  const owners = {};

  for (const email of ownerEmails) {
    owners[email] = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash("Owner@123", 10),
        name: email.split("@")[0].replace("owner.", "").replace(".", " ") + " Owner",
        role: "RESTAURANT_OWNER"
      }
    });
  }

  for (const restaurantData of restaurantMenus) {
    const owner = owners[restaurantData.ownerEmail] || admin;
    const restaurant = await prisma.restaurant.create({
      data: {
        name: restaurantData.name,
        slug: slugify(restaurantData.name),
        ownerId: owner.id
      }
    });

    const categoryRecords = {};
    for (const [index, name] of restaurantData.categories.entries()) {
      categoryRecords[name] = await prisma.category.create({
        data: {
          name,
          restaurantId: restaurant.id,
          sortOrder: index + 1
        }
      });
    }

    await prisma.menu.createMany({
      data: restaurantData.items.map(menuItem => ({
        name: menuItem.name,
        price: menuItem.price,
        description: menuItem.description,
        imageUrl: menuItem.imageUrl,
        restaurantId: restaurant.id,
        categoryId: categoryRecords[menuItem.category].id,
        isAvailable: true,
        isActive: true
      }))
    });

    console.log(`Seeded ${restaurantData.name} with ${restaurantData.items.length} menu items.`);
  }

  console.log("Seed completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
