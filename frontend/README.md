# Chalin 03 Sales & Inventory Management System

A full-stack sales, inventory, debt, purchase, expense, reporting, stock transfer, stock movement ledger, SMS, and business management system for **Chalin 03 Company Limited**.

Prepared by: **Eugene Amankwah Appiah**

Business location reference: **Dunkwa Police Barrier**

---

## System Overview

The Chalin 03 Sales & Inventory Management System helps the business manage spare parts sales, inventory, stock movements, customer debts, purchases, expenses, reports, exports, daily closing, and store-to-store stock transfers.

The system is designed for a spare-parts business with more than one store. Each store can manage its own stock, sales, debts, expenses, and reports while the backend protects store data separation.

---

## Technology Stack

The system is built with:

- React + Vite frontend
- Node.js + Express backend
- MySQL database
- JWT authentication
- Role-based access control
- ExcelJS for Excel exports
- PDFKit for PDF receipts and transfer notes
- Arkesel SMS integration
- WhatsApp receipt readiness through Meta Cloud API
- Railway backend hosting
- Cloudflare Pages frontend hosting

---

## Main Features

### Authentication and User Roles

- User login and authentication
- JWT-secured backend API
- Admin, Manager, and Cashier roles
- Role-based page access
- Admin-only dangerous actions
- Store-based login and selected store protection

### Store / Branch Support

- Multiple store support
- Selected store shown across pages
- Product records filtered by selected store
- Sales filtered by selected store
- Debts filtered by selected store
- Reports filtered by selected store
- Exports generated for selected store only
- Store-to-store stock transfer workflow

### Product and Inventory Management

- Add products
- Edit products
- Disable/delete products
- Product name
- Excavator type / size
- Category
- Cost price
- Selling price
- Quantity
- Low-stock threshold
- Barcode
- Image URL
- Low-stock highlighting
- Low-stock / restock list

### Stock Adjustments

- Increase stock
- Decrease stock
- Set exact stock
- Required stock adjustment reason
- Old quantity and new quantity tracking
- Staff name tracking
- Product-specific adjustment history
- Recent stock adjustment records on Products page
- Stock adjustment Excel export

### Product Stock Movement Ledger

The system includes a professional stock movement ledger inside the existing Products page.

No separate page is needed.

The ledger shows each product’s full stock history, including:

- Opening stock
- Current stock
- Purchases added
- Sales removed
- Returns added
- Stock adjustments
- Transfers out
- Transfers in
- Running stock balance
- Movement reference
- Date and staff / source details

The ledger is useful for auditing why a product’s current stock is what it is.

### Sales

- New sale recording
- Multiple sale items
- Customer name and phone
- Walk-in customer support
- Discount support
- Cash sales
- MoMo sales
- Bank sales
- Mixed payment support
- Credit sales / debt sales
- Receipt number generation
- Sales history
- PDF receipt download
- Void/cancel sales
- Voided sales excluded from valid sales totals

### Receipts

- Professional PDF receipt
- Business name
- Business address
- Business phone
- MoMo number
- Receipt number
- Customer details
- Staff name
- Item table
- Subtotal
- Discount
- VAT / tax
- Total
- Amount paid
- Balance
- Debt information
- Receipt footer

### Customer Debts

- Debt records from credit sales
- Customer name and phone
- Amount owed
- Amount paid
- Balance
- Debt status
- Debt payment recording
- Debt payment history
- Debt payment receipts
- Customer statement / account history export

### Purchases and Suppliers

- Supplier management
- Purchase recording
- Purchase items
- Supplier balances
- Purchase payment history
- Supplier payment tracking
- Purchase Excel export

### Returns

- Returned item records
- Return quantity
- Return reason
- Linked sales receipt where available
- Returns Excel export

### Expenses

- Expense category
- Description
- Amount
- Expense date
- Staff who recorded the expense
- Expenses Excel export

### Stock Transfers Between Stores

The system supports store-to-store stock transfers.

Workflow:

1. Manager/Admin creates transfer request
2. System checks source store stock
3. Transfer is approved
4. Source store dispatches stock
5. Destination store receives stock
6. Source store quantity reduces on dispatch
7. Destination store quantity increases on receive
8. Transfer history is saved for audit

Important rule:

Approval does not move stock.  
Dispatch reduces source store stock.  
Receive increases destination store stock.

Stock transfer features include:

- Transfer request
- Transfer approval
- Dispatch
- Receive
- Cancel / reject support
- Transfer items
- Transfer notes
- Source quantity before and after
- Destination quantity before and after
- Stock transfer PDF note
- Stock transfer reports
- Stock transfer Excel export

### Reports

The Reports page includes business summaries such as:

- Sales summary
- Profit summary
- Expenses summary
- Debt summary
- Low-stock report
- Payment breakdown
- Top products
- Stock transfer summary
- Stock adjustment summary
- Recent stock transfers
- Recent stock adjustments

### Advanced Accounting Intelligence

The system includes an advanced accounting intelligence section for higher-level business review.

It helps with:

- Stock and accounting review
- Profit checking
- Possible issue detection
- Business warnings
- Ledger-style intelligence
- Audit support
- Management decision support

### Daily Closing

Daily closing helps compare expected money against counted money.

It includes:

