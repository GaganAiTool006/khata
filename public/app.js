/**
 * ============================================================================
 *  HISAB KITAB / LEDGER WEBAPP — app.js (Frontend, Vanilla JavaScript)
 * ============================================================================
 *  Yeh file backend (server.js) se Fetch API ke zariye baat karti hai,
 *  aur DOM (index.html) ko update karti hai.
 *
 *  State kahaan store hota hai:
 *   - JWT token       -> localStorage (login ke baad, page refresh par bhi rahe)
 *   - selectedCustomer -> ek simple JS variable (memory me, current session ke liye)
 * ============================================================================
 */

// Same-origin par serve ho raha hai (Express hi index.html/app.js serve kar raha hai),
// isliye API base URL relative rakhte hain.
const API_BASE = "/api";

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let currentUser = null;
let customers = [];
let selectedCustomerId = null;

// ---------------------------------------------------------------------------
// DOM ELEMENT REFERENCES
// ---------------------------------------------------------------------------
const authSection = document.getElementById("authSection");
const appSection = document.getElementById("appSection");

const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authError = document.getElementById("authError");

const userNameLabel = document.getElementById("userNameLabel");
const logoutBtn = document.getElementById("logoutBtn");

const sumReceive = document.getElementById("sumReceive");
const sumGive = document.getElementById("sumGive");
const sumNet = document.getElementById("sumNet");

const addCustomerForm = document.getElementById("addCustomerForm");
const customerList = document.getElementById("customerList");
const noCustomers = document.getElementById("noCustomers");

const noCustomerSelected = document.getElementById("noCustomerSelected");
const ledgerView = document.getElementById("ledgerView");
const ledgerCustomerName = document.getElementById("ledgerCustomerName");
const ledgerCustomerPhone = document.getElementById("ledgerCustomerPhone");
const ledgerBalance = document.getElementById("ledgerBalance");
const deleteCustomerBtn = document.getElementById("deleteCustomerBtn");

const addTransactionForm = document.getElementById("addTransactionForm");
const transactionList = document.getElementById("transactionList");
const noTransactions = document.getElementById("noTransactions");

const toast = document.getElementById("toast");

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// Currency formatting: ₹1,234
function formatMoney(amount) {
  const rounded = Math.round(Math.abs(amount));
  return "₹" + rounded.toLocaleString("en-IN");
}

function formatDateTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
    " · " + d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

function showAuthError(message) {
  authError.textContent = message;
  authError.classList.remove("hidden");
}

function clearAuthError() {
  authError.classList.add("hidden");
}

function getToken() {
  return localStorage.getItem("hisabkitab_token");
}

function setToken(token) {
  localStorage.setItem("hisabkitab_token", token);
}

function clearToken() {
  localStorage.removeItem("hisabkitab_token");
}

/**
 * Generic wrapper around fetch() that automatically:
 *  - prefixes the API base URL
 *  - attaches the JWT Authorization header (if logged in)
 *  - parses JSON and throws a readable error on failure
 */
async function apiRequest(endpoint, options = {}) {
  const token = getToken();

  const response = await fetch(API_BASE + endpoint, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data;
}

// ---------------------------------------------------------------------------
// AUTH: TAB SWITCHING (Login <-> Signup)
// ---------------------------------------------------------------------------
tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("bg-white/20");
  tabSignup.classList.remove("bg-white/20");
  loginForm.classList.remove("hidden");
  signupForm.classList.add("hidden");
  clearAuthError();
});

tabSignup.addEventListener("click", () => {
  tabSignup.classList.add("bg-white/20");
  tabLogin.classList.remove("bg-white/20");
  signupForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
  clearAuthError();
});

// ---------------------------------------------------------------------------
// AUTH: LOGIN
// ---------------------------------------------------------------------------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthError();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const data = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    currentUser = data.user;
    await enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
});

// ---------------------------------------------------------------------------
// AUTH: SIGNUP
// ---------------------------------------------------------------------------
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthError();

  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  try {
    const data = await apiRequest("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    setToken(data.token);
    currentUser = data.user;
    await enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
});

