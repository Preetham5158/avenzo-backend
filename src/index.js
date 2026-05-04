require("dotenv").config();

const express = require("express");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

/* ================================
   HEALTH CHECK
================================ */
app.get("/", (req, res) => {
  res.send("Avenzo API running 🚀");
});

/* ================================
   GET MENU
================================ */
app.get("/menu/:restaurantId", async (req, res) => {
  try {
    const menu = await prisma.menu.findMany({
      where: { restaurantId: req.params.restaurantId },
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

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Items required" });
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
   UPDATE STATUS
================================ */
app.patch("/order/:orderId/status", async (req, res) => {
  try {
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
   DASHBOARD UI
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
    <head>
      <style>
        body{font-family:Arial;background:#f6f7fb;padding:20px}
        .order{background:white;padding:15px;margin:10px;border-radius:10px}
        .code{font-size:20px;font-weight:bold}
        .status{margin:5px 0}
        button{margin:5px;padding:6px 10px}
        .ready{background:green;color:white}
        .done{background:blue;color:white}
      </style>
    </head>
    <body>
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
   TRACK UI (LIVE)
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
    <head>
      <style>
        body{font-family:Arial;background:#f6f7fb;display:flex;justify-content:center;align-items:center;height:100vh}
        .card{background:white;padding:30px;border-radius:12px;width:300px;text-align:center}
        .code{font-size:40px;font-weight:bold}
        .status{margin:10px;padding:5px;color:white;border-radius:10px}
      </style>
    </head>
    <body>
      <div class="card">
        <h3>Your Order</h3>
        <div class="code">#${order.pickupCode}</div>
        <div id="status" class="status">${order.status}</div>
        <ul>${items}</ul>
        <h4>₹${order.totalPrice}</h4>
      </div>

      <script>
        async function refresh(){
          const r = await fetch('${BASE_URL}/order/${order.id}');
          const d = await r.json();
          const s = document.getElementById('status');
          s.innerText = d.status;

          if(d.status==='READY') s.style.background='green';
          else if(d.status==='COMPLETED') s.style.background='blue';
          else s.style.background='orange';
        }
        setInterval(refresh,4000);
        refresh();
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