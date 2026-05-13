const { paiseToRupees } = require("../utils/money");

function publicOrderResponse(order, options = {}) {
  const response = {
    orderNumber: order.orderNumber,
    pickupCode: order.pickupCode,
    totalPrice: paiseToRupees(order.totalPricePaise),
    status: order.status,
    paymentStatus: order.paymentStatus,
    readyAt: order.readyAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    restaurant: order.restaurant
      ? {
          name: order.restaurant.name,
          slug: order.restaurant.slug,
          pickupNote: order.restaurant.pickupNote
        }
      : null,
    items: (order.items || []).map((item) => ({
      nameAtOrder: item.nameAtOrder,
      quantity: item.quantity,
      priceAtOrder: paiseToRupees(item.priceAtOrderPaise)
    }))
  };

  if (options.includeInternalId) {
    response.id = order.id;
    response.phone = order.phone || null;
  }

  response.tableNumber = order.tableNumber || null;
  // Expose rating state so the frontend can show the prompt or the submitted stars.
  response.hasRating = !!order.rating;
  response.rating = order.rating?.rating ?? null;

  // Include payment method info while payment is unresolved so tracking/checkout shows correct UI.
  if (["PAYMENT_PENDING", "PAYMENT_CLAIMED"].includes(order.paymentStatus) && order.paymentMethod) {
    response.paymentInfo = {
      type: order.paymentMethod.type,
      displayName: order.paymentMethod.displayName,
      ...(order.paymentMethod.type === "UPI_QR" && {
        qrImageUrl: order.paymentMethod.qrImageUrl || null,
        upiId: order.paymentMethod.upiId || null
      })
    };
  }
  // Expose the reference the customer submitted (e.g. UTR) so restaurant can cross-check.
  if (options.includeInternalId && order.paymentReference) {
    response.paymentReference = order.paymentReference;
  }

  return response;
}

function customerOrderSummary(order) {
  return {
    trackingToken: order.trackingToken,
    orderNumber: order.orderNumber,
    pickupCode: order.pickupCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalPrice: paiseToRupees(order.totalPricePaise),
    createdAt: order.createdAt,
    readyAt: order.readyAt,
    restaurant: order.restaurant
      ? {
          name: order.restaurant.name,
          slug: order.restaurant.slug,
          locality: order.restaurant.locality,
          address: order.restaurant.address
        }
      : null,
    items: (order.items || []).map((item) => ({
      nameAtOrder: item.nameAtOrder,
      quantity: item.quantity,
      priceAtOrder: paiseToRupees(item.priceAtOrderPaise)
    })),
    tableNumber: order.tableNumber || null,
    rating: order.rating?.rating ?? null
  };
}

module.exports = {
  publicOrderResponse,
  customerOrderSummary
};
