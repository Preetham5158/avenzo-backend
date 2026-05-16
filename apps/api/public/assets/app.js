const API = window.location.origin;

// sessionStorage keeps auth tab-isolated: a guest QR tab stays guest even when another tab is logged in.
function getToken() {
  return sessionStorage.getItem("avenzo_access_token");
}

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: "Bearer " + token } : {})
  };
}

async function request(path, options = {}) {
  const { auth, ...fetchOptions } = options;
  const headers = options.body
    ? (auth === false ? { "Content-Type": "application/json", ...(options.headers || {}) } : authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }))
    : (auth === false ? (options.headers || {}) : authHeaders(options.headers || {}));

  const res = await fetch(`${API}${path}`, { ...fetchOptions, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const friendlyAuthMessage = res.status === 401 ? "Please sign in again." : null;
    const errorMsg = typeof data?.error === "string" ? data.error : data?.error?.message;
    const error = new Error(friendlyAuthMessage || errorMsg || "Something went wrong");
    error.status = res.status;
    throw error;
  }

  // Unwrap /api/v1 envelope {success, data[, pagination]} → return data directly
  if (data && typeof data.success === "boolean" && "data" in data) {
    if ("pagination" in data) {
      return { items: data.data, pagination: data.pagination };
    }
    return data.data;
  }
  return data;
}

function requireAuth(redirectTo = "/customer-login.html") {
  if (!getToken()) {
    window.location.href = redirectTo;
  }
}

function money(value) {
  return "Rs " + Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2
  });
}

function formatDate(value) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function foodTypeLabel(value) {
  return {
    VEG: "Veg",
    NON_VEG: "Non-veg"
  }[value] || "Veg";
}

function restaurantFoodTypeLabel(value) {
  return {
    PURE_VEG: "Pure veg",
    NON_VEG: "Non-veg",
    BOTH: "Veg & non-veg"
  }[value] || "Veg & non-veg";
}

