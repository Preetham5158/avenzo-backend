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
