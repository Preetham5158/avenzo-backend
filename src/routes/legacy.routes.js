"use strict";
/**
 * Legacy routes aggregator.
 * All legacy endpoints are preserved here for backward compatibility.
 * New API endpoints should use /api/v1/* routes instead.
 */

const router = require("express").Router();

router.use(require("../modules/legacy/auth.legacy.routes"));
router.use(require("../modules/legacy/public.legacy.routes"));
router.use(require("../modules/legacy/customer.legacy.routes"));
router.use(require("../modules/legacy/admin.legacy.routes"));
router.use(require("../modules/legacy/payment.legacy.routes"));

module.exports = router;
