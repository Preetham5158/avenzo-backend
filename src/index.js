require("dotenv").config();

const express = require("express");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(express.static("public"));

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ADMIN_KEY = process.env.ADMIN_KEY || "12345";

/* ================================
   HELPER: ADMIN AUTH
================================ */
function checkAdmin(req, res) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    res.status(403).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/* ================================
   HEALTH CHECK
================================ */
app.get("/", (req, res) => {
  res.send("Avenzo API running 🚀");
});

/* ================================
   GET RESTAURANT
================================ */
app.get("/restaurant/:id", async (req, res) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.params.id },
    });

    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    res.json(restaurant);
  } catch (err) {
    res.status(500).json({ error: "Error fetching restaurant" });
  }
});

/* ================================
   GET MENU
================================ */
app.get("/menu/:restaurantId", async (req, res) => {
  try {
    const menu = await prisma.menu.findMany({
      where: {
        restaurantId: req.params.restaurantId,
        isAvailable: true,
      },
      orderBy: [
        { category: "asc" },
        { name: "asc" }
      ],
    });

    res.json(menu);
  } catch (err) {
    res.status(500).json({ error: "Error fetching menu" });
  }
});

/* ================================
   CREATE ORDER (OPTIMIZED)
================================ */
app.post("/order", async (req, res) => {
  try {
    const { items, restaurantId, sessionId, phone } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Items required" });
    }

    if (!restaurantId || !sessionId) {
      return res.status(400).json({ error: "Missing data" });
    }

    const pickupCode = Math.floor(1000 + Math.random() * 9000).toString();

    const menuItems = await prisma.menu.findMany({
      where: {
        id: { in: items.map(i => i.menuId) }
      }
    });

    let totalPrice = 0;

    items.forEach(i => {
      const menu = menuItems.find(m => m.id === i.menuId);

      if (!menu) {
        throw new Error("Invalid item");
      }

      if (!menu.isAvailable) {
        throw new Error(`${menu.name} is unavailable`);
      }

      totalPrice += menu.price * i.quantity;
    });

    const order = await prisma.order.create({
      data: {
        totalPrice,
        pickupCode,
        sessionId,
        phone: phone || null,
        restaurantId,
        items: {
          create: items.map(i => ({
            menuId: i.menuId,
            quantity: i.quantity
          }))
        }
      }
    });

    res.json({
      orderId: order.id,
      pickupCode,
      trackingUrl: `${BASE_URL}/track/${order.id}`
    });

  } catch (err) {
    res.status(500).json({ error: err.message || "Order failed" });
  }
});

/* ================================
   GET ORDER
================================ */
app.get("/order/:id", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { menu: true } } }
    });

    if (!order) return res.status(404).json({ error: "Not found" });

    res.json(order);
  } catch {
    res.status(500).json({ error: "Error fetching order" });
  }
});

/* ================================
   UPDATE STATUS
================================ */
app.patch("/order/:id/status", async (req, res) => {
  try {
    if (!req.body.status) {
      return res.status(400).json({ error: "Status required" });
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: req.body.status }
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Error updating status" });
  }
});

/* ================================
   RESTAURANTS LIST
================================ */
app.get("/restaurants", async (req, res) => {
  const restaurants = await prisma.restaurant.findMany({
    orderBy: { name: "asc" }
  });

  res.json(restaurants);
});

/* ================================
   ADMIN ROUTES
================================ */

app.get("/admin/menu/:restaurantId", async (req, res) => {
  const menu = await prisma.menu.findMany({
    where: { restaurantId: req.params.restaurantId }
  });

  res.json(menu);
});

app.post("/admin/menu", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  const { name, price, category, restaurantId } = req.body;

  if (!name || !price || !category || !restaurantId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const item = await prisma.menu.create({
    data: {
      name,
      price: Number(price),
      category,
      restaurantId,
      isAvailable: true
    }
  });

  res.json(item);
});

app.put("/admin/menu/:id", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  const { name, price, category } = req.body;

  if (!name || !price || !category) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const updated = await prisma.menu.update({
    where: { id: req.params.id },
    data: {
      name,
      price: Number(price),
      category
    }
  });

  res.json(updated);
});

app.patch("/admin/menu/:id/toggle", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  const item = await prisma.menu.findUnique({
    where: { id: req.params.id }
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  const updated = await prisma.menu.update({
    where: { id: req.params.id },
    data: { isAvailable: !item.isAvailable }
  });

  res.json(updated);
});

app.delete("/admin/menu/:id", async (req, res) => {
  if (!checkAdmin(req, res)) return;

  const id = req.params.id;

  await prisma.orderItem.deleteMany({
    where: { menuId: id }
  });

  await prisma.menu.delete({
    where: { id }
  });

  res.json({ success: true });
});

app.get("/track/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/track.html"));
});

app.post("/auth/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashed, name }
    });

    res.json({ message: "User created", userId: user.id });

  } catch (err) {
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token });

  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

function authMiddleware(req, res, next) {
  const token = req.headers.authorization;

  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/auth/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, email: true, name: true }
  });

  res.json(user);
});

/* ================================
   START SERVER
================================ */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});