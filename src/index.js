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
        include: { category: true }, // 🔥 important
        orderBy: [
            { isAvailable: "desc" },
            { category: { name: "asc" } }
        ]
    });

    res.json(menu);
});

/* ================================
   GET CATEGORIES
================================ */
app.get("/categories/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const allowed = await canAccessRestaurant(req.params.restaurantId, req.user.userId);
        if (!allowed) return res.status(403).json({ error: "Not allowed" });

        const categories = await prisma.category.findMany({
            where: { restaurantId: req.params.restaurantId },
            orderBy: [
                { sortOrder: "asc" },
                { name: "asc" }
            ]
        });

        res.json(categories);
    } catch {
        res.status(500).json({ error: "Error fetching categories" });
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
                id: { in: items.map(i => i.menuId) },
                restaurantId,
                isActive: true
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

        const order = await prisma.$transaction(async (tx) => {
            const counter = await tx.restaurant.update({
                where: { id: restaurantId },
                data: { orderCounter: { increment: 1 } },
                select: { orderCounter: true }
            });

            return tx.order.create({
                data: {
                    orderNumber: counter.orderCounter - 1,
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
        });

        res.json({
            orderId: order.id,
            orderNumber: order.orderNumber,
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
            { userId: user.id, role: user.role },
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
        select: { id: true, email: true, name: true, role: true }
    });

    res.json(user);
});

async function getAuthUser(userId) {
    return prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true }
    });
}

function isSuperAdmin(user) {
    return user?.role === "ADMIN" || user?.email === "admin@avenzo.com";
}

async function canAccessRestaurant(restaurantId, userId) {
    const user = await getAuthUser(userId);
    if (!user) return false;
    if (isSuperAdmin(user)) return true;

    const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { ownerId: true }
    });

    return !!restaurant && restaurant.ownerId === userId;
}

/* ================================
   RESTAURANTS LIST
================================ */
app.get("/restaurants", authMiddleware, async (req, res) => {
    const user = await getAuthUser(req.user.userId);
    if (!user) return res.status(401).json({ error: "Invalid user" });

    const restaurants = await prisma.restaurant.findMany({
        where: isSuperAdmin(user) ? {} : { ownerId: user.id },
        orderBy: { createdAt: "desc" }
    });

    res.json({
        user,
        restaurants,
        canCreateRestaurant: isSuperAdmin(user)
    });
});

app.post("/restaurant", authMiddleware, async (req, res) => {
    const { name, address, locality, pickupNote } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Name required" });
    }

    const user = await getAuthUser(req.user.userId);
    if (!isSuperAdmin(user)) {
        return res.status(403).json({ error: "Only super admins can create restaurants" });
    }

    const slug = name.toLowerCase().replace(/\s+/g, "-");

    const restaurant = await prisma.restaurant.create({
        data: {
            name,
            slug,
            address: address || null,
            locality: locality || null,
            pickupNote: pickupNote || null,
            ownerId: req.user.userId
        }
    });

    res.json(restaurant);
});

app.put("/restaurant/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { name, address, locality, pickupNote } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Name required" });
    }
    const allowed = await canAccessRestaurant(id, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const updated = await prisma.restaurant.update({
        where: { id },
        data: {
            name,
            ...(typeof address !== "undefined" && { address: address || null }),
            ...(typeof locality !== "undefined" && { locality: locality || null }),
            ...(typeof pickupNote !== "undefined" && { pickupNote: pickupNote || null })
        }
    });

    res.json(updated);
});

app.delete("/restaurant/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;

    const user = await getAuthUser(req.user.userId);
    if (!isSuperAdmin(user)) {
        return res.status(403).json({ error: "Only super admins can delete restaurants" });
    }

    await prisma.orderItem.deleteMany({
        where: { order: { restaurantId: id } }
    });

    await prisma.order.deleteMany({
        where: { restaurantId: id }
    });

    await prisma.menu.deleteMany({
        where: { restaurantId: id }
    });

    await prisma.category.deleteMany({
        where: { restaurantId: id }
    });

    await prisma.restaurant.delete({
        where: { id }
    });

    res.json({ message: "Deleted" });
});

