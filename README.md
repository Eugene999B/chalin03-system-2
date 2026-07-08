# Chalin 03 Sales & Inventory Management System

A full-stack sales, inventory, debt, purchase, expense, reporting, stock transfer, SMS, audit, and business management system for **Chalin 03 Company Limited**.

The system is built with:

* React + Vite frontend
* Node.js + Express backend
* MySQL database
* JWT authentication
* Excel exports
* PDF receipts
* PDF stock transfer notes
* Role-based access control
* SMS integration
* Store-based records
* PWA install support

## Main Features

* User login and authentication
* Store selection during login
* Admin, Manager, Cashier, and System Administrator roles
* Product and inventory management
* Store-based product records
* Stock adjustment history
* Recent stock adjustment records
* Damaged, lost, wrong entry, and physical count stock corrections
* Low stock / restock list
* Two-store stock transfer workflow
* Stock transfer approval, dispatch, and receiving
* Stock transfer history
* Stock transfer PDF / Transfer Note
* Sales and receipt generation
* Sales history
* Sale discount support
* Void/cancel sales
* Customer debts
* Debt payment tracking
* Debt payment receipts
* Customer statement / account history
* Purchases and supplier payment tracking
* Purchase payment history
* Returns
* Expenses
* Reports and dashboard summaries
* Daily closing
* Advanced Accounting Intelligence
* Excel exports
* Activity log
* Backup support
* Restore support
* System settings
* SMS Center
* Owner SMS alerts
* WhatsApp receipt readiness
* Help / User Guide inside the app
* PWA install support

## Project Structure

```text
chalin03-system/
├── backend/
│   ├── config/
│   ├── middleware/
│   ├── routes/
│   ├── scripts/
│   ├── services/
│   ├── server.js
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── context/
│   │   ├── pages/
│   │   └── App.jsx
│   ├── package.json
│   └── .env.example
│
├── database/
│   ├── schema.sql
│   └── migration files
│
├── README.md
└── .gitignore
```

## Requirements

Install these before running the project:

* Node.js 20 or newer
* MySQL Server
* MySQL Workbench
* Git
* VS Code

## Backend Setup

Open terminal:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm install
```

Create a backend environment file:

```text
backend/.env
```

Use this structure:

```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173

DB_HOST=localhost
DB_PORT=3306
DB_USER=chalin03_user
DB_PASSWORD=your_mysql_password_here
DB_NAME=chalin03_db
DB_CONNECTION_LIMIT=10
DB_SSL=false

JWT_SECRET=change_this_to_a_very_long_secret_key

SMS_ENABLED=false
SMS_PROVIDER=arkesel
SMS_SENDER_ID=CHALIN03
SMS_ARKESEL_API_KEY=your_arkesel_api_key_here
SMS_ARKESEL_BASE_URL=https://sms.arkesel.com/api/v2/sms/send
SMS_TIMEOUT_MS=15000
SMS_MAX_BULK_RECIPIENTS=200

WHATSAPP_RECEIPT_ENABLED=false
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_TEMPLATE_NAME=receipt_notification
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_GRAPH_VERSION=v20.0
```

Do not upload the real `.env` file to GitHub.

## Database Setup

Open MySQL Workbench and run:

```text
database/schema.sql
```

Important: the schema recreates the database from scratch. It deletes existing data before creating fresh tables.

Do **not** run `schema.sql` on production after real business data has started.

After creating the database, create the admin account:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm run create-admin
```

## Database Migrations

For new features added after the first schema, use migration files instead of resetting the whole database.

Examples:

```text
database/stock_transfer_migration.sql
database/stock_adjustment_migration.sql
```

For local database:

```sql
USE chalin03_db;
```

For Railway production database:

```sql
USE railway;
```

## Start Backend Locally

For development:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm run dev
```

For production-style local testing:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm start
```

Backend health check:

```text
http://localhost:5000/api/health
```

## Frontend Setup

Open another terminal:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm install
```

Create a frontend environment file:

```text
frontend/.env
```

Use this:

```env
VITE_API_URL=http://localhost:5000/api
```

## Start Frontend Locally

```bash
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm run dev
```

Frontend local address:

```text
http://localhost:5173
```

## Build Frontend for Production

```bash
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm run build
```

The production build will be created in:

```text
frontend/dist
```

## Important Local URLs

```text
Frontend:
http://localhost:5173

Backend:
http://localhost:5000

Backend health:
http://localhost:5000/api/health
```

## Important Live URLs

```text
Frontend:
https://www.chalin03.com

Backend API:
https://api.chalin03.com/api
```

## Store-Based Workflow

The system supports multiple stores.

Most daily records are connected to the selected store, including:

* Products
* Sales
* Debts
* Purchases
* Expenses
* Returns
* Reports
* Daily closing
* Stock adjustments
* Stock transfers

To work in another store:

```text
Logout → choose correct store on login page → login again
```

Always confirm the selected store before recording sales, purchases, expenses, stock adjustments, or transfers.

## Stock Adjustment Workflow

Stock adjustment is used for:

* Damaged stock
* Lost stock
* Physical count correction
* Wrong entry correction
* Stock count update
* Other manual corrections

Workflow:

```text
Products → Adjust Stock → choose Increase, Decrease, or Set Exact Stock → enter quantity → enter reason → Save Adjustment
```

The system records:

* Product
* Store
* Adjustment type
* Quantity
* Old stock
* New stock
* Reason
* User
* Date and time

Recent adjustment records show at the bottom of the Products page.

## Stock Transfer Workflow

Stock transfer is used to move stock between stores.

Workflow:

```text
Request → Approve → Dispatch → Receive
```

Meaning:

```text
Request:
Creates a transfer request.

