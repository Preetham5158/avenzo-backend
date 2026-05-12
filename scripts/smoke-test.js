const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const crypto = require("crypto");

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
  }
  return { ok: res.ok, status: res.status, data };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn, results) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (err) {
    results.push({ name, status: "FAIL", detail: err.message });
  }
}

function assertNoInternalOrderFields(order) {
  const blocked = ["id", "customerId", "restaurantId", "sessionId"];
  blocked.forEach((field) => assert(!(field in order), `public order exposed ${field}`));
}

async function main() {
  const results = [];
  const suffix = Date.now();
  const email = `customer-${suffix}@example.com`;
  const password = "Customer@123";
  let customerToken = "";

  await check("public pages are reachable", async () => {
    for (const path of [
      "/",
      "/customer-login.html",
      "/customer-signup.html",
      "/restaurant-login.html",
      "/restaurant-interest.html",
      "/privacy.html",
      "/terms.html",
      "/refund-policy.html"
    ]) {
      const res = await request(path, { headers: {} });
      assert(res.status === 200, `${path} returned ${res.status}`);
    }
  }, results);

  await check("invalid token is rejected safely", async () => {
    const res = await request("/auth/me", { headers: auth("not-a-valid-token") });
    assert(res.status === 401, `/auth/me returned ${res.status}`);
    assert(res.data?.error === "Please sign in again.", "unexpected invalid token message");
  }, results);

  await check("customer signup and login", async () => {
    const signup = await request("/auth/customer/signup", {
      method: "POST",
      body: JSON.stringify({ name: "Smoke Customer", email, password, phone: "9876543210" })
    });
    assert(signup.status === 200, `signup returned ${signup.status}`);

    const login = await request("/auth/customer/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    assert(login.status === 200, `login returned ${login.status}`);
    assert(login.data?.user?.role === "USER", "login did not return USER role");
    customerToken = login.data.token;
  }, results);

  await check("customer cannot use restaurant login", async () => {
    const res = await request("/auth/restaurant/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    assert(res.status === 403, `restaurant login returned ${res.status}`);
  }, results);

  await check("customer is blocked from restaurant admin APIs", async () => {
    const restaurants = await request("/restaurants", { headers: auth(customerToken) });
    assert(restaurants.status === 403, `/restaurants returned ${restaurants.status}`);

    const leads = await request("/admin/restaurant-leads", { headers: auth(customerToken) });
    assert(leads.status === 403, `/admin/restaurant-leads returned ${leads.status}`);
  }, results);

  await check("customer profile partial updates preserve fields", async () => {
    const nameOnly = await request("/customer/profile", {
      method: "PATCH",
      headers: auth(customerToken),
      body: JSON.stringify({ name: "Smoke Customer Updated" })
    });
    assert(nameOnly.status === 200, `name update returned ${nameOnly.status}`);
    assert(nameOnly.data.profile.phone, "name-only update cleared phone");

    const phoneOnly = await request("/customer/profile", {
      method: "PATCH",
      headers: auth(customerToken),
      body: JSON.stringify({ phone: "9876500000" })
    });
    assert(phoneOnly.status === 200, `phone update returned ${phoneOnly.status}`);
    assert(phoneOnly.data.profile.name === "Smoke Customer Updated", "phone-only update cleared name");
  }, results);

  await check("customer orders are scoped and safe", async () => {
    const orders = await request("/customer/orders", { headers: auth(customerToken) });
    assert(orders.status === 200, `/customer/orders returned ${orders.status}`);
    (orders.data.orders || []).forEach(assertNoInternalOrderFields);
  }, results);

  await check("restaurant interest creates a lead", async () => {
    const interest = await request("/restaurant-interest", {
      method: "POST",
      body: JSON.stringify({
        restaurantName: `Smoke Restaurant ${suffix}`,
        contactName: "Smoke Owner",
        phone: "9876543210",
        email: `lead-${suffix}@example.com`,
        location: "Bengaluru",
        restaurantType: "Cafe",
        approxDailyOrders: "50-100",
        message: "Smoke test lead"
      })
    });
    assert(interest.status === 201, `restaurant interest returned ${interest.status}`);
  }, results);

  await check("unknown public tracking is safe", async () => {
    const res = await request(`/order/${crypto.randomUUID()}`, { headers: {} });
    assert(res.status === 404, `unknown tracking returned ${res.status}`);
    assert(!JSON.stringify(res.data || {}).toLowerCase().includes("stack"), "tracking response included stack text");
  }, results);

  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    await check("optional admin login and leads access", async () => {
      const login = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, password: adminPassword })
      });
      assert(login.status === 200, `admin login returned ${login.status}`);
      assert(login.data?.user?.role === "ADMIN", "admin login did not return ADMIN role");

      const leads = await request("/admin/restaurant-leads", { headers: auth(login.data.token) });
      assert(leads.status === 200, `admin leads returned ${leads.status}`);
    }, results);
  } else {
    results.push({ name: "optional admin login and leads access", status: "SKIP", detail: "Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD to run." });
  }

  results.forEach((result) => {
    const detail = result.detail ? ` - ${result.detail}` : "";
    console.log(`${result.status} ${result.name}${detail}`);
  });

  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
