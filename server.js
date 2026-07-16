/**
 * ============================================================================
 *  HISAB KITAB / LEDGER WEBAPP — server.js
 * ============================================================================
 *  Yeh Express backend teen kaam karta hai:
 *   1) User Authentication (Signup / Login) — JWT token based
 *   2) Customers CRUD — har user apne alag customers manage karta hai
 *   3) Transactions CRUD — har customer ka credit/debit ledger
 *
 *  Database: SQLite (better-sqlite3) — koi separate DB server install
 *  karne ki zaroorat nahi, ek local file (hisabkitab.db) ban jaati hai.
 *
 *  Business logic convention (important):
 *   - type = 'credit'  -> Aapne customer ko udhaar diya (customer par balance badhta hai)
 *   - type = 'debit'   -> Customer ne aapko payment di / wapas kiya (balance ghatta hai)
 *   - Customer ka current balance = SUM(credit) - SUM(debit)
 *     balance > 0  => customer par aapka paisa baaki hai (aapko milna hai)
 *     balance < 0  => aapne extra le liya / customer ka advance hai
 * ============================================================================
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const fs = require("fs");
const initSqlJs = require("sql.js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "hisab_kitab_super_secret_key_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// ---------------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------------
app.use(cors());                                   // allow frontend (even on a different port) to call this API
app.use(express.json());                            // parse JSON request bodies
app.use(express.static(path.join(__dirname, "public"))); // serve index.html + app.js

// ---------------------------------------------------------------------------
// DATABASE SETUP (SQLite via sql.js — works in Node.js without native compilation)
// ---------------------------------------------------------------------------
const DB_FILE = path.join(__dirname, "hisabkitab.db");
let db = null;

async function initializeDatabase() {
  const SQL = await initSqlJs();
  
  let data = null;
  if (fs.existsSync(DB_FILE)) {
    data = fs.readFileSync(DB_FILE);
  }
  
  db = new SQL.Database(data);
  
  // Create tables agar pehle se exist nahi karte
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      email    TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      phone         TEXT,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      amount      REAL NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
      description TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `);
  
  saveDatabase();
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  }
}

// ---------------------------------------------------------------------------
// AUTH MIDDLEWARE — checks the "Authorization: Bearer <token>" header
// ---------------------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, name, email }
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token." });
  }
}

// Helper: ensure the logged-in user actually owns this customer before
// letting them read/write its transactions.
function getOwnedCustomerOrNull(customerId, userId) {
  try {
    const stmt = db.prepare("SELECT * FROM customers WHERE id = ? AND user_id = ?");
    stmt.bind([customerId, userId]);
    const hasRow = stmt.step();
    const result = hasRow ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  } catch (err) {
    return null;
  }
}

// Helper: execute query and get all results
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: execute query and get one result
function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const hasRow = stmt.step();
  const result = hasRow ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

// Helper: execute insert/update/delete
function execute(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDatabase();
  return { changes: db.getRowsModified() };
}

// ============================================================================
// AUTH ROUTES
// ============================================================================

// POST /api/auth/signup — naya user register karta hai
app.post("/api/auth/signup", (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const existing = queryOne("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    // Password ko hash karke store karte hain — kabhi plain text nahi
    const hashedPassword = bcrypt.hashSync(password, 10);

    execute(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name.trim(), email.toLowerCase().trim(), hashedPassword]
    );

    // Get the inserted user
    const row = queryOne("SELECT id, name, email FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    const user = row;
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.status(201).json({ message: "Account created successfully.", token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong while creating your account." });
  }
});

// POST /api/auth/login — existing user login karta hai
app.post("/api/auth/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const row = queryOne("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (!row) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const passwordMatches = bcrypt.compareSync(password, row.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = { id: row.id, name: row.name, email: row.email };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.json({ message: "Login successful.", token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong while logging in." });
  }
});

// GET /api/auth/me — currently logged-in user ki details (token verify karne ke liye,
// jaise page reload hone par frontend check karta hai ki session valid hai ya nahi)
app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ============================================================================
// CUSTOMER ROUTES  (sab routes protected hain — authenticateToken middleware)
// ============================================================================

// GET /api/customers — logged-in user ke saare customers, unke current balance ke saath
app.get("/api/customers", authenticateToken, (req, res) => {
  try {
    const customers = queryAll(
      `SELECT
         c.id, c.customer_name, c.phone, c.created_at,
         COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN t.amount ELSE 0 END), 0) AS balance
       FROM customers c
       LEFT JOIN transactions t ON t.customer_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );

    res.json({ customers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not fetch customers." });
  }
});

// POST /api/customers — naya customer add karta hai
app.post("/api/customers", authenticateToken, (req, res) => {
  try {
    const { customer_name, phone } = req.body;
    if (!customer_name || !customer_name.trim()) {
      return res.status(400).json({ error: "Customer name is required." });
    }

    execute(
      "INSERT INTO customers (user_id, customer_name, phone) VALUES (?, ?, ?)",
      [req.user.id, customer_name.trim(), phone ? phone.trim() : null]
    );

    const customers = queryAll("SELECT * FROM customers WHERE user_id = ? ORDER BY id DESC LIMIT 1", [req.user.id]);
    const customer = customers[0];
    res.status(201).json({ message: "Customer added.", customer: { ...customer, balance: 0 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add customer." });
  }
});

// DELETE /api/customers/:id — customer aur uske saare transactions delete karta hai
app.delete("/api/customers/:id", authenticateToken, (req, res) => {
  try {
    const customer = getOwnedCustomerOrNull(req.params.id, req.user.id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    execute("DELETE FROM customers WHERE id = ?", [customer.id]);
    res.json({ message: "Customer deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete customer." });
  }
});

// ============================================================================
// TRANSACTION ROUTES
// ============================================================================

// GET /api/customers/:customerId/transactions — ek customer ki poori ledger history
app.get("/api/customers/:customerId/transactions", authenticateToken, (req, res) => {
  try {
    const customer = getOwnedCustomerOrNull(req.params.customerId, req.user.id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    const transactions = queryAll(
      "SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC, id DESC",
      [customer.id]
    );

    // Running balance bhi calculate karke bhej dete hain, taaki frontend ko dobara add/subtract na karna pade
    const balance = transactions.reduce(
      (sum, t) => sum + (t.type === "credit" ? t.amount : -t.amount),
      0
    );

    res.json({ customer, transactions, balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not fetch transactions." });
  }
});

// POST /api/customers/:customerId/transactions — nayi entry (udhaar diya / payment mila)
app.post("/api/customers/:customerId/transactions", authenticateToken, (req, res) => {
  try {
    const customer = getOwnedCustomerOrNull(req.params.customerId, req.user.id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    const { amount, type, description } = req.body;
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: "A valid amount greater than 0 is required." });
    }
    if (!["credit", "debit"].includes(type)) {
      return res.status(400).json({ error: "Type must be either 'credit' or 'debit'." });
    }

    execute(
      "INSERT INTO transactions (customer_id, amount, type, description) VALUES (?, ?, ?, ?)",
      [customer.id, numericAmount, type, description ? description.trim() : null]
    );

    const transactions = queryAll(
      "SELECT * FROM transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 1",
      [customer.id]
    );
    const transaction = transactions[0];
    res.status(201).json({ message: "Transaction saved.", transaction });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save transaction." });
  }
});

// DELETE /api/transactions/:id — ek galat entry delete karne ke liye
app.delete("/api/transactions/:id", authenticateToken, (req, res) => {
  try {
    const transaction = queryOne("SELECT * FROM transactions WHERE id = ?", [req.params.id]);
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found." });
    }
    // Ownership check: yeh transaction us customer ka hona chahiye jo isi user ka hai
    const customer = getOwnedCustomerOrNull(transaction.customer_id, req.user.id);
    if (!customer) {
      return res.status(403).json({ error: "You do not have permission to delete this transaction." });
    }

    execute("DELETE FROM transactions WHERE id = ?", [transaction.id]);
    res.json({ message: "Transaction deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete transaction." });
  }
});

// ============================================================================
// DASHBOARD SUMMARY — top-level totals across all customers of this user
// ============================================================================
app.get("/api/dashboard/summary", authenticateToken, (req, res) => {
  try {
    const rows = queryAll(
      `SELECT
         COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN t.amount ELSE 0 END), 0) AS balance
       FROM customers c
       LEFT JOIN transactions t ON t.customer_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id`,
      [req.user.id]
    );

    let toReceive = 0; // total jo customers par baaki hai (balance > 0)
    let toGive = 0;    // total jo aapko customers ko wapas dena hai (balance < 0)

    rows.forEach((r) => {
      if (r.balance > 0) toReceive += r.balance;
      else toGive += Math.abs(r.balance);
    });

    const countResult = queryOne("SELECT COUNT(*) AS count FROM customers WHERE user_id = ?", [req.user.id]);
    const customerCount = countResult ? countResult.count : 0;

    res.json({
      toReceive,
      toGive,
      netBalance: toReceive - toGive,
      customerCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not fetch dashboard summary." });
  }
});

// ---------------------------------------------------------------------------
// Fallback route — SPA-style: koi bhi non-API route hit ho to index.html serve karo
// ---------------------------------------------------------------------------
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------
(async () => {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`✅ Hisab Kitab server running at http://localhost:${PORT}`);
  });
})();
