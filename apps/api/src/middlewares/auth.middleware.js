"use strict";
/**
 * JWT authentication middleware.
 *
 * Two response-format variants exist on purpose:
 *   - legacy authMiddleware/optionalAuth return `{ error: "..." }` (frozen contract)
 *   - v1Auth/v1OptionalAuth return `{ success:false, error:{ code, message } }`
 *
 * Both verify the same HS256 token with the same issuer/audience.
 */

const jwt = require("jsonwebtoken");
const { JWT_ISSUER, JWT_AUDIENCE } = require("../lib/constants");
const { v1err } = require("../lib/response");

function verifyJwt(token) {
    return jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE
    });
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Please sign in again." });

    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    try {
        req.user = verifyJwt(token);
        next();
    } catch {
        res.status(401).json({ error: "Please sign in again." });
    }
}

function optionalAuth(req, res, next) {
    // Explicit guest flag forces anonymous handling, even with stale tokens.
    if (req.body?.guest === true) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader) return next();

    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    try {
        req.user = verifyJwt(token);
    } catch {
        req.user = null;
    }
    next();
}

function v1Auth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return v1err(res, "UNAUTHORIZED", "Authentication required", 401);

    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    try {
        req.user = verifyJwt(token);
        next();
    } catch {
        return v1err(res, "UNAUTHORIZED", "Session expired. Please sign in again.", 401);
    }
}

function v1OptionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();

    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    try {
        req.user = verifyJwt(token);
    } catch { /* guest */ }
    next();
}

module.exports = {
    authMiddleware,
    optionalAuth,
    v1Auth,
    v1OptionalAuth,
    verifyJwt,
};
