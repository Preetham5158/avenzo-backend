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
  }

  // Expose rating state so the frontend can show the prompt or the submitted stars.
  response.hasRating = !!order.rating;
  response.rating = order.rating?.rating ?? null;

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
    rating: order.rating?.rating ?? null
  };
}

module.exports = {
  publicOrderResponse,
  customerOrderSummary
};
