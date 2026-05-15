require("dotenv").config();

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createPrismaClient } = require("../src/prisma");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const JWT_ISSUER = "avenzo-api";
const JWT_AUDIENCE = "avenzo-admin";
const prisma = createPrismaClient();

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

function assertNoFields(object, fields, label) {
  fields.forEach((field) => assert(!(field in object), `${label} exposed ${field}`));
}

async function login(email, password, path = "/auth/login") {
  const res = await request(path, {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  assert(res.status === 200, `${path} returned ${res.status}`);
  return res.data;
}

function signSmokeToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h", issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

async function createFixtures(suffix) {
  const passwordHash = await bcrypt.hash("Smoke@123", 10);
  const makeEmail = (role) => `smoke-${role}-${suffix}@example.com`;

  const admin = await prisma.user.create({
    data: { email: makeEmail("admin"), password: passwordHash, name: "Smoke Admin", role: "ADMIN" }
  });
  const owner = await prisma.user.create({
    data: { email: makeEmail("owner"), password: passwordHash, name: "Smoke Owner", role: "RESTAURANT_OWNER" }
  });
  const otherOwner = await prisma.user.create({
    data: { email: makeEmail("other-owner"), password: passwordHash, name: "Smoke Other Owner", role: "RESTAURANT_OWNER" }
  });
  const employee = await prisma.user.create({
    data: { email: makeEmail("employee"), password: passwordHash, name: "Smoke Employee", role: "EMPLOYEE" }
  });
  const customerWithPhone = await prisma.user.create({
    data: {
      email: makeEmail("customer-phone"),
      password: passwordHash,
      name: "Smoke Customer Phone",
      phone: "+919876543210",
      role: "USER"
    }
  });
  const customerNoPhone = await prisma.user.create({
    data: { email: makeEmail("customer-no-phone"), password: passwordHash, name: "Smoke Customer No Phone", role: "USER" }
  });

  const restaurant = await prisma.restaurant.create({
    data: {
      name: `Smoke Kitchen ${suffix}`,
      slug: `smoke-kitchen-${suffix}`,
      address: "Smoke Street",
      locality: "Bengaluru",
      pickupNote: "Pick up near the counter",
      foodType: "BOTH",
      ownerId: owner.id,
      isActive: true,
      subscriptionStatus: "ACTIVE"
    }
  });
  const otherRestaurant = await prisma.restaurant.create({
    data: {
      name: `Smoke Other Kitchen ${suffix}`,
      slug: `smoke-other-kitchen-${suffix}`,
      address: "Other Smoke Street",
      locality: "Bengaluru",
      foodType: "BOTH",
      ownerId: otherOwner.id,
      isActive: true,
      subscriptionStatus: "ACTIVE"
    }
  });
  const expiredRestaurant = await prisma.restaurant.create({
    data: {
      name: `Smoke Expired Kitchen ${suffix}`,
      slug: `smoke-expired-kitchen-${suffix}`,
      address: "Expired Street",
      locality: "Bengaluru",
      foodType: "BOTH",
      ownerId: owner.id,
      isActive: true,
      subscriptionStatus: "EXPIRED"
    }
  });

  await prisma.user.update({ where: { id: employee.id }, data: { staffRestaurantId: restaurant.id } });

  const category = await prisma.category.create({
    data: { name: "Meals", restaurantId: restaurant.id, sortOrder: 1 }
  });
  const menu = await prisma.menu.create({
    data: {
      name: `Smoke Idli ${suffix}`,
      pricePaise: 12000,
      description: "Soft idli for smoke testing",
      foodType: "VEG",
      categoryId: category.id,
      restaurantId: restaurant.id
    }
  });

  return {
    suffix,
    password: "Smoke@123",
    emails: {
      admin: admin.email,
      owner: owner.email,
      otherOwner: otherOwner.email,
      employee: employee.email,
      customerWithPhone: customerWithPhone.email,
      customerNoPhone: customerNoPhone.email
    },
    users: {
      admin: { id: admin.id, role: admin.role },
      owner: { id: owner.id, role: owner.role },
      otherOwner: { id: otherOwner.id, role: otherOwner.role },
      employee: { id: employee.id, role: employee.role },
      customerWithPhone: { id: customerWithPhone.id, role: customerWithPhone.role },
      customerNoPhone: { id: customerNoPhone.id, role: customerNoPhone.role }
    },
    userIds: [admin.id, owner.id, otherOwner.id, employee.id, customerWithPhone.id, customerNoPhone.id],
    restaurantIds: [restaurant.id, otherRestaurant.id, expiredRestaurant.id],
    restaurant,
    otherRestaurant,
    expiredRestaurant,
    menu
  };
}

async function cleanupFixtures(fixtures) {
  if (!fixtures) return;
  const phones = ["+919876543210", "+919876500000", "+919811112222", "+919822223333"];
  const emails = Object.values(fixtures.emails || {});
  const orders = await prisma.order.findMany({
    where: { restaurantId: { in: fixtures.restaurantIds } },
    select: { id: true }
  });
  const orderIds = orders.map((order) => order.id);

  await prisma.notificationLog.deleteMany({
    where: {
      OR: [
        { userId: { in: fixtures.userIds } },
        { orderId: { in: orderIds } },
        { recipientEmail: { in: emails } },
        { recipientPhone: { in: phones } }
      ]
    }
  });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.orderAttempt.deleteMany({ where: { OR: [{ restaurantId: { in: fixtures.restaurantIds } }, { phone: { in: phones } }] } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: fixtures.userIds } },
        { targetUserId: { in: fixtures.userIds } },
        { restaurantId: { in: fixtures.restaurantIds } }
      ]
    }
  });
  await prisma.restaurantLead.deleteMany({ where: { email: { contains: `lead-${fixtures.suffix}` } } });
  await prisma.menu.deleteMany({ where: { restaurantId: { in: fixtures.restaurantIds } } });
  await prisma.category.deleteMany({ where: { restaurantId: { in: fixtures.restaurantIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: fixtures.restaurantIds } } });
  await prisma.otpChallenge.deleteMany({ where: { OR: [{ userId: { in: fixtures.userIds } }, { email: { in: emails } }] } });
  await prisma.user.deleteMany({ where: { email: { contains: `signup-${fixtures.suffix}` } } });
  await prisma.user.deleteMany({ where: { id: { in: fixtures.userIds } } });
}