- Sales total
- Debt payments
- Expenses
- Expected cash
- Expected MoMo
- Expected bank
- Expected total
- Counted cash
- Counted MoMo
- Counted bank
- Counted total
- Difference
- Notes
- Staff who closed the day

### Excel Exports

The system supports Excel exports for:

- Products
- Low stock / restock list
- Stock adjustments
- Stock transfers
- Stock movement ledger
- Sales
- Debts
- Debt payments
- Customer statement
- Expenses
- Purchases
- Returns
- Daily closings

### SMS Center

The system includes SMS features through Arkesel.

SMS features include:

- Owner security alerts
- Customer SMS support
- Bulk SMS support
- SMS templates
- SMS status tracking
- Failed SMS retry support
- SMS logs
- SMS filters
- SMS CSV export
- Live SMS safety confirmation

### WhatsApp Receipt Readiness

The system has WhatsApp receipt code prepared for Meta Cloud API.

Until Meta setup is complete, keep this disabled in production:

```env
WHATSAPP_RECEIPT_ENABLED=false
```

When Meta Cloud API is ready, the backend can be configured with:

```env
WHATSAPP_RECEIPT_ENABLED=true
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_meta_access_token
WHATSAPP_TEMPLATE_NAME=receipt_notification
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_GRAPH_VERSION=v20.0
```

### Backup and Maintenance

The system includes backup support and maintenance planning.

Safety reminders:

- Do not commit real `.env` files
- Do not commit database dumps with real business data
- Do not run destructive schema reset on production data
- Use migrations for live database changes
- Keep regular backups

---

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
│   │   └── main.jsx
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

---

## Requirements

Install these before running the project:

- Node.js 20 or newer
- MySQL Server
- MySQL Workbench
- Git
- VS Code

---

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

Use this structure for local development:

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
```

Do not upload the real `.env` file to GitHub.

---

## Database Setup

Open MySQL Workbench and run:

```text
database/schema.sql
```

Important:

The main `schema.sql` recreates the database from scratch. It can delete existing data before creating fresh tables.

Do not run the full reset schema on a live production database that already has real business data.

For production updates, use migration files instead of resetting the database.

After creating the database, create the admin account:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm run create-admin
```

---

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

---

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

---

## Start Frontend Locally

```bash
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm run dev
```

Frontend local address:

```text
http://localhost:5173
```

---

## Build Frontend for Production

```bash
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm run build
```

The production build will be created in:

```text
frontend/dist
```

---

## Important Local URLs

```text
Frontend:
http://localhost:5173

Backend:
http://localhost:5000

Backend health:
http://localhost:5000/api/health
```

---

## Useful Local Test Commands

Check backend syntax:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
node --check server.js
```

Check a backend route file:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
node --check routes\productRoutes.js
node --check routes\exportRoutes.js
node --check routes\reportRoutes.js
```

Build frontend:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm run build
```

---

## Deployment Plan

The deployment process follows this order:

1. Push the project to GitHub
2. Create an online MySQL database
3. Import the required schema or migrations
4. Deploy the backend API
5. Add backend production environment variables
6. Deploy the frontend
7. Add frontend production environment variable
8. Connect the main domain to the frontend
9. Connect API subdomain to the backend
10. Enable HTTPS/SSL
11. Create the real admin account
12. Test the full online system

---

## Production Environment Example

Backend production environment example:

```env
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://www.chalin03.com

DB_HOST=your-online-mysql-host
DB_PORT=3306
DB_USER=your-online-db-user
DB_PASSWORD=your-online-db-password
DB_NAME=chalin03_db
DB_CONNECTION_LIMIT=10
DB_SSL=true

JWT_SECRET=use_a_very_long_random_secret_key_here
```

Frontend production environment example:

```env
VITE_API_URL=https://api.chalin03.com/api
```

Important:

Vite environment variables are build-time variables.  
After changing `VITE_API_URL`, rebuild and redeploy the frontend.

---

## SMS Environment Example

```env
SMS_ENABLED=true
SMS_PROVIDER=arkesel
SMS_SENDER_ID=your_approved_sender_id
SMS_ARKESEL_API_KEY=your_arkesel_api_key
SMS_ARKESEL_BASE_URL=https://sms.arkesel.com/api/v2/sms/send
SMS_TIMEOUT_MS=15000
SMS_MAX_BULK_RECIPIENTS=200
```

Never commit the real SMS API key.

---

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
database dumps with real business data
temporary ZIP update files
```

Safe files to commit:

```text
.env.example
database/schema.sql
database migration files
source code
README.md
```

---

## Useful Git Commands

Check Git status:

```bash
git status
```

Add and commit selected changes:

```bash
git add README.md
git commit -m "Update README with latest inventory features"
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

---

## Current Major Completed Upgrades

- Multi-store support
- Stock transfers between stores
- Stock transfer PDF note
- Stock transfer reports
- Stock transfer Excel export
- Recent stock adjustment records
- Product stock movement ledger
- Stock movement ledger export
- Advanced accounting intelligence
- SMS Center
- WhatsApp receipt readiness
- Daily closing
- Customer statement export
- Professional Excel exports

---

## Author

Developed for **Chalin 03 Company Limited**.

Project owner: **Eugene Amankwah Appiah**.