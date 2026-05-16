"use strict";
/**
 * Auth service — JWT signing, password verification, role checks, restaurant access.
 * Single source of truth so v1 and legacy routes never drift apart.
 */

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { createPrismaClient } = require("../prisma");
const { JWT_ISSUER, JWT_AUDIENCE } = require("../lib/constants");

const prisma = createPrismaClient();

function signAuthToken(user) {
    return jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d",
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        }
    );
}

function authUserResponse(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role
    };
}

function loginSuccessResponse(user) {
    return {
        token: signAuthToken(user),
        user: authUserResponse(user)
    };
}

async function findPasswordUser(email, password) {
    if (!email || !password) return null;
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    return valid ? user : null;
}

async function getAuthUser(userId) {
    return prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, phone: true, role: true, staffRestaurantId: true }
    });
}

function isSuperAdmin(user) { return user?.role === "ADMIN"; }
function isOwner(user) { return user?.role === "RESTAURANT_OWNER"; }
function isEmployee(user) { return user?.role === "EMPLOYEE"; }

function isSubscriptionExpired(restaurant) {
    return !!restaurant?.subscriptionEndsAt && new Date(restaurant.subscriptionEndsAt) < new Date();
}

function isRestaurantServiceAvailable(restaurant) {
    return (
        !!restaurant?.isActive &&
        !["EXPIRED", "SUSPENDED"].includes(restaurant.subscriptionStatus) &&
        !isSubscriptionExpired(restaurant)
    );
}

function restaurantServiceMessage(restaurant) {
    if (!restaurant?.isActive) {
        return "This restaurant is taking a short pause on Avenzo. Please check back soon for faster ordering and smoother dine-in service.";
    }
    if (["EXPIRED", "SUSPENDED"].includes(restaurant.subscriptionStatus) || isSubscriptionExpired(restaurant)) {
        return "Ordering is paused for this restaurant right now. Avenzo helps busy restaurants serve guests faster, and service can resume as soon as the restaurant is active again.";
    }
    return "";
}

function publicRestaurantResponse(restaurant) {
    if (!restaurant) return null;
    return {
        name: restaurant.name,
        slug: restaurant.slug,
        address: restaurant.address,
        locality: restaurant.locality,
        pickupNote: restaurant.pickupNote,
        foodType: restaurant.foodType,
        isActive: restaurant.isActive,
        serviceAvailable: isRestaurantServiceAvailable(restaurant),
        serviceMessage: restaurantServiceMessage(restaurant)
    };
}

function customerRestaurantResponse(restaurant) {
    if (!restaurant) return null;
    return {
        name: restaurant.name,
        slug: restaurant.slug,
        address: restaurant.address,
        locality: restaurant.locality,
        foodType: restaurant.foodType,
        serviceAvailable: isRestaurantServiceAvailable(restaurant),
        serviceMessage: restaurantServiceMessage(restaurant),
        previewImages: (restaurant.menus || []).map(m => m.imageUrl).filter(Boolean).slice(0, 4)
    };
}

function getUserPermissions(user) {
    if (!user) {
        return {
            canCreateRestaurant: false,
            canEditRestaurants: false,
            canManageMenuDetails: false,
            canToggleStock: false,
            canUpdateOrders: false
        };
    }
    const superAdmin = isSuperAdmin(user);
    const owner = isOwner(user);
    const employee = isEmployee(user);
    return {
        canCreateRestaurant: superAdmin,
        canEditRestaurants: superAdmin,
        canManageMenuDetails: superAdmin || owner,
        canToggleStock: superAdmin || owner || employee,
        canUpdateOrders: superAdmin || owner || employee
    };
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
    // Super admins can inspect and repair paused or expired restaurants; operators are blocked.
    if (access.isSuperAdmin) return true;
    if (isRestaurantServiceAvailable(access.restaurant)) return true;
    res.status(423).json({ error: restaurantServiceMessage(access.restaurant) });
    return false;
}

async function auditLog(action, data = {}) {
    try {
        await prisma.auditLog.create({
            data: {
                action,
                actorUserId: data.actorUserId || null,
                restaurantId: data.restaurantId || null,
                orderId: data.orderId || null,
                targetUserId: data.targetUserId || null,
                metadata: data.metadata || undefined
            }
        });
    } catch (err) {
        console.error(`[audit:failed] ${err?.message || err}`);
    }
}

module.exports = {
    signAuthToken,
    authUserResponse,
    loginSuccessResponse,
    findPasswordUser,
    getAuthUser,
    isSuperAdmin,
    isOwner,
    isEmployee,
    isSubscriptionExpired,
    isRestaurantServiceAvailable,
    restaurantServiceMessage,
    publicRestaurantResponse,
    customerRestaurantResponse,
    getUserPermissions,
    getRestaurantAccess,
    ensureWorkspaceService,
    auditLog,
};