async function main() {
  const results = [];
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  let fixtures;
  let tokens = {};
  let publicMenuItem;
  let guestOrder;
  let customerOrder;

  try {
    fixtures = await createFixtures(suffix);

    await check("public pages and legal pages are reachable", async () => {
      for (const path of [
        "/",
        "/login.html",
        "/customer-login.html",
        "/customer-signup.html",
        "/restaurant-login.html",
        "/restaurant-interest.html",
        "/privacy.html",
        "/terms.html",
        "/refund-policy.html",
        `/r/${fixtures.restaurant.slug}`,
        "/track"
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

    await check("all roles can authenticate through approved paths", async () => {
      const signup = await request("/auth/customer/signup", {
        method: "POST",
        body: JSON.stringify({
          name: "Smoke Signup Customer",
          email: `signup-${suffix}@example.com`,
          password: "Smoke@123",
          phone: "9876500000"
        })
      });
      assert(signup.status === 200, `customer signup returned ${signup.status}`);
      assert(!("userId" in (signup.data || {})), "customer signup exposed internal user id");

      // Smoke uses short-lived fixture tokens for role-boundary tests so auth policy can require OTP.
      tokens.customerWithPhone = signSmokeToken(fixtures.users.customerWithPhone);
      tokens.customerNoPhone = signSmokeToken(fixtures.users.customerNoPhone);
      tokens.admin = signSmokeToken(fixtures.users.admin);
      tokens.owner = signSmokeToken(fixtures.users.owner);
      tokens.employee = signSmokeToken(fixtures.users.employee);

      const customer2fa = String(process.env.AUTH_REQUIRE_CUSTOMER_2FA || "false").toLowerCase() === "true";
      const restaurant2fa = String(process.env.AUTH_REQUIRE_RESTAURANT_2FA || "false").toLowerCase() === "true";

      // Verify customer login path behaviour matches the 2FA flag.
      const customerLoginRes = await request("/auth/customer/login", {
        method: "POST",
        body: JSON.stringify({ email: fixtures.emails.customerWithPhone, password: fixtures.password })
      });
      assert(customerLoginRes.status === 200, `customer login returned ${customerLoginRes.status}`);
      if (customer2fa) {
        assert(customerLoginRes.data?.otpRequired === true, "customer login should require OTP when 2FA is on");
        assert(typeof customerLoginRes.data?.challengeId === "string", "customer login should return challengeId");
        assert(!customerLoginRes.data?.token, "customer login must not return token before OTP");
      } else {
        assert(typeof customerLoginRes.data?.token === "string", "customer login should return token when 2FA is off");
      }

      // Verify restaurant login path behaviour matches the 2FA flag.
      const adminPartner = await request("/auth/restaurant/login", {
        method: "POST",
        body: JSON.stringify({ email: fixtures.emails.admin, password: fixtures.password })
      });
      assert(adminPartner.status === 200, `admin partner login returned ${adminPartner.status}`);
      if (restaurant2fa) {
        assert(adminPartner.data?.otpRequired === true, "restaurant login should require OTP when 2FA is on");
        assert(!adminPartner.data?.token, "restaurant login must not return token before OTP");
      } else {
        assert(typeof adminPartner.data?.token === "string", "restaurant login should return token when 2FA is off");
      }

      const compatibilityAdmin = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: fixtures.emails.admin, password: fixtures.password })
      });
      assert(compatibilityAdmin.status === 200, `compatibility login returned ${compatibilityAdmin.status}`);
      if (restaurant2fa) {
        assert(compatibilityAdmin.data?.otpRequired === true, "compatibility login should require OTP for restaurant/admin users when 2FA is on");
        assert(!compatibilityAdmin.data?.token, "compatibility login must not bypass restaurant/admin OTP");
      } else {
        assert(typeof compatibilityAdmin.data?.token === "string", "compatibility login should return token when restaurant/admin 2FA is off");
      }

      // USER must always be blocked from restaurant login path regardless of 2FA setting.
      const customerPartner = await request("/auth/restaurant/login", {
        method: "POST",
        body: JSON.stringify({ email: fixtures.emails.customerWithPhone, password: fixtures.password })
      });
      assert(customerPartner.status === 403, `customer partner login returned ${customerPartner.status}`);
    }, results);

    await check("customer role is blocked from restaurant/admin APIs", async () => {
      for (const path of [
        "/restaurants",
        "/admin/restaurant-leads",
        `/admin/staff/${fixtures.restaurant.id}`,
        `/admin/orders/${fixtures.restaurant.id}`,
        `/admin/menu/${fixtures.restaurant.id}`
      ]) {
        const res = await request(path, { headers: auth(tokens.customerWithPhone) });
        assert(res.status === 403, `${path} returned ${res.status}`);
      }
    }, results);

    await check("owner and employee restaurant scope is enforced", async () => {
      const ownerOwn = await request(`/admin/menu/${fixtures.restaurant.id}`, { headers: auth(tokens.owner) });
      assert(ownerOwn.status === 200, `owner own menu returned ${ownerOwn.status}`);

      const ownerOther = await request(`/admin/menu/${fixtures.otherRestaurant.id}`, { headers: auth(tokens.owner) });
      assert(ownerOther.status === 403, `owner other menu returned ${ownerOther.status}`);

      const employeeOrders = await request(`/admin/orders/${fixtures.restaurant.id}`, { headers: auth(tokens.employee) });
      assert(employeeOrders.status === 200, `employee orders returned ${employeeOrders.status}`);

      const employeeStaff = await request(`/admin/staff/${fixtures.restaurant.id}`, { headers: auth(tokens.employee) });
      assert(employeeStaff.status === 403, `employee staff returned ${employeeStaff.status}`);

      const employeeLeads = await request("/admin/restaurant-leads", { headers: auth(tokens.employee) });
      assert(employeeLeads.status === 403, `employee leads returned ${employeeLeads.status}`);
    }, results);

    await check("subscription blocking applies to owner but not admin", async () => {
      const ownerExpired = await request(`/admin/menu/${fixtures.expiredRestaurant.id}`, { headers: auth(tokens.owner) });
      assert(ownerExpired.status === 423, `owner expired menu returned ${ownerExpired.status}`);

      const adminExpired = await request(`/admin/menu/${fixtures.expiredRestaurant.id}`, { headers: auth(tokens.admin) });
      assert(adminExpired.status === 200, `admin expired menu returned ${adminExpired.status}`);
    }, results);

    await check("public menu is safe and uses opaque keys", async () => {
      const menu = await request(`/menu/by-slug/${fixtures.restaurant.slug}`, { headers: {} });
      assert(menu.status === 200, `public menu returned ${menu.status}`);
      publicMenuItem = menu.data[0];
      assert(publicMenuItem?.key, "public menu did not return menu key");
      assertNoFields(publicMenuItem, ["id", "restaurantId", "categoryId"], "public menu item");
      assertNoFields(publicMenuItem.category || {}, ["id", "restaurantId"], "public category");
    }, results);

    await check("guest order requires phone and is trackable without internal id", async () => {
      const missingPhone = await request("/order", {
        method: "POST",
        body: JSON.stringify({
          restaurantSlug: fixtures.restaurant.slug,
          sessionId: `smoke-device-${suffix}`,
          items: [{ menuKey: publicMenuItem.key, quantity: 1 }]
        })
      });
      assert(missingPhone.status === 400, `guest missing phone returned ${missingPhone.status}`);

      const placed = await request("/order", {
        method: "POST",
        body: JSON.stringify({
          restaurantSlug: fixtures.restaurant.slug,
          sessionId: `smoke-device-guest-${suffix}`,
          phone: "9811112222",
          items: [{ menuKey: publicMenuItem.key, quantity: 1 }]
        })
      });
      assert(placed.status === 200, `guest order returned ${placed.status}`);
      guestOrder = placed.data;

      const tracking = await request(`/order/${guestOrder.trackingToken}`, { headers: {} });
      assert(tracking.status === 200, `tracking returned ${tracking.status}`);
      assertNoFields(tracking.data, ["id", "customerId", "restaurantId", "sessionId"], "public tracking");
    }, results);

    await check("logged-in customer orders use profile phone or save provided phone", async () => {
      const withSavedPhone = await request("/order", {
        method: "POST",
        headers: auth(tokens.customerWithPhone),
        body: JSON.stringify({
          restaurantSlug: fixtures.restaurant.slug,
          sessionId: `smoke-device-customer-phone-${suffix}`,
          items: [{ menuKey: publicMenuItem.key, quantity: 1 }]
        })
      });
      assert(withSavedPhone.status === 200, `saved-phone order returned ${withSavedPhone.status}`);
      customerOrder = withSavedPhone.data;

      const needsPhone = await request("/order", {
        method: "POST",
        headers: auth(tokens.customerNoPhone),
        body: JSON.stringify({
          restaurantSlug: fixtures.restaurant.slug,
          sessionId: `smoke-device-customer-nophone-missing-${suffix}`,
          items: [{ menuKey: publicMenuItem.key, quantity: 1 }]
        })
      });
      assert(needsPhone.status === 400, `no-phone customer order returned ${needsPhone.status}`);

      const withProvidedPhone = await request("/order", {
        method: "POST",
        headers: auth(tokens.customerNoPhone),
        body: JSON.stringify({
          restaurantSlug: fixtures.restaurant.slug,
          sessionId: `smoke-device-customer-nophone-${suffix}`,
          phone: "9822223333",
          items: [{ menuKey: publicMenuItem.key, quantity: 1 }]
        })
      });
      assert(withProvidedPhone.status === 200, `provided-phone order returned ${withProvidedPhone.status}`);
    }, results);

    await check("customer order history is scoped and excludes guest orders", async () => {
      const orders = await request("/customer/orders", { headers: auth(tokens.customerWithPhone) });
      assert(orders.status === 200, `/customer/orders returned ${orders.status}`);
      const tokensInHistory = (orders.data.orders || []).map((order) => order.trackingToken);
      assert(tokensInHistory.includes(customerOrder.trackingToken), "logged-in order missing from history");
      assert(!tokensInHistory.includes(guestOrder.trackingToken), "guest order appeared in customer history");
      (orders.data.orders || []).forEach((order) => assertNoFields(order, ["id", "customerId", "restaurantId", "sessionId"], "customer order"));
    }, results);

    await check("customer-owned pending orders require account auth to cancel", async () => {
      const anonymousCancel = await request(`/order/${customerOrder.trackingToken}/cancel`, {
        method: "POST",
        body: JSON.stringify({})
      });
      assert(anonymousCancel.status === 401, `anonymous customer-order cancel returned ${anonymousCancel.status}`);

      const otherCustomerCancel = await request(`/order/${customerOrder.trackingToken}/cancel`, {
        method: "POST",
        headers: auth(tokens.customerNoPhone),
        body: JSON.stringify({})
      });
      assert(otherCustomerCancel.status === 403, `other customer cancel returned ${otherCustomerCancel.status}`);

      const ownerCancel = await request(`/order/${customerOrder.trackingToken}/cancel`, {
        method: "POST",
        headers: auth(tokens.customerWithPhone),
        body: JSON.stringify({})
      });
      assert(ownerCancel.status === 200, `owner customer-order cancel returned ${ownerCancel.status}`);
    }, results);

    await check("password reset request response does not reveal account existence", async () => {
      const known = await request("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: fixtures.emails.customerWithPhone })
      });
      const unknown = await request("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: `missing-${suffix}@example.com` })
      });
      assert(known.status === 200, `known reset returned ${known.status}`);
      assert(unknown.status === 200, `unknown reset returned ${unknown.status}`);
      assert(typeof known.data?.challengeId === "string", "known reset missing challengeId");
      assert(typeof unknown.data?.challengeId === "string", "unknown reset missing challengeId");
      assert(typeof known.data?.maskedEmail === "string", "known reset missing maskedEmail");
      assert(typeof unknown.data?.maskedEmail === "string", "unknown reset missing maskedEmail");
      assert(known.data?.message === unknown.data?.message, "reset response messages differ");
      assert(Object.keys(known.data || {}).sort().join(",") === Object.keys(unknown.data || {}).sort().join(","), "reset response shapes differ");
    }, results);

    await check("restaurant roles cannot create customer orders", async () => {
      const res = await request("/order", {
        method: "POST",
        headers: auth(tokens.owner),
        body: JSON.stringify({
          restaurantSlug: fixtures.restaurant.slug,
          sessionId: `smoke-device-owner-${suffix}`,
          phone: "9811112222",
          items: [{ menuKey: publicMenuItem.key, quantity: 1 }]
        })
      });
      assert(res.status === 403, `owner customer order returned ${res.status}`);
    }, results);

    await check("admin leads workflow works", async () => {
      const interest = await request("/restaurant-interest", {
        method: "POST",
        body: JSON.stringify({
          restaurantName: `Smoke Lead ${suffix}`,
          contactName: "Smoke Lead Owner",
          phone: "9876543210",
          email: `lead-${suffix}@example.com`,
          location: "Bengaluru",
          restaurantType: "Cafe",
          approxDailyOrders: "50-100",
          message: "Smoke test lead"
        })
      });
      assert(interest.status === 201, `restaurant interest returned ${interest.status}`);

      const leads = await request(`/admin/restaurant-leads?search=lead-${suffix}`, { headers: auth(tokens.admin) });
      assert(leads.status === 200, `admin leads returned ${leads.status}`);
      const lead = (leads.data.leads || [])[0];
      assert(lead, "created lead not found");

      const update = await request(`/admin/restaurant-leads/${lead.id}`, {
        method: "PATCH",
        headers: auth(tokens.admin),
        body: JSON.stringify({ status: "QUALIFIED", internalNote: "Smoke note" })
      });
      assert(update.status === 200, `lead update returned ${update.status}`);
    }, results);

    await check("invalid public tracking does not leak stack traces", async () => {
      const res = await request(`/order/${crypto.randomUUID()}`, { headers: {} });
      assert(res.status === 404, `unknown tracking returned ${res.status}`);
      assert(!JSON.stringify(res.data || {}).toLowerCase().includes("stack"), "tracking response included stack text");
    }, results);
  } finally {
    await cleanupFixtures(fixtures);
    await prisma.$disconnect();
  }

  results.forEach((result) => {
    const detail = result.detail ? ` - ${result.detail}` : "";
    console.log(`${result.status} ${result.name}${detail}`);
  });

  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
