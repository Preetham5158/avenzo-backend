const API = window.location.origin;

// sessionStorage keeps auth tab-isolated: a guest QR tab stays guest even when another tab is logged in.
function getToken() {
  return sessionStorage.getItem("token");
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
    const error = new Error(friendlyAuthMessage || data?.error || "Something went wrong");
    error.status = res.status;
    throw error;
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
  sessionStorage.removeItem("token");
  window.location.href = redirectTo;
}

async function initAccountMenu(targetId = "accountMenu", signOutRedirect = "/customer-login.html") {
  const target = document.getElementById(targetId);
  if (!target) return null;

  try {
    const user = await request("/auth/me");
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
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = isLight ? "🌙" : "☀️";
}

function adminSidebarHtml(active, restaurantId, role) {
  const q = restaurantId ? `?restaurantId=${restaurantId}` : "";
  const links = [
    { key: "home",     href: "/admin/dashboard.html",       label: "Home",     icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
    { key: "orders",   href: `/admin/orders.html${q}`,      label: "Orders",   icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>` },
    { key: "menu",     href: `/admin/menu.html${q}`,        label: "Menu",     icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>` },
    ...(role !== "EMPLOYEE" ? [
      { key: "staff",    href: `/admin/staff.html${q}`,       label: "Staff",    icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
      { key: "payments", href: `/admin/payments.html${q}`,    label: "Payments", icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>` },
    ] : []),
    ...(restaurantId ? [
      { key: "qr", href: `/qr.html${q}`, label: "QR Cards", icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="5" y="5" width="3" height="3"/><rect x="16" y="5" width="3" height="3"/><rect x="5" y="16" width="3" height="3"/><path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 20h3"/></svg>` },
    ] : []),
    ...(role === "ADMIN" ? [
      { key: "leads",    href: "/admin/leads.html",            label: "Leads",    icon: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`, badge: true },
    ] : []),
  ];
  return links.map(l => `
    <a href="${l.href}" class="sidebar-link ${active === l.key ? "active" : ""}" ${l.badge ? 'id="sidebarLeadsLink"' : ""}>
      ${l.icon}
      <span>${l.label}</span>
      ${l.badge ? '<span class="sidebar-badge hidden" id="sidebarLeadsBadge"></span>' : ""}
    </a>
  `).join("");
}

function adminBottomNavHtml(active, restaurantId, role) {
  const q = restaurantId ? `?restaurantId=${restaurantId}` : "";
  const items = [
    { key: "home",     href: "/admin/dashboard.html",    label: "Home",     icon: "🏠" },
    { key: "orders",   href: `/admin/orders.html${q}`,   label: "Orders",   icon: "📋" },
    { key: "menu",     href: `/admin/menu.html${q}`,     label: "Menu",     icon: "🍽️" },
    ...(role !== "EMPLOYEE" ? [
      { key: "staff",    href: `/admin/staff.html${q}`,   label: "Staff",    icon: "👥" },
      { key: "payments", href: `/admin/payments.html${q}`,label: "Payments", icon: "💳" },
    ] : []),
    ...(restaurantId ? [
      { key: "qr", href: `/qr.html${q}`, label: "QR", icon: "📱" },
    ] : []),
    ...(role === "ADMIN" ? [
      { key: "leads",    href: "/admin/leads.html",        label: "Leads",    icon: "📊", badge: true },
    ] : []),
  ];
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
    // Inject theme toggle button into topbar
    const topbarRight = document.querySelector(".admin-topbar-right");
    if (topbarRight && !document.getElementById("themeToggleBtn")) {
      const isLight = document.body.classList.contains("light");
      const btn = document.createElement("button");
      btn.id = "themeToggleBtn";
      btn.className = "theme-toggle";
      btn.title = isLight ? "Switch to dark mode" : "Switch to light mode";
      btn.textContent = isLight ? "🌙" : "☀️";
      btn.setAttribute("onclick", "toggleTheme()");
      topbarRight.insertBefore(btn, topbarRight.firstChild);
    }
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
