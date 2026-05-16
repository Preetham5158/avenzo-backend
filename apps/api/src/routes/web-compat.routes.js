"use strict";
// webCompat routes — serve current static apps/api/public/ HTML frontend during migration to Next.js apps. New clients must use /api/v1 exclusively.

const router = require("express").Router();

router.use(require("../modules/webCompat/auth.web-compat.routes"));
router.use(require("../modules/webCompat/public.web-compat.routes"));
router.use(require("../modules/webCompat/customer.web-compat.routes"));
router.use(require("../modules/webCompat/admin.web-compat.routes"));
router.use(require("../modules/webCompat/payment.web-compat.routes"));

module.exports = router;
