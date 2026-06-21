# Chalin 03 Sales & Inventory Management System

A full-stack sales, inventory, debt, purchase, expense, reporting, and business management system for **Chalin 03 Company Limited**.

The system is built with:

* React + Vite frontend
* Node.js + Express backend
* MySQL database
* JWT authentication
* Excel exports
* PDF receipts
* Role-based access control

## Main Features

* User login and authentication
* Admin, Manager, and Cashier roles
* Product and inventory management
* Stock adjustment history
* Low stock / restock list
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
* Excel exports
* Activity log
* Backup support
* System settings

## Project Structure

```text
chalin03-system/
├── backend/
│   ├── config/
│   ├── middleware/
│   ├── routes/
│   ├── scripts/
│   ├── server.js
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   ├── package.json
│   └── .env.example
│
├── database/
│   └── schema.sql
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
```

Do not upload the real `.env` file to GitHub.

## Database Setup

Open MySQL Workbench and run:

```text
database/schema.sql
```

Important: the schema recreates the database from scratch. It deletes existing data before creating fresh tables.

After creating the database, create the admin account:

```bash
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm run create-admin
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

## Deployment Plan

The deployment process will follow this order:

1. Push the project to GitHub
2. Create an online MySQL database
3. Import `database/schema.sql`
4. Deploy the backend API
5. Add backend production environment variables
6. Deploy the frontend
7. Add frontend production environment variable
8. Buy a domain
9. Connect the domain to the frontend
10. Connect an API subdomain to the backend
11. Enable HTTPS/SSL
12. Create the real admin account
13. Test the full online system

## Example Production Environment

Backend production `.env` example:

```env
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://www.yourdomain.com

DB_HOST=your-online-mysql-host
DB_PORT=3306
DB_USER=your-online-db-user
DB_PASSWORD=your-online-db-password
DB_NAME=chalin03_db
DB_CONNECTION_LIMIT=10
DB_SSL=true

JWT_SECRET=use_a_very_long_random_secret_key_here
```

Frontend production `.env` example:

```env
VITE_API_URL=https://api.yourdomain.com/api
```

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
database dumps with real business data
```

Safe files to commit:

```text
.env.example
database/schema.sql
source code
README.md
```

## Useful Commands

Check Git status:

```bash
git status
```

Add and commit changes:

```bash
git add .
git commit -m "Your commit message"
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

## Author

Developed for **Chalin 03 Company Limited**.

Project owner: **Eugene Amankwah Appiah**
