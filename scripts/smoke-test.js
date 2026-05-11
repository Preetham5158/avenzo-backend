const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const suffix = Date.now();
  const email = `customer-${suffix}@example.com`;
  const password = "Customer@123";

  const signup = await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke Customer", email, password })
  });
  console.log("signup", signup.status);

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  console.log("login", login.status, login.data?.user?.role);

  const leads = await request("/admin/restaurant-leads", {
    headers: { Authorization: `Bearer ${login.data?.token || ""}` }
  });
  console.log("non-admin leads", leads.status);

  const interest = await request("/restaurant-interest", {
    method: "POST",
    body: JSON.stringify({
      restaurantName: `Smoke Restaurant ${suffix}`,
      contactName: "Smoke Owner",
      phone: "9876543210",
      email: `lead-${suffix}@example.com`,
      location: "Bengaluru"
    })
  });
  console.log("interest", interest.status);

  const customerOrders = await request("/customer/orders", {
    headers: { Authorization: `Bearer ${login.data?.token || ""}` }
  });
  console.log("customer orders", customerOrders.status);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
