"use strict";
/**
 * Shared constants used by multiple route modules.
 * Centralised so enums and JWT settings stay in sync across the codebase.
 */

const JWT_ISSUER = "avenzo-api";
const JWT_AUDIENCE = "avenzo-admin";

const FOOD_TYPES = ["VEG", "NON_VEG"];
const RESTAURANT_FOOD_TYPES = ["PURE_VEG", "NON_VEG", "BOTH"];
const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "EXPIRED", "SUSPENDED"];
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "CLOSED"];

const ORDER_STATUS_TRANSITIONS = {
    PENDING: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: []
};

const OTP_PURPOSES = ["CUSTOMER_LOGIN", "RESTAURANT_LOGIN", "SIGNUP_VERIFY", "ORDER_CONFIRMATION", "PASSWORD_RESET"];

module.exports = {
    JWT_ISSUER,
    JWT_AUDIENCE,
    FOOD_TYPES,
    RESTAURANT_FOOD_TYPES,
    SUBSCRIPTION_STATUSES,
    LEAD_STATUSES,
    ORDER_STATUS_TRANSITIONS,
    OTP_PURPOSES,
};