Approve:
Management approves the transfer.

Dispatch:
Source store stock is reduced.

Receive:
Destination store stock is increased.
```

The system keeps full transfer history and can generate a PDF Transfer Note.

## Important API Routes

Examples of important backend routes:

```text
GET    /api/health

POST   /api/auth/login

GET    /api/products
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id

PATCH  /api/products/:id/stock-adjustment
GET    /api/products/:id/stock-adjustments
GET    /api/products/stock-adjustments/recent

GET    /api/stock-transfers
POST   /api/stock-transfers
GET    /api/stock-transfers/:id
GET    /api/stock-transfers/:id/pdf
POST   /api/stock-transfers/:id/approve
POST   /api/stock-transfers/:id/dispatch
POST   /api/stock-transfers/:id/receive
POST   /api/stock-transfers/:id/cancel
POST   /api/stock-transfers/:id/reject
```

## SMS Setup

The system supports SMS through Arkesel.

Backend SMS environment example:

```env
SMS_ENABLED=true
SMS_PROVIDER=arkesel
SMS_SENDER_ID=your_approved_sender_id
SMS_ARKESEL_API_KEY=your_real_arkesel_api_key
SMS_ARKESEL_BASE_URL=https://sms.arkesel.com/api/v2/sms/send
SMS_TIMEOUT_MS=15000
SMS_MAX_BULK_RECIPIENTS=200
```

Keep SMS keys private.

Do not commit SMS API keys to GitHub.

## WhatsApp Receipt Status

WhatsApp receipt support is prepared but should stay disabled until Meta Cloud API setup is complete.

Recommended setting for now:

```env
WHATSAPP_RECEIPT_ENABLED=false
```

When Meta setup is ready:

```env
WHATSAPP_RECEIPT_ENABLED=true
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_TEMPLATE_NAME=receipt_notification
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_GRAPH_VERSION=v20.0
```

Do not commit WhatsApp tokens to GitHub.

## Deployment Plan

The deployment process follows this order:

1. Push the project to GitHub
2. Create or connect Railway MySQL database
3. Run required database schema or migration files
4. Deploy the backend API on Railway
5. Add backend production environment variables
6. Deploy the frontend on Cloudflare
7. Add frontend production environment variable
8. Connect domain to frontend
9. Connect API subdomain to backend
10. Enable HTTPS/SSL
11. Create the real admin account
12. Test the full online system

## Example Production Environment

Backend production `.env` example:

```env
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://www.chalin03.com

DB_HOST=your_railway_mysql_host
DB_PORT=3306
DB_USER=your_railway_mysql_user
DB_PASSWORD=your_railway_mysql_password
DB_NAME=railway
DB_CONNECTION_LIMIT=10
DB_SSL=false

JWT_SECRET=use_a_very_long_random_secret_key_here

SMS_ENABLED=true
SMS_PROVIDER=arkesel
SMS_SENDER_ID=your_approved_sender_id
SMS_ARKESEL_API_KEY=your_arkesel_api_key
SMS_ARKESEL_BASE_URL=https://sms.arkesel.com/api/v2/sms/send
SMS_TIMEOUT_MS=15000
SMS_MAX_BULK_RECIPIENTS=200

WHATSAPP_RECEIPT_ENABLED=false
```

Frontend production `.env` example:

```env
VITE_API_URL=https://api.chalin03.com/api
```

Important: `VITE_API_URL` is used at build time. After changing it, rebuild and redeploy the frontend.

## Git Safety Notes

Never commit these files:

```text
.env
.env.*
node_modules
dist
backups
private files
real passwords
API keys
SMS keys
WhatsApp tokens
database dumps with real business data
temporary updater files
```

Safe files to commit:

```text
.env.example
database/schema.sql
database/migration files
source code
README.md
.gitignore
```

## Useful Commands

Check Git status:

```bash
git status
```

Add and commit selected files:

```bash
git add path/to/file
git commit -m "Your commit message"
```

Push to GitHub:

```bash
git push
```

Start backend:

```bash
cd backend
npm run dev
```

Start frontend:

```bash
cd frontend
npm run dev
```

Build frontend:

```bash
cd frontend
npm run build
```

Check backend JavaScript files:

```bash
cd backend
node --check server.js
node --check routes/productRoutes.js
node --check routes/stockTransferRoutes.js
```

## Recommended Test Before Every Push

Run backend checks:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
node --check server.js
```

Run frontend build:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm run build
```

Then commit safely:

```bash
cd C:\Users\DDK\Desktop\chalin03-system
git status
git add README.md
git commit -m "Update README with latest system features"
git push
```

Before using `git add .`, check carefully that `.env`, backups, database dumps, and private files are not included.

## Author

Developed for **Chalin 03 Company Limited**.

Project owner: **Eugene Amankwah Appiah**