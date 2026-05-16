"use strict";
/**
 * Tiny shared helpers used by multiple route modules.
 * Pure functions only — no I/O, no shared state.
 */

const {
    FOOD_TYPES,
    RESTAURANT_FOOD_TYPES,
    SUBSCRIPTION_STATUSES,
    ORDER_STATUS_TRANSITIONS,
} = require("./constants");

function normalizeSlug(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeFoodType(value, fallback = "VEG") {
    const normalized = String(value || fallback).toUpperCase();
    return FOOD_TYPES.includes(normalized) ? normalized : fallback;
}

function normalizeRestaurantFoodType(value, fallback = "BOTH") {
    const normalized = String(value || fallback).toUpperCase();
    return RESTAURANT_FOOD_TYPES.includes(normalized) ? normalized : fallback;
}

function normalizeSubscriptionStatus(value, fallback = "ACTIVE") {
    const normalized = String(value || fallback).toUpperCase();
    return SUBSCRIPTION_STATUSES.includes(normalized) ? normalized : fallback;
}

function cleanString(value, maxLength = 500) {
    if (typeof value === "undefined" || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned ? cleaned.slice(0, maxLength) : null;
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isValidHttpsUrl(value) {
    try {
        const url = new URL(String(value || ""));
        return url.protocol === "https:";
    } catch {
        return false;
    }
}

function menuFoodFilter(value) {
    if (!value || String(value).toUpperCase() === "ALL") return {};
    const foodType = String(value).toUpperCase();
    return FOOD_TYPES.includes(foodType) ? { foodType } : {};
}

function allowedNextOrderStatuses(status) {
    return ORDER_STATUS_TRANSITIONS[status] || [];
}

function restaurantFoodTypeAllowsItem(restaurantFoodType, itemFoodType) {
    if (restaurantFoodType === "PURE_VEG") return itemFoodType === "VEG";
    if (restaurantFoodType === "NON_VEG") return itemFoodType === "NON_VEG";
    return true;
}

function incompatibleFoodTypeMessage(restaurantFoodType) {
    if (restaurantFoodType === "PURE_VEG") return "Pure veg restaurants can only add veg items";
    if (restaurantFoodType === "NON_VEG") return "Non-veg restaurants can only add non-veg items";
    return "This item food type is not allowed for the restaurant";
}

function logRouteError(route, err) {
    const message = err?.message || String(err);
    const code = err?.code ? ` code=${err.code}` : "";
    console.error(`[${route}]${code} ${message}`);
}

module.exports = {
    normalizeSlug,
    normalizeFoodType,
    normalizeRestaurantFoodType,
    normalizeSubscriptionStatus,
    cleanString,
    isValidEmail,
    isValidHttpsUrl,
    menuFoodFilter,
    allowedNextOrderStatuses,
    restaurantFoodTypeAllowsItem,
    incompatibleFoodTypeMessage,
    logRouteError,
};
