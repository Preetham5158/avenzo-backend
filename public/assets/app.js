const API = window.location.origin;

function getToken() {
  return localStorage.getItem("token");
}

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: "Bearer " + token } : {})
  };
}

async function request(path, options = {}) {
  const headers = options.body
    ? authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) })
    : authHeaders(options.headers || {});

  const res = await fetch(`${API}${path}`, { ...options, headers });
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
    const error = new Error(data?.error || "Something went wrong");
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
  return "₹" + Number(value || 0).toLocaleString("en-IN", {
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

function logout() {
  localStorage.removeItem("token");
  window.location.href = "/customer-login.html";
}

async function initAccountMenu(targetId = "accountMenu") {
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
          <button type="button" onclick="logout()">Sign out</button>
        </div>
      </div>
    `;
    return user;
  } catch {
    logout();
    return null;
  }
}

function toggleAccountMenu() {
  document.getElementById("accountDropdown")?.classList.toggle("open");
}

document.addEventListener("click", (event) => {
  const dropdown = document.getElementById("accountDropdown");
  if (dropdown && !dropdown.contains(event.target)) {
    dropdown.classList.remove("open");
  }
});
