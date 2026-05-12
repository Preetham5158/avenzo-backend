const crypto = require("crypto");

function publicMenuKey(menuId, secret = process.env.JWT_SECRET) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(menuId || ""))
    .digest("base64url")
    .slice(0, 24);
}

module.exports = {
  publicMenuKey
};
