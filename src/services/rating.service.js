// Rating can come from a guest (trackingToken only) or a logged-in customer.
// One rating per order, only after COMPLETED.
async function submitRating(prisma, { trackingToken, rating, comment, userId }) {
  const order = await prisma.order.findUnique({
    where: { trackingToken },
    select: { id: true, status: true, customerId: true, restaurantId: true, rating: true }
  });

  if (!order) {
    const err = new Error("Order not found"); err.status = 404; throw err;
  }
  if (order.status !== "COMPLETED") {
    const err = new Error("Only completed orders can be rated"); err.status = 409; throw err;
  }
  if (order.rating) {
    const err = new Error("This order has already been rated"); err.status = 409; throw err;
  }
  // Logged-in customer: ensure the order belongs to them if it was a customer order.
  if (userId && order.customerId && order.customerId !== userId) {
    const err = new Error("This order does not belong to your account"); err.status = 403; throw err;
  }

  return prisma.orderRating.create({
    data: {
      orderId: order.id,
      restaurantId: order.restaurantId,
      customerId: userId || null,
      rating,
      comment: comment ? String(comment).trim().slice(0, 500) : null
    }
  });
}

module.exports = { submitRating };
