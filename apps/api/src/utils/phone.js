function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const compact = raw.replace(/[^\d+]/g, "");
  if (compact.startsWith("+")) return compact;
  if (compact.length === 10) return `+91${compact}`;
  return compact;
}

function isValidPhone(value) {
  const normalized = normalizePhone(value);
  return !!normalized && /^\+?[0-9]{10,15}$/.test(normalized);
}

module.exports = {
  isValidPhone,
  normalizePhone
};
