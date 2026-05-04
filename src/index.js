require("dotenv").config();

const express = require("express");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(express.static("public"));

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

/* ================================
   HEALTH CHECK
================================ */
app.get("/", (req, res) => {
  res.send("Avenzo API running 🚀");
});

/* ================================
   GET RESTAURANT DETAILS
================================ */
app.get("/restaurant/:id", async (req, res) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.params.id },
    });

    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    res.json(restaurant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching restaurant" });
  }
});

/* ================================
   GET MENU (ONLY AVAILABLE ITEMS)
================================ */
app.get("/menu/:restaurantId", async (req, res) => {
  try {
    const menu = await prisma.menu.findMany({
      where: {
        restaurantId: req.params.restaurantId,
        isAvailable: true, // 🔥 important
      },
      orderBy: {
        category: "asc",
      },
    });

    res.json(menu);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching menu" });
  }
});

/* ================================
   CREATE ORDER
================================ */
app.post("/order", async (req, res) => {
  try {
    const { items, restaurantId, sessionId, phone } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items required" });
    }

    if (!restaurantId || !sessionId) {
      return res.status(400).json({ error: "Missing restaurantId/sessionId" });
    }

    const pickupCode = Math.floor(1000 + Math.random() * 9000).toString();

    let totalPrice = 0;

    for (let item of items) {
      const menu = await prisma.menu.findUnique({
        where: { id: item.menuId },
      });

      if (!menu) {
        return res.status(400).json({ error: "Invalid item" });
      }

      totalPrice += menu.price * item.quantity;
    }

    const order = await prisma.order.create({
      data: {
        totalPrice,
        pickupCode,
        sessionId,
        phone: phone || null,
        restaurantId,
        items: {
          create: items.map((i) => ({
            menuId: i.menuId,
            quantity: i.quantity,
          })),
        },
      },
    });

    const trackingUrl = `${BASE_URL}/track/${order.id}`;

    res.json({
      message: "Order created",
      orderId: order.id,
      pickupCode,
      trackingUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creating order" });
  }
});

/* ================================
   GET ORDER (JSON)
================================ */
app.get("/order/:orderId", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { items: { include: { menu: true } } },
    });

    if (!order) return res.status(404).json({ error: "Not found" });

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching order" });
  }
});

/* ================================
   UPDATE ORDER STATUS
================================ */
app.patch("/order/:orderId/status", async (req, res) => {
  try {
    if (!req.body.status) {
      return res.status(400).json({ error: "Status required" });
    }

    const updated = await prisma.order.update({
      where: { id: req.params.orderId },
      data: { status: req.body.status },
    });

    res.json({ message: "Updated", status: updated.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating status" });
  }
});

/* ================================
   DASHBOARD UI (RESTAURANT VIEW)
================================ */
app.get("/dashboard/:restaurantId", async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { restaurantId: req.params.restaurantId },
      include: { items: { include: { menu: true } } },
      orderBy: { createdAt: "desc" },
    });

    const html = orders
      .map((o) => {
        const items = o.items
          .map((i) => `<li>${i.menu.name} x ${i.quantity}</li>`)
          .join("");

        return `
        <div class="order">
          <div class="code">#${o.pickupCode}</div>
          <div class="status">${o.status}</div>
          <ul>${items}</ul>
          <button onclick="update('${o.id}','READY')" class="ready">READY</button>
          <button onclick="update('${o.id}','COMPLETED')" class="done">DONE</button>
        </div>`;
      })
      .join("");

    res.send(`
    <html>
    <body style="font-family:Arial;background:#f6f7fb;padding:20px">
      <h2>Orders</h2>
      ${html}
      <script>
        async function update(id,status){
          await fetch('${BASE_URL}/order/'+id+'/status',{
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({status})
          });
          location.reload();
        }
        setInterval(()=>location.reload(),5000);
      </script>
    </body>
    </html>
    `);
  } catch (err) {
    console.error(err);
    res.send("Error loading dashboard");
  }
});

/* ================================
   TRACK ORDER UI
================================ */
app.get("/track/:orderId", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { items: { include: { menu: true } } },
    });

    if (!order) return res.send("Not found");

    const items = order.items
      .map(
        (i) =>
          `<li>${i.menu.name} x ${i.quantity} - ₹${i.menu.price * i.quantity}</li>`
      )
      .join("");

    res.send(`
    <html>
    <body style="font-family:Arial;background:#f6f7fb;display:flex;justify-content:center;align-items:center;height:100vh">
      <div style="background:white;padding:30px;border-radius:12px;width:300px;text-align:center">
        <h3>Your Order</h3>
        <div style="font-size:40px;font-weight:bold">#${order.pickupCode}</div>
        <div id="status">${order.status}</div>
        <ul>${items}</ul>
        <h4>₹${order.totalPrice}</h4>
      </div>

      <script>
        async function refresh(){
          const r = await fetch('${BASE_URL}/order/${order.id}');
          const d = await r.json();
          document.getElementById('status').innerText = d.status;
        }
        setInterval(refresh,4000);
      </script>
    </body>
    </html>
    `);
  } catch (err) {
    console.error(err);
    res.send("Error loading tracking");
  }
});

/* ================================
   START SERVER
================================ */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running 🚀 on port " + PORT);
});