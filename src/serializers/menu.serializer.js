const { paiseToRupees } = require("../utils/money");
const { publicMenuKey } = require("../utils/token");

function publicMenuItem(item) {
  if (!item) return item;

  const { id, pricePaise, restaurantId, categoryId, category, ...safeItem } = item;

  // Public menu uses menuKey so internal menu/category IDs are not exposed to customers.
  return {
    ...safeItem,
    key: publicMenuKey(id),
    category: category ? { name: category.name, sortOrder: category.sortOrder } : null,
    price: paiseToRupees(pricePaise)
  };
}

function adminMenuItem(item) {
  if (!item) return item;

  return {
    id: item.id,
    key: publicMenuKey(item.id),
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    foodType: item.foodType,
    isAvailable: item.isAvailable,
    isActive: item.isActive,
    price: paiseToRupees(item.pricePaise),
    categoryId: item.categoryId,
    category: item.category
      ? { id: item.category.id, name: item.category.name, sortOrder: item.category.sortOrder }
      : null
  };
}

module.exports = {
  publicMenuItem,
  adminMenuItem
};