// ---------------------------------------------------------------------------
// AUTH: LOGOUT
// ---------------------------------------------------------------------------
logoutBtn.addEventListener("click", () => {
  clearToken();
  currentUser = null;
  customers = [];
  selectedCustomerId = null;
  appSection.classList.add("hidden");
  authSection.classList.remove("hidden");
  loginForm.reset();
  signupForm.reset();
});

// ---------------------------------------------------------------------------
// SWITCH FROM AUTH SCREEN TO DASHBOARD
// ---------------------------------------------------------------------------
async function enterApp() {
  authSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  userNameLabel.textContent = currentUser ? `Namaste, ${currentUser.name}` : "";

  await Promise.all([loadCustomers(), loadDashboardSummary()]);
}

// ---------------------------------------------------------------------------
// ON PAGE LOAD: agar valid token localStorage me hai to seedha dashboard dikhao
// ---------------------------------------------------------------------------
(async function init() {
  const token = getToken();
  if (!token) return; // token nahi hai -> login screen hi dikhega (default)

  try {
    const data = await apiRequest("/auth/me");
    currentUser = data.user;
    await enterApp();
  } catch (err) {
    // token expire ho gaya ya invalid hai
    clearToken();
  }
})();

// ---------------------------------------------------------------------------
// DASHBOARD SUMMARY
// ---------------------------------------------------------------------------
async function loadDashboardSummary() {
  try {
    const data = await apiRequest("/dashboard/summary");
    sumReceive.textContent = formatMoney(data.toReceive);
    sumGive.textContent = formatMoney(data.toGive);
    sumNet.textContent = (data.netBalance >= 0 ? "" : "-") + formatMoney(data.netBalance);
    sumNet.className =
      "font-display font-bold text-lg mt-0.5 " +
      (data.netBalance >= 0 ? "text-emerald-400" : "text-red-400");
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// CUSTOMERS: LOAD + RENDER
// ---------------------------------------------------------------------------
async function loadCustomers() {
  try {
    const data = await apiRequest("/customers");
    customers = data.customers;
    renderCustomerList();
  } catch (err) {
    showToast(err.message);
  }
}

function renderCustomerList() {
  customerList.innerHTML = "";
  noCustomers.classList.toggle("hidden", customers.length > 0);

  customers.forEach((c) => {
    const isSelected = c.id === selectedCustomerId;
    const balanceColor = c.balance > 0 ? "text-red-300" : c.balance < 0 ? "text-emerald-300" : "text-white/40";
    const balanceLabel = c.balance === 0 ? "Settled" : formatMoney(c.balance);

    const card = document.createElement("button");
    card.type = "button";
    card.className =
      "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left transition " +
      (isSelected ? "bg-white/20 border border-white/30" : "hover:bg-white/10 border border-transparent");
    card.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm font-medium truncate">${escapeHtml(c.customer_name)}</p>
        <p class="text-[11px] text-white/40">${c.phone ? escapeHtml(c.phone) : "No phone"}</p>
      </div>
      <span class="text-xs font-semibold ${balanceColor} flex-shrink-0">${balanceLabel}</span>
    `;
    card.addEventListener("click", () => selectCustomer(c.id));
    customerList.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// CUSTOMERS: ADD
// ---------------------------------------------------------------------------
addCustomerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("newCustomerName");
  const phoneInput = document.getElementById("newCustomerPhone");

  try {
    const data = await apiRequest("/customers", {
      method: "POST",
      body: JSON.stringify({ customer_name: nameInput.value.trim(), phone: phoneInput.value.trim() }),
    });
    customers.unshift(data.customer);
    renderCustomerList();
    nameInput.value = "";
    phoneInput.value = "";
    showToast("Customer added");
  } catch (err) {
    showToast(err.message);
  }
});

// ---------------------------------------------------------------------------
// CUSTOMERS: DELETE
// ---------------------------------------------------------------------------
deleteCustomerBtn.addEventListener("click", async () => {
  if (!selectedCustomerId) return;
  if (!confirm("Is customer aur iski poori ledger delete karein?")) return;

  try {
    await apiRequest(`/customers/${selectedCustomerId}`, { method: "DELETE" });
    customers = customers.filter((c) => c.id !== selectedCustomerId);
    selectedCustomerId = null;
    renderCustomerList();
    ledgerView.classList.add("hidden");
    noCustomerSelected.classList.remove("hidden");
    await loadDashboardSummary();
    showToast("Customer deleted");
  } catch (err) {
    showToast(err.message);
  }
});

// ---------------------------------------------------------------------------
// CUSTOMER SELECT -> LOAD LEDGER
// ---------------------------------------------------------------------------
async function selectCustomer(customerId) {
  selectedCustomerId = customerId;
  renderCustomerList(); // to highlight the selected card

  noCustomerSelected.classList.add("hidden");
  ledgerView.classList.remove("hidden");

  await loadTransactions(customerId);
}

async function loadTransactions(customerId) {
  try {
    const data = await apiRequest(`/customers/${customerId}/transactions`);

    ledgerCustomerName.textContent = data.customer.customer_name;
    ledgerCustomerPhone.textContent = data.customer.phone || "No phone number";

    ledgerBalance.textContent = (data.balance >= 0 ? "" : "-") + formatMoney(data.balance);
    ledgerBalance.className =
      "font-display font-bold text-xl " +
      (data.balance > 0 ? "text-red-300" : data.balance < 0 ? "text-emerald-300" : "text-white/60");

    renderTransactionList(data.transactions);
  } catch (err) {
    showToast(err.message);
  }
}

function renderTransactionList(transactions) {
  transactionList.innerHTML = "";
  noTransactions.classList.toggle("hidden", transactions.length > 0);

  transactions.forEach((t) => {
    const isCredit = t.type === "credit";
    const row = document.createElement("div");
    row.className = "glass rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3";
    row.innerHTML = `
      <div class="min-w-0">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${isCredit ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300"}">
            ${isCredit ? "CREDIT · Udhaar Diya" : "DEBIT · Payment Mila"}
          </span>
        </div>
        <p class="text-sm truncate">${escapeHtml(t.description || "No description")}</p>
        <p class="text-[11px] text-white/40">${formatDateTime(t.created_at)}</p>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <span class="font-semibold text-sm ${isCredit ? "text-red-300" : "text-emerald-300"}">
          ${isCredit ? "-" : "+"}${formatMoney(t.amount)}
        </span>
        <button data-id="${t.id}" class="deleteTxnBtn text-white/30 hover:text-white/70 text-xs">✕</button>
      </div>
    `;
    transactionList.appendChild(row);
  });

  // Attach delete handlers after rows are in the DOM
  document.querySelectorAll(".deleteTxnBtn").forEach((btn) => {
    btn.addEventListener("click", () => deleteTransaction(btn.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// TRANSACTIONS: ADD (Credit / Debit — button clicked decides the type)
// ---------------------------------------------------------------------------
addTransactionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  // Find out which button was actually clicked (Credit or Debit)
  const clickedType = e.submitter ? e.submitter.dataset.type : "credit";

  const amountInput = document.getElementById("txnAmount");
  const descriptionInput = document.getElementById("txnDescription");

  if (!selectedCustomerId) return;

  try {
    await apiRequest(`/customers/${selectedCustomerId}/transactions`, {
      method: "POST",
      body: JSON.stringify({
        amount: Number(amountInput.value),
        type: clickedType,
        description: descriptionInput.value.trim(),
      }),
    });

    amountInput.value = "";
    descriptionInput.value = "";

    await loadTransactions(selectedCustomerId); // refresh ledger + balance
    await loadCustomers();                       // refresh sidebar balances
    await loadDashboardSummary();                // refresh top summary
    showToast("Transaction saved");
  } catch (err) {
    showToast(err.message);
  }
});

// ---------------------------------------------------------------------------
// TRANSACTIONS: DELETE
// ---------------------------------------------------------------------------
async function deleteTransaction(transactionId) {
  if (!confirm("Yeh transaction delete karein?")) return;

  try {
    await apiRequest(`/transactions/${transactionId}`, { method: "DELETE" });
    await loadTransactions(selectedCustomerId);
    await loadCustomers();
    await loadDashboardSummary();
    showToast("Transaction deleted");
  } catch (err) {
    showToast(err.message);
  }
}

// ---------------------------------------------------------------------------
// SMALL UTILITY: escape user-entered text before inserting into innerHTML
// (prevents basic HTML/script injection from names, descriptions, etc.)
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
