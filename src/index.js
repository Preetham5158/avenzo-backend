require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const prisma = new PrismaClient();

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
}

app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
});
app.use(express.json({ limit: "100kb" }));
app.use(express.static("public"));

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

function rateLimit({ windowMs, max }) {
    const hits = new Map();
    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

        if (entry.resetAt < now) {
            entry.count = 0;
            entry.resetAt = now + windowMs;
        }

        entry.count += 1;
        hits.set(key, entry);

        if (entry.count > max) {
            return res.status(429).json({ error: "Please wait a moment and try again" });
        }

        next();
    };
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

function normalizeSlug(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

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

app.get("/r/:slug", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/menu.html"));
});

/* ================================
   GET RESTAURANT
================================ */
app.get("/restaurant/slug/:slug", async (req, res) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { slug: req.params.slug },
        });

        if (!restaurant) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

        res.json({
            ...restaurant,
            serviceAvailable: isRestaurantServiceAvailable(restaurant),
            serviceMessage: restaurantServiceMessage(restaurant)
        });
    } catch {
        res.status(500).json({ error: "Error fetching restaurant" });
    }
});

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
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.restaurantId } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    if (!isRestaurantServiceAvailable(restaurant)) {
        return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
    }

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

app.get("/menu/by-slug/:slug", async (req, res) => {
    const restaurant = await prisma.restaurant.findUnique({
        where: { slug: req.params.slug },
    });

    if (!restaurant) {
        return res.status(404).json({ error: "Restaurant not found" });
    }

    if (!isRestaurantServiceAvailable(restaurant)) {
        return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
    }

    const menu = await prisma.menu.findMany({
        where: { restaurantId: restaurant.id, isActive: true },
        include: { category: true },
        orderBy: [
            { isAvailable: "desc" },
            { category: { sortOrder: "asc" } },
            { name: "asc" }
        ]
    });

    res.json(menu);
});

/* ================================
   GET CATEGORIES
================================ */
app.get("/categories/:restaurantId", authMiddleware, async (req, res) => {
    try {
        const access = await getRestaurantAccess(req.params.restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

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
app.post("/order", orderLimiter, async (req, res) => {
    try {
        const { items, restaurantId, sessionId, phone } = req.body;

        if (!Array.isArray(items) || items.length === 0 || items.length > 40) {
            return res.status(400).json({ error: "Items required" });
        }

        if (!restaurantId || !sessionId) {
            return res.status(400).json({ error: "Missing data" });
        }

        const normalizedItems = items.map(i => ({
            menuId: String(i.menuId || ""),
            quantity: Number(i.quantity)
        }));

        if (normalizedItems.some(i => !i.menuId || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 20)) {
            return res.status(400).json({ error: "Please check item quantities" });
        }

        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: { id: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
        });

        if (!restaurant) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

        if (!isRestaurantServiceAvailable(restaurant)) {
            return res.status(423).json({ error: restaurantServiceMessage(restaurant) });
        }

        const pickupCode = crypto.randomInt(1000, 10000).toString();

        const menuItems = await prisma.menu.findMany({
            where: {
                id: { in: normalizedItems.map(i => i.menuId) },
                restaurantId,
                isActive: true
            }
        });

        let totalPrice = 0;

        normalizedItems.forEach(i => {
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
                        create: normalizedItems.map(i => {
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

app.post("/auth/signup", authLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: "Use a valid email and at least 8 characters for password" });
        }

        const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
        if (existing) {
            return res.status(400).json({ error: "User already exists" });
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: { email: String(email).toLowerCase().trim(), password: hashed, name }
        });

        res.json({ message: "User created", userId: user.id });

    } catch (err) {
        res.status(500).json({ error: "Signup failed" });
    }
});

app.post("/auth/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email & password required" });
        }

        const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
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

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });

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
        select: { id: true, email: true, role: true, staffRestaurantId: true }
    });
}

function isSuperAdmin(user) {
    return user?.role === "ADMIN" || user?.email === "admin@avenzo.com";
}

