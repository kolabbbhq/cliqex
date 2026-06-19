# ErrandsBuddy API — Setup Guide
Run these commands top to bottom. One time only.

---

## 1. Prerequisites (install once on your machine)

```bash
# Node.js v20+ (check with: node -v)
# Download from https://nodejs.org

# PostgreSQL (check with: psql --version)
# Download from https://postgresql.org/download

# Redis (for background queues)
# Mac:   brew install redis && brew services start redis
# Linux: sudo apt install redis-server && sudo systemctl start redis

# NestJS CLI
npm install -g @nestjs/cli

# Prisma CLI
npm install -g prisma
```

---

## 2. Clone & install

```bash
# Open this folder in VS Code, then open the terminal (Ctrl+`)

# Install all dependencies
npm install
```

---

## 3. Set up environment variables

```bash
# Copy the example env file
cp .env.example .env

# Open .env and fill in:
# - DATABASE_URL   (your local postgres credentials)
# - JWT_SECRET     (make up a long random string)
# - WHATSAPP_*     (from Meta Developer Console)
# - PAYSTACK_*     (from Paystack Dashboard)
# Leave AWS/Redis/AI keys blank for now — not needed on day 1
```

---

## 4. Create the PostgreSQL database

```bash
# Open psql
psql -U postgres

# Inside psql, run:
CREATE DATABASE errandsbuddy;
\q
```

---

## 5. Run Prisma migration (creates all tables)

```bash
# Generate Prisma client from schema
npx prisma generate

# Create and run the first migration
npx prisma migrate dev --name init

# You should see: "Your database is now in sync with your schema"
```

---

## 6. Verify tables were created

```bash
# Open Prisma Studio — visual DB browser in your browser
npx prisma studio
# Opens at http://localhost:5555
# You should see all tables: customers, orders, order_items, etc.
```

---

## 7. Start the dev server

```bash
npm run start:dev
# Server starts at http://localhost:3000
# Swagger docs at  http://localhost:3000/api/docs
# Hot reload is on — save a file and it restarts automatically
```

---

## Useful commands while building

```bash
# Anytime you change schema.prisma:
npx prisma migrate dev --name describe_your_change
npx prisma generate

# View the database visually
npx prisma studio

# Run a specific module's tests
npm run test -- --testPathPattern=orders

# Build for production
npm run build
npm run start
```

---

## VS Code extensions to install

- **Prisma** (by Prisma) — syntax highlighting for schema.prisma
- **REST Client** (by Huachao Mao) — test API endpoints from .http files
- **ESLint** — code linting
- **GitLens** — git history
- **Thunder Client** — Postman inside VS Code (alternative to REST Client)

---

## Build order — what to build next

1. ✅ Schema & project structure (done)
2. ⬜ AuthModule — JWT login for admin CRM
3. ⬜ WhatsappModule — webhook handler (everything flows from here)
4. ⬜ CustomersModule — auto-create on first message
5. ⬜ OrdersModule — create order, state machine
6. ⬜ QuotesModule — admin builds and sends quote
7. ⬜ PaymentsModule — Paystack webhook + manual confirm
8. ⬜ BuddiesModule — assign rider
9. ⬜ NotificationsModule — all WhatsApp outbound messages
10. ⬜ PricingModule — price history + AI suggestions
