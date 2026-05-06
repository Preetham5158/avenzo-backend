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
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(data?.error || "Something went wrong");
  }

  return data;
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = "/login.html";
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
  button.textContent = loading ? text : button.dataset.defaultText;
}

function logout() {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
}