app.post("/category", authMiddleware, async (req, res) => {
    const { name, restaurantId, sortOrder } = req.body;

    if (!name || !restaurantId) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const allowed = await canAccessRestaurant(restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const category = await prisma.category.upsert({
        where: {
            restaurantId_name: {
                restaurantId,
                name: name.trim()
            }
        },
        update: {
            ...(typeof sortOrder !== "undefined" && { sortOrder: Number(sortOrder) })
        },
        create: {
            name: name.trim(),
            restaurantId,
            ...(typeof sortOrder !== "undefined" && { sortOrder: Number(sortOrder) })
        }
    });

    res.json(category);
});

app.post("/menu", authMiddleware, async (req, res) => {
    const { name, price, categoryId, restaurantId, description, imageUrl } = req.body;
    if (!name || !price || !categoryId || !restaurantId) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const allowed = await canAccessRestaurant(restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const category = await prisma.category.findFirst({
        where: { id: categoryId, restaurantId },
        select: { id: true }
    });

    if (!category) {
        return res.status(400).json({ error: "Invalid category" });
    }

    const item = await prisma.menu.create({
        data: {
            name,
            price: Number(price),
            categoryId,
            restaurantId,
            description: description || null,
            imageUrl: imageUrl || null
        },
        include: { category: true }
    });

    res.json(item);
});

app.put("/menu/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { name, price, categoryId, isAvailable, isActive, description, imageUrl } = req.body;

    const item = await prisma.menu.findUnique({
        where: { id },
        select: { restaurantId: true }
    });

    if (!item) return res.status(404).json({ error: "Not found" });

    const allowed = await canAccessRestaurant(item.restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    if (categoryId) {
        const category = await prisma.category.findFirst({
            where: { id: categoryId, restaurantId: item.restaurantId },
            select: { id: true }
        });

        if (!category) {
            return res.status(400).json({ error: "Invalid category" });
        }
    }

    const updated = await prisma.menu.update({
        where: { id },
        data: {
            ...(name && { name }),
            ...(price && { price: Number(price) }),
            ...(categoryId && { categoryId }),
            ...(typeof isAvailable !== "undefined" && { isAvailable }),
            ...(typeof isActive !== "undefined" && { isActive }),
            ...(typeof description !== "undefined" && { description: description || null }),
            ...(typeof imageUrl !== "undefined" && { imageUrl: imageUrl || null })
        },
        include: { category: true }
    });

    res.json(updated);
});

app.patch("/order/:id/status", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
    }

    const order = await prisma.order.findUnique({
        where: { id },
        select: { restaurantId: true, readyAt: true }
    });

    if (!order) return res.status(404).json({ error: "Not found" });

    const allowed = await canAccessRestaurant(order.restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const data = { status };
    if (status === "READY" && !order.readyAt) {
        data.readyAt = new Date();
    }

    const updated = await prisma.order.update({
        where: { id },
        data
    });

    res.json(updated);
});

app.get("/admin/menu/:restaurantId", authMiddleware, async (req, res) => {
    const { restaurantId } = req.params;

    const allowed = await canAccessRestaurant(restaurantId, req.user.userId);
    if (!allowed) return res.status(403).json({ error: "Not allowed" });

    const menu = await prisma.menu.findMany({
        where: { restaurantId },
        include: { category: true },
        orderBy: [
            { category: { sortOrder: "asc" } },
            { createdAt: "desc" }
        ]
    });

    res.json(menu);
});

app.get("/admin/orders/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const allowed = await canAccessRestaurant(restaurantId, req.user.userId);
        if (!allowed) return res.status(403).json({ error: "Not allowed" });

        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: { id: true, name: true, address: true, locality: true, pickupNote: true }
        });

        if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });

        const orders = await prisma.order.findMany({
            where: { restaurantId },
            include: { items: true },
            orderBy: { createdAt: "desc" }
        });

        res.json({ restaurant, orders });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

/* ================================
   START SERVER
================================ */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
