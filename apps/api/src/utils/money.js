function rupeesToPaise(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function paiseToRupees(value) {
  // Store money as paise to avoid Float rounding errors in totals and refunds.
  return Number(value || 0) / 100;
}

module.exports = {
  rupeesToPaise,
  paiseToRupees
};
