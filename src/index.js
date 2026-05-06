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

/* ================================
   HELPER: ADMIN AUTH
================================ */
// function checkAdmin(req, res) {
//   if (req.headers["x-admin-key"] !== ADMIN_KEY) {
//     res.status(403).json({ error: "Unauthorized" });
//     return false;
//   }
//   return true;
// }

/* ================================
   HEALTH CHECK
================================ */
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
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
    const menu = await prisma.menu.findMany({
        where: {
            restaurantId: req.params.restaurantId,
            isActive: true
        },
        orderBy: [
            { isAvailable: "desc" }, // available first
            { category: "asc" }
        ]
    });

    res.json(menu);
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
                    create: items.map(i => {
                        const menu = menuItems.find(m => m.id === i.menuId);

                        return {
                            menuId: menu.id,
                            quantity: i.quantity,
                            priceAtOrder: menu.price,
                            nameAtOrder: menu.name
                        };
                    })
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
            include: { items: true }
        });

        if (!order) return res.status(404).json({ error: "Not found" });

        res.json(order);
    } catch {
        res.status(500).json({ error: "Error fetching order" });
    }
});

/* ================================
   RESTAURANTS LIST
================================ */
app.get("/restaurants", async (req, res) => {
    const restaurants = await prisma.restaurant.findMany();
    res.json(restaurants);
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
        if (!email || !password) {
            return res.status(400).json({ error: "Email & password required" });
        }

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
    const authHeader = req.headers.authorization;

    if (!authHeader) return res.status(401).json({ error: "No token" });

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

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

async function isOwner(prisma, restaurantId, userId) {
    const r = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { ownerId: true }
    });

    return !!r && r.ownerId === userId;
}

app.post("/restaurant", authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Name required" });
    }

    const slug = name.toLowerCase().replace(/\s+/g, "-");

    const restaurant = await prisma.restaurant.create({
        data: {
            name,
            slug,
            ownerId: req.user.userId
        }
    });

    res.json(restaurant);
});

app.put("/restaurant/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Name required" });
    }
    const allowed = await isOwner(prisma, id, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const updated = await prisma.restaurant.update({
        where: { id },
        data: { name }
    });

    res.json(updated);
});

app.delete("/restaurant/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;

    const allowed = await isOwner(prisma, id, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    await prisma.orderItem.deleteMany({
        where: { order: { restaurantId: id } }
    });

    await prisma.order.deleteMany({
        where: { restaurantId: id }
    });

    await prisma.menu.deleteMany({
        where: { restaurantId: id }
    });

    await prisma.restaurant.delete({
        where: { id }
    });

    res.json({ message: "Deleted" });
});

app.post("/menu", authMiddleware, async (req, res) => {
    const { name, price, category, restaurantId } = req.body;
    if (!name || !price || !category || !restaurantId) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const allowed = await isOwner(prisma, restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const item = await prisma.menu.create({
        data: { name, price: Number(price), category, restaurantId }
    });

    res.json(item);
});

app.put("/menu/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { name, price, category, isAvailable, isActive, description, imageUrl } = req.body;

    const item = await prisma.menu.findUnique({
        where: { id },
        select: { restaurantId: true }
    });

    if (!item) return res.status(404).json({ error: "Not found" });

    const allowed = await isOwner(prisma, item.restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const updated = await prisma.menu.update({
        where: { id },
        data: {
            ...(name && { name }),
            ...(price && { price: Number(price) }),
            ...(category && { category }),
            ...(typeof isAvailable !== "undefined" && { isAvailable }),
            ...(typeof isActive !== "undefined" && { isActive }),
            ...(description && { description }),
            ...(imageUrl && { imageUrl })
        }
    });

    res.json(updated);
});

app.patch("/order/:id/status", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED"];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
    }

    const order = await prisma.order.findUnique({
        where: { id },
        select: { restaurantId: true }
    });

    if (!order) return res.status(404).json({ error: "Not found" });

    const allowed = await isOwner(prisma, order.restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const updated = await prisma.order.update({
        where: { id },
        data: { status }
    });

    res.json(updated);
});

app.get("/admin/menu/:restaurantId", authMiddleware, async (req, res) => {
    const { restaurantId } = req.params;

    const allowed = await isOwner(prisma, restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const menu = await prisma.menu.findMany({
        where: { restaurantId },
        orderBy: { createdAt: "desc" }
    });

    res.json(menu);
});

/* ================================
   START SERVER
================================ */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});