function isOwner(user) {
    return user?.role === "RESTAURANT_OWNER";
}

function isEmployee(user) {
    return user?.role === "EMPLOYEE";
}

function isRestaurantServiceAvailable(restaurant) {
    return !!restaurant?.isActive && !["EXPIRED", "SUSPENDED"].includes(restaurant.subscriptionStatus);
}

function restaurantServiceMessage(restaurant) {
    if (!restaurant?.isActive) {
        return "This restaurant is taking a short pause on Avenzo. Please check back soon for faster ordering and smoother pickup.";
    }

    if (["EXPIRED", "SUSPENDED"].includes(restaurant.subscriptionStatus)) {
        return "Ordering is paused for this restaurant right now. Avenzo helps busy counters serve guests faster, and service can resume as soon as the workspace is active again.";
    }

    return "";
}

async function canAccessRestaurant(restaurantId, userId) {
    const user = await getAuthUser(userId);
    if (!user) return false;
    if (isSuperAdmin(user)) return true;

    const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { ownerId: true }
    });

    return !!restaurant && (restaurant.ownerId === userId || user.staffRestaurantId === restaurantId);
}

async function getRestaurantAccess(restaurantId, userId) {
    const user = await getAuthUser(userId);
    if (!user) return { user: null, restaurant: null, canAccess: false, canManage: false, canOperate: false };

    const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: {
            id: true,
            ownerId: true,
            isActive: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true
        }
    });

    const superAdmin = isSuperAdmin(user);
    const owner = restaurant?.ownerId === user.id && isOwner(user);
    const employee = user.staffRestaurantId === restaurantId && isEmployee(user);

    return {
        user,
        restaurant,
        canAccess: !!restaurant && (superAdmin || owner || employee),
        canManage: !!restaurant && (superAdmin || owner),
        canOperate: !!restaurant && (superAdmin || owner || employee),
        isSuperAdmin: superAdmin,
        isOwner: owner,
        isEmployee: employee
    };
}

function ensureWorkspaceService(access, res) {
    if (access.isSuperAdmin) return true;
    if (isRestaurantServiceAvailable(access.restaurant)) return true;
    res.status(423).json({ error: restaurantServiceMessage(access.restaurant) });
    return false;
}

/* ================================
   RESTAURANTS LIST
================================ */
app.get("/restaurants", authMiddleware, async (req, res) => {
    const user = await getAuthUser(req.user.userId);
    if (!user) return res.status(401).json({ error: "Invalid user" });

    const restaurants = await prisma.restaurant.findMany({
        where: isSuperAdmin(user)
            ? {}
            : isOwner(user)
                ? { ownerId: user.id }
                : { id: user.staffRestaurantId || "__none__" },
        include: {
            owner: { select: { id: true, email: true, name: true } }
        },
        orderBy: { createdAt: "desc" }
    });

    res.json({
        user,
        restaurants,
        canCreateRestaurant: isSuperAdmin(user),
        canEditRestaurants: isSuperAdmin(user)
    });
});

app.post("/restaurant", authMiddleware, async (req, res) => {
    const { name, address, locality, pickupNote, ownerEmail, subscriptionStatus, subscriptionEndsAt, isActive } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Name required" });
    }

    const user = await getAuthUser(req.user.userId);
    if (!isSuperAdmin(user)) {
        return res.status(403).json({ error: "Only super admins can create restaurants" });
    }

    const slug = normalizeSlug(name);
    const owner = ownerEmail
        ? await prisma.user.upsert({
            where: { email: String(ownerEmail).toLowerCase().trim() },
            update: { role: "RESTAURANT_OWNER" },
            create: {
                email: String(ownerEmail).toLowerCase().trim(),
                password: await bcrypt.hash("Owner@123", 10),
                name: name + " Owner",
                role: "RESTAURANT_OWNER"
            }
        })
        : user;

    const restaurant = await prisma.restaurant.create({
        data: {
            name,
            slug,
            address: address || null,
            locality: locality || null,
            pickupNote: pickupNote || null,
            ownerId: owner.id,
            isActive: typeof isActive === "boolean" ? isActive : true,
            subscriptionStatus: subscriptionStatus || "ACTIVE",
            subscriptionEndsAt: subscriptionEndsAt ? new Date(subscriptionEndsAt) : null
        }
    });

    res.json(restaurant);
});