function foodTypePillClass(value) {
  return value === "NON_VEG" ? "pill-nonveg" : "pill-veg";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function setLoading(button, loading, text) {
  if (!button) return;
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = loading;
  button.setAttribute("aria-busy", loading ? "true" : "false");
  button.classList.toggle("is-busy", loading);
  button.textContent = loading ? (text || button.dataset.defaultText) : button.dataset.defaultText;
}

function skeletonCards(count = 3, variant = "card") {
  return Array.from({ length: count }).map(() => {
    if (variant === "food") {
      return `
        <article class="card card-pad skeleton-food">
          <div class="skeleton-block skeleton-img"></div>
          <div class="skeleton-stack">
            <div class="skeleton-line wide"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
          <div class="skeleton-pill"></div>
        </article>
      `;
    }

    return `
      <article class="card card-pad skeleton-card">
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </article>
    `;
  }).join("");
}

function logout(redirectTo = "/customer-login.html") {
  sessionStorage.removeItem("avenzo_access_token");
  window.location.href = redirectTo;
}

async function initAccountMenu(targetId = "accountMenu", signOutRedirect = "/customer-login.html") {
  const target = document.getElementById(targetId);
  if (!target) return null;

  try {
    const user = await request("/api/v1/me");
    const displayName = user.name || user.email || "Avenzo user";
    target.innerHTML = `
      <div class="account" id="accountDropdown">
        <button class="btn account-trigger" onclick="toggleAccountMenu()" type="button">
          <span>${escapeHtml(displayName)}</span>
          <span>▾</span>
        </button>
        <div class="account-menu">
          <div class="account-info">
            <strong>${escapeHtml(displayName)}</strong>
            <div class="muted">${escapeHtml(user.email || "")}</div>
          </div>
          <button type="button" onclick="logout('${escapeHtml(signOutRedirect)}')">Sign out</button>
        </div>
      </div>
    `;
    return user;
  } catch {
    logout(signOutRedirect);
    return null;
  }
}

function customerNavHtml(active = "home") {
  const items = [
    { key: "home", href: "/customer.html", label: "Home" },
    { key: "restaurants", href: "/customer-restaurants.html", label: "Restaurants" },
    { key: "orders", href: "/customer-orders.html", label: "Orders" },
    { key: "profile", href: "/customer-profile.html", label: "Profile" }
  ];

  return `
    <nav class="customer-nav" id="customerNavMenu" aria-label="Customer navigation">
      <button class="customer-nav-toggle" type="button" onclick="toggleCustomerNav()" aria-expanded="false" aria-controls="customerNavLinks">
        <span aria-hidden="true">&#9776;</span>
        <span>Menu</span>
      </button>
      <div class="customer-nav-links" id="customerNavLinks">
        ${items.map(item => `
          <a class="${active === item.key ? "active" : ""}" href="${item.href}">
            <span>${item.label}</span>
          </a>
        `).join("")}
      </div>
    </nav>
  `;
}

function customerBottomNavHtml(active = "home") {
  const items = [
    { key: "home",        href: "/customer.html",             label: "Home",
      icon: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
    { key: "restaurants", href: "/customer-restaurants.html", label: "Explore",
      icon: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>` },
    { key: "orders",      href: "/customer-orders.html",      label: "Orders",
      icon: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>` },
    { key: "profile",     href: "/customer-profile.html",     label: "Profile",
      icon: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
  ];
  return `<nav class="c-bottom-nav" aria-label="Customer navigation">${
    items.map(i => `<a href="${i.href}" class="${active === i.key ? "active" : ""}" aria-label="${i.label}">${i.icon}<span>${i.label}</span></a>`).join("")
  }</nav>`;
}

// ── Admin layout helpers ──

function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  localStorage.setItem("avenzo-theme", isLight ? "light" : "dark");
  // Update all theme toggle buttons on the page
  document.querySelectorAll(".theme-toggle").forEach(btn => {
    btn.textContent = isLight ? "🌙" : "☀️";
    btn.title = isLight ? "Switch to dark mode" : "Switch to light mode";
  });
}

function adminSidebarHtml(active, restaurantId, role) {
  // Sidebar is GLOBAL navigation only — no restaurant-specific links.
  // Restaurant-specific navigation (Orders, Menu, Staff, Payments, QR)
  // is provided by the restaurant context strip on each inner page.
  const isLight = typeof document !== "undefined" && document.body.classList.contains("light");
  const globalLinks = [
    { key: "home", href: "/admin/dashboard.html", label: "Restaurants",
      icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
    ...(role === "ADMIN" ? [
      { key: "leads", href: "/admin/leads.html", label: "Partner Leads",
        icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`, badge: true }
    ] : []),
  ];

  const linksHtml = globalLinks.map(l => `
    <a href="${l.href}" class="sidebar-link ${active === l.key ? "active" : ""}" ${l.badge ? 'id="sidebarLeadsLink"' : ""}>
      ${l.icon}
      <span>${l.label}</span>
      ${l.badge ? '<span class="sidebar-badge hidden" id="sidebarLeadsBadge"></span>' : ""}
    </a>
  `).join("");

  return `
    ${linksHtml}
    <div class="sidebar-footer">
      <button class="theme-toggle" onclick="toggleTheme()" title="${isLight ? "Switch to dark mode" : "Switch to light mode"}">
        ${isLight ? "🌙" : "☀️"}
      </button>
      <span class="sidebar-footer-label">${isLight ? "Dark mode" : "Light mode"}</span>
    </div>
  `;
}

function adminBottomNavHtml(active, restaurantId, role) {
  // Bottom nav is also global-only on mobile.
  const items = [
    { key: "home",  href: "/admin/dashboard.html", label: "Home",  icon: "🏠" },
    ...(role === "ADMIN" ? [
      { key: "leads", href: "/admin/leads.html",   label: "Leads", icon: "📊", badge: true },
    ] : []),
  ];
  // When inside a restaurant context, add the restaurant-specific items to mobile nav
  if (restaurantId) {
    const q = `?restaurantId=${restaurantId}`;
    items.splice(1, 0,
      { key: "orders",   href: `/admin/orders.html${q}`,   label: "Orders",   icon: "📋" },
      { key: "menu",     href: `/admin/menu.html${q}`,     label: "Menu",     icon: "🍽️" },
    );
    if (role !== "EMPLOYEE") {
      items.splice(3, 0,
        { key: "staff",    href: `/admin/staff.html${q}`,    label: "Staff",    icon: "👥" },
        { key: "payments", href: `/admin/payments.html${q}`, label: "Payments", icon: "💳" },
      );
    }
  }
  return items.map(item => `
    <a href="${item.href}" class="admin-bnav-item ${active === item.key ? "active" : ""}">
      ${item.badge ? '<span class="admin-bnav-badge hidden" id="bnavLeadsBadge"></span>' : ""}
      <span class="admin-bnav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>
  `).join("");
}

function renderRestaurantContext(restaurant, activePage, restaurantId) {
  const el = document.getElementById("restCtxBar");
  if (!el || !restaurant) return;
  const q = `?restaurantId=${restaurantId}`;
  const pages = [
    { key: "orders",   href: `/admin/orders.html${q}`,   label: "Orders" },
    { key: "menu",     href: `/admin/menu.html${q}`,     label: "Menu" },
    { key: "staff",    href: `/admin/staff.html${q}`,    label: "Staff" },
    { key: "payments", href: `/admin/payments.html${q}`, label: "Payments" },
    { key: "qr",       href: `/qr.html${q}`,             label: "QR Cards" },
  ];
  const initial = (restaurant.name || "R")[0].toUpperCase();
  const isLive = restaurant.isActive && restaurant.subscriptionStatus !== "EXPIRED" && restaurant.subscriptionStatus !== "SUSPENDED";
  const avatarMod = !restaurant.isActive ? " paused" : (!isLive ? " expired" : "");
  const svcPill  = isLive ? "pill-success" : "pill-danger";
  const svcLabel = !restaurant.isActive ? "Paused" : restaurant.subscriptionStatus === "SUSPENDED" ? "Suspended" : restaurant.subscriptionStatus === "EXPIRED" ? "Expired" : "Live";
  el.innerHTML = `
    <div class="rest-ctx-avatar${avatarMod}">${escapeHtml(initial)}</div>
    <div class="rest-ctx-info">
      <div class="rest-ctx-name">${escapeHtml(restaurant.name)}</div>
      <div class="rest-ctx-sub">
        ${restaurant.address || restaurant.locality ? `<span>${escapeHtml(restaurant.address || restaurant.locality)}</span>` : ""}
        <span class="pill ${svcPill}" style="font-size:10.5px;padding:2px 8px">${svcLabel}</span>
      </div>
    </div>
    <nav class="rest-ctx-nav">
      ${pages.map(p => `<a href="${p.href}" class="${activePage === p.key ? "active" : ""}">${p.label}</a>`).join("")}
    </nav>
  `;
}

async function initAdminLayout(activePage = "home", restaurantId = "") {
  // Apply saved theme immediately before any rendering
  if (localStorage.getItem("avenzo-theme") === "light") {
    document.body.classList.add("light");
  }
  requireAuth("/restaurant-login.html");
  try {
    const user = await initAccountMenu("accountMenu", "/restaurant-login.html");
    if (!user) return null;
    if (user.role === "USER") {
      window.location.href = "/customer.html";
      return null;
    }
    const sidebar = document.getElementById("adminSidebar");
    const bnav = document.getElementById("adminBnav");
    if (sidebar) sidebar.innerHTML = adminSidebarHtml(activePage, restaurantId, user.role);
    if (bnav)    bnav.innerHTML    = adminBottomNavHtml(activePage, restaurantId, user.role);
    // Load leads badge for ADMIN
    if (user.role === "ADMIN") {
      request("/admin/restaurant-leads/summary").then(data => {
        const count = data.unseenNewCount || 0;
        ["sidebarLeadsBadge", "bnavLeadsBadge"].forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.textContent = count;
          el.classList.toggle("hidden", count === 0);
        });
      }).catch(() => {});
    }
    return user;
  } catch {
    window.location.href = "/restaurant-login.html";
    return null;
  }
}

async function initCustomerPage(active = "home") {
  requireAuth();
  const navTarget = document.getElementById("customerNav");
  if (navTarget) navTarget.innerHTML = customerNavHtml(active);

  const bnTarget = document.getElementById("customerBottomNav");
  if (bnTarget) bnTarget.innerHTML = customerBottomNavHtml(active);

  const user = await initAccountMenu();
  if (user && user.role === "EMPLOYEE") {
    window.location.href = "/restaurant/employee.html";
    return null;
  }
  if (user && user.role !== "USER") {
    window.location.href = "/admin/dashboard.html";
    return null;
  }
  return user;
}

function partnerNoAccessMessage() {
  return "This area is for approved Avenzo restaurant partners. Please use your customer account to browse restaurants and track orders.";
}

async function initPartnerPage() {
  requireAuth("/restaurant-login.html");
  try {
    // Partner pages must verify role before loading restaurant or admin data.
    const user = await initAccountMenu("accountMenu", "/restaurant-login.html");
    if (!user) return null;
    if (user.role === "USER") {
      toast(partnerNoAccessMessage());
      window.location.href = "/customer.html";
      return null;
    }
    return user;
  } catch {
    window.location.href = "/restaurant-login.html";
    return null;
  }
}

function toggleAccountMenu() {
  document.getElementById("accountDropdown")?.classList.toggle("open");
}

function toggleCustomerNav() {
  const nav = document.getElementById("customerNavMenu");
  if (!nav) return;
  const isOpen = nav.classList.toggle("open");
  nav.querySelector(".customer-nav-toggle")?.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

document.addEventListener("click", (event) => {
  const dropdown = document.getElementById("accountDropdown");
  if (dropdown && !dropdown.contains(event.target)) {
    dropdown.classList.remove("open");
  }

  const customerNav = document.getElementById("customerNavMenu");
  if (customerNav && !customerNav.contains(event.target)) {
    customerNav.classList.remove("open");
    customerNav.querySelector(".customer-nav-toggle")?.setAttribute("aria-expanded", "false");
  }
});
