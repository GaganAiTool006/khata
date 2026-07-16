# Hisab Kitab — Ledger WebApp

Node.js + Express backend, SQLite database, and a vanilla-JS + Tailwind
(glassmorphism theme) frontend for tracking customer udhaar (credit) and
payments (debit).

## Project structure

```
hisab-kitab/
├── server.js          # Express API, SQLite setup, JWT auth, all routes
├── package.json
├── .env.example        # copy to .env and adjust
├── hisabkitab.db        # created automatically on first run
└── public/
    ├── index.html       # glassmorphism dashboard UI
    └── app.js            # frontend logic (Fetch API calls to the backend)
```

## Setup

```bash
cd hisab-kitab
npm install
cp .env.example .env      # optional — sensible defaults are already built in
npm start                  # or: npm run dev  (auto-restarts with nodemon)
```

Then open **http://localhost:5000** in your browser.

## How the ledger logic works

Each transaction has a `type` of `credit` or `debit`:

- **credit** = you gave the customer goods/money on udhaar → increases what
  they owe you.
- **debit** = the customer paid you back → decreases what they owe you.
- A customer's balance = `SUM(credit) − SUM(debit)`.
  - Balance **> 0** → the customer owes you (shown in red, "aapko milega").
  - Balance **< 0** → you owe the customer / they've overpaid (shown in
    green).

## API overview

| Method | Route                                   | Auth | Description               |
|--------|------------------------------------------|------|----------------------------|
| POST   | `/api/auth/signup`                        | –    | Create account              |
| POST   | `/api/auth/login`                         | –    | Log in, returns JWT         |
| GET    | `/api/auth/me`                            | ✅   | Verify current session      |
| GET    | `/api/customers`                          | ✅   | List customers + balances   |
| POST   | `/api/customers`                          | ✅   | Add a customer               |
| DELETE | `/api/customers/:id`                      | ✅   | Delete a customer + ledger  |
| GET    | `/api/customers/:id/transactions`         | ✅   | Ledger for one customer     |
| POST   | `/api/customers/:id/transactions`         | ✅   | Add a transaction           |
| DELETE | `/api/transactions/:id`                    | ✅   | Delete a transaction        |
| GET    | `/api/dashboard/summary`                   | ✅   | Totals across all customers |

Protected routes need `Authorization: Bearer <token>` (the token you get
back from signup/login — the frontend stores this in `localStorage` and
attaches it automatically).

## Notes for production use

- Change `JWT_SECRET` in `.env` to a long random value.
- `hisabkitab.db` is a single file — back it up regularly or move to a
  hosted Postgres/MySQL database for multi-instance deployments.
- Passwords are hashed with bcrypt before being stored — never stored in
  plain text.