app.put("/restaurant/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { name, address, locality, pickupNote, ownerEmail, isActive, subscriptionStatus, subscriptionEndsAt } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Name required" });
    }
    const user = await getAuthUser(req.user.userId);
    if (!isSuperAdmin(user)) {
        return res.status(403).json({ error: "Only the Avenzo admin team can edit restaurant details" });
    }

    let ownerId;
    if (ownerEmail) {
        const owner = await prisma.user.upsert({
            where: { email: String(ownerEmail).toLowerCase().trim() },
            update: { role: "RESTAURANT_OWNER" },
            create: {
                email: String(ownerEmail).toLowerCase().trim(),
                password: await bcrypt.hash("Owner@123", 10),
                name: name + " Owner",
                role: "RESTAURANT_OWNER"
            }
        });
        ownerId = owner.id;
    }

    const updated = await prisma.restaurant.update({
        where: { id },
        data: {
            name,
            ...(ownerId && { ownerId }),
            ...(typeof address !== "undefined" && { address: address || null }),
            ...(typeof locality !== "undefined" && { locality: locality || null }),
            ...(typeof pickupNote !== "undefined" && { pickupNote: pickupNote || null }),
            ...(typeof isActive === "boolean" && { isActive }),
            ...(subscriptionStatus && { subscriptionStatus }),
            ...(typeof subscriptionEndsAt !== "undefined" && { subscriptionEndsAt: subscriptionEndsAt ? new Date(subscriptionEndsAt) : null })
        }
    });

    res.json(updated);
});

app.delete("/restaurant/:id", authMiddleware, async (req, res) => {
    res.status(405).json({ error: "Restaurants are deactivated instead of deleted" });
});

app.post("/category", authMiddleware, async (req, res) => {
    const { name, restaurantId, sortOrder } = req.body;

    if (!name || !restaurantId) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const access = await getRestaurantAccess(restaurantId, req.user.userId);
    if (!access.canManage) return res.status(403).json({ error: "Only owners can manage menu categories" });
    if (!ensureWorkspaceService(access, res)) return;

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

    const access = await getRestaurantAccess(restaurantId, req.user.userId);
    if (!access.canManage) return res.status(403).json({ error: "Only owners can add menu items" });
    if (!ensureWorkspaceService(access, res)) return;

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

    const access = await getRestaurantAccess(item.restaurantId, req.user.userId);
    if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });
    if (!ensureWorkspaceService(access, res)) return;

    const requestedKeys = Object.keys(req.body);
    if (access.isEmployee) {
        const onlyStock = requestedKeys.length === 1 && typeof isAvailable === "boolean";
        if (!onlyStock) {
            return res.status(403).json({ error: "Team members can only update stock availability" });
        }
    } else if (!access.canManage) {
        return res.status(403).json({ error: "Only owners can edit menu details" });
    }

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
            ...(!access.isEmployee && typeof isActive !== "undefined" && { isActive }),
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

    const access = await getRestaurantAccess(order.restaurantId, req.user.userId);
    if (!access.canOperate) return res.status(403).json({ error: "Not allowed" });
    if (!ensureWorkspaceService(access, res)) return;

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

    const access = await getRestaurantAccess(restaurantId, req.user.userId);
    if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
    if (!ensureWorkspaceService(access, res)) return;

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

        const access = await getRestaurantAccess(restaurantId, req.user.userId);
        if (!access.canAccess) return res.status(403).json({ error: "Not allowed" });
        if (!ensureWorkspaceService(access, res)) return;

        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: { id: true, name: true, address: true, locality: true, pickupNote: true, isActive: true, subscriptionStatus: true, subscriptionEndsAt: true }
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
