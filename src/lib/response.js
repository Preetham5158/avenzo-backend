"use strict";
/**
 * Standard response envelopes for /api/v1.
 * v1ok / v1err / v1list keep response shape consistent across all v1 modules:
 *   success → { success: true, data, [pagination] }
 *   error   → { success: false, error: { code, message } }
 *
 * sendSuccess / sendError / sendList are the same functions with descriptive names.
 */

function v1ok(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}

function v1err(res, code, message, status = 400) {
    return res.status(status).json({ success: false, error: { code, message } });
}

function v1list(res, data, pagination = null) {
    return res.json({ success: true, data, ...(pagination && { pagination }) });
}

module.exports = {
    v1ok,
    v1err,
    v1list,
    sendSuccess: v1ok,
    sendError: (res, status, code, message) => v1err(res, code, message, status),
    sendList: v1list,
};
