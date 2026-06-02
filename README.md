# Attendance Management Backend

Node.js/Express backend for an attendance management system used by mobile employees and web/admin users. The API handles authentication, attendance punches, geofencing, leave workflows, device-change approvals, holidays, work-from-home assignments, dashboards, and attendance summaries.

## Repository

GitHub: https://github.com/aleemk-b2winfotech/server_attendance_sys

## Tech Stack

- Node.js 22
- Express.js 5
- PostgreSQL
- Prisma ORM and Prisma Migrations
- JWT access tokens and refresh tokens
- Google OAuth
- Zod request validation
- Pino logging
- Helmet, CORS, compression
- Docker and Railway deployment/testing

## Main Features

- Separate API groups for mobile and web clients:
  - `/api/v1/mobile`
  - `/api/v1/web`
- Google OAuth login for employee/admin access.
- JWT-based authentication with refresh token support.
- Role-based access for employee, manager, and admin users.
- Device binding and device-change approval flow.
- Attendance punch-in and punch-out with:
  - bound-device verification
  - office geofence validation
  - office/WFH mode handling
  - weekly-off and holiday checks
  - approved leave checks
  - duplicate punch prevention
- Leave request workflow with:
  - pending, approved, rejected, and cancelled states
  - threaded discussion between employee and manager/admin
  - proposal and acceptance flow
  - overlap validation
  - working-day and holiday exclusion logic
- Attendance summaries generated from punch records, approved leaves, and regularizations.
- Admin/manager APIs for:
  - user management
  - attendance profiles
  - attendance records
  - attendance regularization
  - leave approvals
  - device change approvals
  - holidays and holiday audit logs
  - work-from-home assignment
  - dashboard and analytics data
- Production-oriented setup with health checks, centralized error handling, structured responses, logging, Docker support, and deployment notes.

## Project Structure

```text
src/
  app.js                    Express app setup and route mounting
  server.js                 Server bootstrap and graceful shutdown
  config/                   Environment, database, logger config
  common/                   Shared helpers, errors, responses, dates, pagination
  middlewares/              Auth, validation, device, and error middleware
  routes/
    mobile/                 Mobile API routes
    web/                    Web/admin API routes
  modules/
    auth/                   OAuth, JWT, refresh token, sessions
    users/                  Users and attendance profiles
    attendance/             Punches, records, summaries, regularization
    leaves/                 Leave requests and threaded approvals
    device-changes/         Device change request workflow
    holidays/               Holiday management and logs
    work-from-home/         WFH assignment and removal
    dashboard/              Mobile and web dashboard data
prisma/
  schema.prisma             Database schema
  migrations/               Prisma migration history
scripts/
  init-admin.js             Initial admin setup
  backfill-attendance-summaries.js
```

## Getting Started

### Prerequisites

- Node.js 22 or newer
- PostgreSQL
- npm
- Google OAuth credentials for login flows

### Setup

```bash
npm install
cp .env.example .env
```

Update `.env` with your local database URL, JWT secrets, Google OAuth credentials, and CORS origin.

Generate Prisma client and run migrations:

```bash
npx prisma generate
npx prisma migrate dev
```

Start the development server:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Environment Variables

The project uses `.env.example` as a template. Important values include:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `GOOGLE_WEB_CLIENT_ID`
- `GOOGLE_WEB_CLIENT_SECRET`
- `GOOGLE_ANDROID_CLIENT_ID`
- `COMPANY_DOMAIN`
- `CORS_WEB_ORIGIN`
- `BUSINESS_TIMEZONE`
- `FULL_DAY_MINUTES`
- `HALF_DAY_MINUTES`

Do not commit real secrets or production credentials.

## Useful Scripts

```bash
npm run dev
```

Runs the server in watch mode with `.env` loaded.

```bash
npm start
```

Starts the server normally.

```bash
npm run sync:summaries
```

Backfills attendance summary records.

```bash
node scripts/init-admin.js
```

Creates the initial admin user. Update the script before using it in a new environment.

## API Overview

### Public/Auth

- `POST /api/v1/mobile/auth/google/login`
- `POST /api/v1/mobile/auth/refresh`
- `POST /api/v1/mobile/auth/logout`
- `GET /api/v1/web/auth/google/start`
- `GET /api/v1/web/auth/google/callback`
- `POST /api/v1/web/auth/refresh`
- `POST /api/v1/web/auth/logout`

### Mobile Employee APIs

- `GET /api/v1/mobile/me/profile`
- `GET /api/v1/mobile/me/dashboard`
- `GET /api/v1/mobile/me/attendance/overview`
- `POST /api/v1/mobile/me/attendance/punch-in`
- `POST /api/v1/mobile/me/attendance/punch-out`
- `GET /api/v1/mobile/me/leave-requests`
- `POST /api/v1/mobile/me/leave-requests`
- `GET /api/v1/mobile/me/device-change-requests`
- `POST /api/v1/mobile/me/device-change-requests`

### Web/Admin APIs

- `GET /api/v1/web/dashboard/overview`
- `GET /api/v1/web/users`
- `POST /api/v1/web/users`
- `PATCH /api/v1/web/users/:userId`
- `GET /api/v1/web/attendance/overview`
- `GET /api/v1/web/attendance/records`
- `GET /api/v1/web/leave-requests`
- `PATCH /api/v1/web/leave-requests/:leaveRequestId/approve`
- `PATCH /api/v1/web/leave-requests/:leaveRequestId/reject`
- `GET /api/v1/web/device-change-requests`
- `PATCH /api/v1/web/device-change-requests/:requestId/approve`
- `PATCH /api/v1/web/device-change-requests/:requestId/reject`
- `GET /api/v1/web/holidays`
- `POST /api/v1/web/holidays`
- `GET /api/v1/web/attendance/work-from-home`

## Docker

Build the image:

```bash
docker build -t attendance-api .
```

Run the container:

```bash
docker run --env-file .env -p 3000:3000 attendance-api
```

If your deployment environment sets `PORT=6001`, map `6001:6001` instead. The Docker start command runs Prisma migrations, initializes the admin user, and starts the server.

## Deployment Notes

- The backend has been configured for Railway testing deployment.
- Use HTTPS in production.
- Configure CORS to the exact web portal origin.
- Set strong JWT secrets in the deployment environment.
- Run Prisma migrations before serving traffic.
- Verify `/health` after deployment.

## Notes for Reviewers

This backend demonstrates practical Node.js API development with authentication, authorization, relational data modeling, business-rule-heavy workflows, and deployment-ready Express configuration.
