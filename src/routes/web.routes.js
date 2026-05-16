"use strict";
/**
 * Static HTML page routes — serves SPA shells from public/.
 * Specific slug-based routes resolve to a known HTML template (menu.html, tracking.html, etc.).
 *
 * All HTML responses go through this single module so the web shell stays self-contained.
 */

const express = require("express");
const path = require("path");

const publicDir = path.join(__dirname, "..", "..", "public");
const router = express.Router();

router.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

router.get("/r/:slug", (req, res) => {
    res.sendFile(path.join(publicDir, "menu.html"));
});

router.get("/track", (req, res) => {
    res.sendFile(path.join(publicDir, "track.html"));
});

router.get("/track/:id", (req, res) => {
    res.sendFile(path.join(publicDir, "track.html"));
});

router.get("/restaurant-interest", (req, res) => {
    res.sendFile(path.join(publicDir, "restaurant-interest.html"));
});

router.get("/forgot-password", (req, res) => {
    res.sendFile(path.join(publicDir, "forgot-password.html"));
});

router.get("/privacy", (req, res) => {
    res.sendFile(path.join(publicDir, "privacy.html"));
});

router.get("/terms", (req, res) => {
    res.sendFile(path.join(publicDir, "terms.html"));
});

router.get("/favicon.ico", (req, res) => res.redirect("/logo.png"));

module.exports = router;
