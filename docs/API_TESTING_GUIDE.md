# AttendanceAppServer API Testing Guide

Verified against `AttendanceAppServer` source on 2026-05-16.

This guide is intended for QA execution in Postman, Insomnia, curl, or an automated API suite. It covers environment setup, authentication, roles, route coverage, payload validation, expected envelopes, negative cases, and end-to-end workflow checks.

## 1. Scope

Test these server entry points:

- Health: `/health`
- Mobile employee API: `/api/v1/mobile`
- Web portal API: `/api/v1/web`

Primary source files:

- `src/app.js`
- `src/routes/mobile/index.js`
- `src/routes/web/index.js`
- `src/modules/*/*.schemas.js`
- `src/modules/*/*.controller.js`
- `src/modules/*/*.service.js`

Out of scope for this document:

- Web UI visual testing
- Flutter UI testing
- Google OAuth UI flows, except obtaining valid Google ID tokens for API login
- Load/performance testing beyond simple smoke concurrency checks

## 2. Environment Setup

### 2.1 Local server

From `AttendanceAppServer`:

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
node scripts/init-admin.js
npm run dev
```

Default local base URLs:

- API root: `http://localhost:3000/api/v1`
- Mobile base URL: `http://localhost:3000/api/v1/mobile`
- Web base URL: `http://localhost:3000/api/v1/web`
- Health: `http://localhost:3000/health`

### 2.2 Required environment variables

Minimum variables QA must confirm before testing:

| Variable | QA note |
|---|---|
| `DATABASE_URL` | Must point to an isolated QA database. Do not test destructive workflows on production data. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Must be set to non-default secure values in shared QA environments. |
| `JWT_ACCESS_TTL` | Default is `15m`; useful for access-token expiry tests. |
| `JWT_REFRESH_TTL` | Default is `7d`; useful for refresh-token expiry tests. |
| `BUSINESS_TIMEZONE` | Default is `Asia/Kolkata`. All date-only business logic uses this timezone. |
| `COMPANY_DOMAIN` | Login and user creation require this email domain. |
| `GOOGLE_WEB_CLIENT_ID` | Google ID token audience currently used by both web and mobile login verification. |
| `GOOGLE_ANDROID_CLIENT_ID` | Present in config, but current mobile login service verifies with `GOOGLE_WEB_CLIENT_ID`. |
| `FULL_DAY_MINUTES` / `HALF_DAY_MINUTES` | Used for attendance summary calculations. |
| `CORS_WEB_ORIGIN` | Web client origin allowed by CORS. |

### 2.3 Test data roles

Create or seed at least these users. Email domains must match `COMPANY_DOMAIN`.

| Test user | Role stored in DB | Effective API roles | Purpose |
|---|---:|---|---|
| `qa.admin@<domain>` | `ADMIN` | `EMPLOYEE`, `ADMIN` | Full web admin coverage and mutation tests. |
| `qa.manager@<domain>` | `MANAGER` | `EMPLOYEE`, `MANAGER` | Direct-report scoping and approval workflows. |
| `qa.employee1@<domain>` | `null` or `EMPLOYEE` | `EMPLOYEE` | Mobile attendance, leave, device change. |
| `qa.employee2@<domain>` | `null` or `EMPLOYEE` | `EMPLOYEE` | Overlap, search, pagination, manager-scope checks. |
| `qa.other.manager@<domain>` | `MANAGER` | `EMPLOYEE`, `MANAGER` | Negative direct-report scoping tests. |
| `qa.inactive@<domain>` | any | any | Login denied when `isActive=false`. |
| `qa.external@example.org` | any | any | Company-domain rejection tests. |

Manager scope requirements:

- `qa.employee1` and `qa.employee2` should have `managerUserId = qa.manager.id`.
- At least one employee should report to a different manager to prove manager isolation.
- Admin users should not appear in scoped attendance dashboard headcount or attendance summary lists.

Attendance profile requirements:

- For office punch tests, configure `officeLatitude`, `officeLongitude`, and `officeRadiusMeters`.
- For mobile device tests, keep one employee with no `boundDeviceId` initially and one already bound.

### 2.4 Postman variables

Recommended collection variables:

| Variable | Example |
|---|---|
| `apiRoot` | `http://localhost:3000/api/v1` |
| `mobileBase` | `{{apiRoot}}/mobile` |
| `webBase` | `{{apiRoot}}/web` |
| `mobileAccessToken` | Set from mobile login response. |
| `mobileRefreshToken` | Set from mobile login response. |
| `webAccessToken` | Set from web login response. |
| `webRefreshToken` | Set from web login response. |
| `deviceId` | Stable test device id, for example `qa-device-001`. |
| `newDeviceId` | Device id used for change-request tests. |
| `adminUserId` | Seeded admin id. |
| `managerUserId` | Seeded manager id. |
| `employeeUserId` | Seeded employee id. |
| `leaveRequestId` | Captured from leave creation/list response. |
| `leaveThreadMessageId` | Captured from proposal message response. |
| `deviceChangeRequestId` | Captured from device request response. |
| `holidayId` | Captured from holiday creation/list response. |

## 3. Common Contracts

### 3.1 Headers

All JSON requests:

```http
Content-Type: application/json
```

Protected routes:

```http
Authorization: Bearer <accessToken>
```

Mobile punch-in and punch-out additionally require:

```http
x-device-id: <bound-device-id>
```

### 3.2 Response envelope

Success:

```json
{
  "success": true,
  "data": {},
  "message": "Optional message",
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Validation failed",
    "details": [
      { "path": "email", "message": "Invalid email" }
    ]
  }
}
```

Common error statuses:

| Status | Code | Trigger |
|---:|---|---|
| 400 | `BAD_REQUEST` | Validation failure, invalid business action, missing `x-device-id`. |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired access token, invalid Google token, invalid refresh token. |
| 403 | `FORBIDDEN` | Wrong portal token, insufficient role, direct-report scope violation, device mismatch. |
| 404 | `NOT_FOUND` / `ROUTE_NOT_FOUND` | Missing resource or unknown API route. |
| 409 | `CONFLICT` | Duplicate or overlapping business action. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. Treat as defect unless test intentionally breaks infrastructure. |

### 3.3 Roles and portals

Access tokens include `portal` and `roles`.

| Portal | Token source | Allowed route group |
|---|---|---|
| `MOBILE` | `POST /mobile/auth/google/login` | `/api/v1/mobile/*` protected routes |
| `WEB` | `POST /web/auth/google/login` | `/api/v1/web/*` protected routes |

Portal mismatch should return `403`.

Effective roles:

| DB role | Effective roles |
|---|---|
| `null` or `EMPLOYEE` | `EMPLOYEE` |
| `MANAGER` | `EMPLOYEE`, `MANAGER` |
| `ADMIN` | `EMPLOYEE`, `ADMIN` |

Web protected routes require `MANAGER` or `ADMIN`. Mobile protected routes require `EMPLOYEE`.

Manager scoping:

- Managers can see and act on direct reports only.
- Admins can see and act across the organization, subject to route-specific constraints.
- Managers and admins cannot approve or reject their own leave or device-change requests.

### 3.4 Dates and business calendar

- Date-only fields use `YYYY-MM-DD`.
- Datetime fields use ISO datetime strings accepted by Zod `.datetime()`.
- Business timezone comes from `BUSINESS_TIMEZONE`, default `Asia/Kolkata`.
- Weekly off days are every Sunday plus the 2nd and 4th Saturday of the month.
- Current day is excluded from many aggregate attendance calculations because it may still be in progress.

## 4. Health Check

### GET `/health`

Expected `200`:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-05-16T..."
  }
}
```

QA checks:

- Server returns `200` without authentication.
- `timestamp` is a valid ISO timestamp.
- Unknown non-API route returns `404` with `NOT_FOUND`.
- Unknown API route returns `404` with `ROUTE_NOT_FOUND`.

## 5. Authentication

### 5.1 Mobile auth

#### POST `/api/v1/mobile/auth/google/login`

Body:

```json
{
  "googleToken": "<google-id-token>",
  "deviceId": "qa-device-001"
}
```

Expected `200`, message `Login successful`:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<opaque-refresh-token>",
    "user": {
      "id": "<uuid>",
      "fullName": "QA Employee",
      "email": "qa.employee1@b2winfotech.ai",
      "roles": ["EMPLOYEE"]
    }
  }
}
```

Positive checks:

- First successful login binds `deviceId` when no device is bound.
- Re-login with the same device succeeds.
- Employee user can log into mobile.

Negative checks:

- Missing `googleToken` or `deviceId` returns `400`.
- Invalid Google token returns `401`.
- User not present in DB returns `401`.
- Inactive user returns `401`.
- External email domain returns `403`.
- Manager/admin with no `EMPLOYEE` effective role should be checked if role logic changes; currently manager/admin effective roles include `EMPLOYEE`.
- Re-login with a different device returns `403` and message `Device mismatch. Please request a device change.`

#### POST `/api/v1/mobile/auth/device-change-request`

Public endpoint used when mobile login fails because the device changed.

Body:

```json
{
  "googleToken": "<google-id-token>",
  "deviceId": "qa-device-002",
  "reason": "Phone replaced"
}
```

Expected `200`, message `Device change request submitted`.

QA checks:

- Existing pending request for the same user is auto-marked `REJECTED` with note `Replaced by new request`.
- New request has status `PENDING`.
- Current bound device is copied into `currentDeviceIdSnapshot`.
- Same Google/user/domain failure cases as login.

#### POST `/api/v1/mobile/auth/refresh`

Body:

```json
{
  "refreshToken": "{{mobileRefreshToken}}"
}
```

Expected `200`:

```json
{
  "success": true,
  "data": {
    "accessToken": "<new-jwt>",
    "refreshToken": "<new-refresh-token>"
  }
}
```

QA checks:

- Old refresh token is revoked and cannot be reused.
- New refresh token works once.
- Expired, malformed, revoked, or tampered refresh token returns `401`.
- Refresh token preserves original portal; mobile refresh token must not produce a web token.

#### POST `/api/v1/mobile/auth/logout`

Body:

```json
{
  "refreshToken": "{{mobileRefreshToken}}"
}
```

Expected `200`, message `Logged out`, `data: null`.

QA checks:

- Token is revoked and cannot refresh afterward.
- Malformed refresh token still returns success by design, making logout idempotent.

### 5.2 Web auth

#### POST `/api/v1/web/auth/google/login`

Body:

```json
{
  "googleToken": "<google-id-token>"
}
```

Expected `200`, message `Login successful`, with `accessToken`, `refreshToken`, and `user`.

Positive checks:

- Manager can log into web.
- Admin can log into web.

Negative checks:

- Employee-only user returns `403` with web portal role rejection.
- Missing or invalid token returns `400` or `401`.
- External domain returns `403`.
- Inactive or unprovisioned user returns `401`.

#### POST `/api/v1/web/auth/refresh`

Same contract as mobile refresh, but produces a web portal access token.

#### POST `/api/v1/web/auth/logout`

Same contract as mobile logout.

## 6. Mobile Employee API

All routes in this section require:

```http
Authorization: Bearer {{mobileAccessToken}}
```

Using a web token should return `403`.

### 6.1 Profile and dashboard

#### GET `/api/v1/mobile/me/profile`

Expected `200`.

Key fields:

- `id`
- `fullName`
- `email`
- `roles`
- `manager`
- `attendanceProfile.boundDeviceId`
- `attendanceProfile.officeLatitude`
- `attendanceProfile.officeLongitude`
- `attendanceProfile.officeRadiusMeters`

QA checks:

- Authenticated user receives only their own profile.
- Bound device reflects first login or approved device change.

#### GET `/api/v1/mobile/me/dashboard`

Expected `200`.

Key fields:

- `user`
- `todayStatus`
- `monthSummary`
- `pendingLeaves`
- `upcomingHolidays`
- `upcomingWFHDays`

QA checks:

- `todayStatus.status` can be `notPunchedIn`, `working`, `completed`, `onLeave`, `weeklyOff`, or `holiday`.
- Weekly off, holiday, and approved leave override normal punch display.
- WFH days are returned in `upcomingWFHDays`.
- Pending leave list is limited to pending requests.

### 6.2 Mobile holidays

#### GET `/api/v1/mobile/me/holidays`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `filter` | no | `all`, `future`, `past`; default `all` |
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |

Expected `200`, `data` is a list of active holidays:

```json
[
  {
    "id": "<uuid>",
    "title": "Diwali",
    "description": "Optional",
    "startDate": "2026-11-08T00:00:00.000Z",
    "endDate": "2026-11-08T00:00:00.000Z"
  }
]
```

QA checks:

- Default date range is current business year.
- `future` excludes holidays whose `endDate` is before today.
- `past` includes only holidays whose `endDate` is before today and sorts descending.
- `endDate < startDate` returns `400`.
- Unknown query parameters return `400` because schema is strict.

### 6.3 Mobile attendance

#### GET `/api/v1/mobile/me/attendance/overview`

Query parameters:

| Name | Required | Format |
|---|---:|---|
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |
| `includeHolidayHistory` | no | `true` or any other value as false |

Expected `200`.

Key fields:

- `range.startDate`
- `range.endDate`
- `range.appliedEndDate`
- `range.currentDateExcluded`
- `summary`
- `days[]`
- `holidayHistory[]` only when `includeHolidayHistory=true`

QA checks:

- Default range starts at current business month start and ends today.
- If requested end is today or future, aggregate uses yesterday in `appliedEndDate`.
- Dates before user creation date are excluded from the effective start.
- Weekly off and holiday days appear correctly.
- Approved leave and regularization appear in day status/source fields.

#### POST `/api/v1/mobile/me/attendance/punch-in`

Headers:

```http
x-device-id: {{deviceId}}
```

Office body:

```json
{
  "latitude": 19.076,
  "longitude": 72.8777
}
```

WFH body:

```json
{
  "todayPlan": "Finish API QA regression"
}
```

Optional fields:

| Field | Rules |
|---|---|
| `latitude` | number, `-90` to `90`; must be paired with `longitude` |
| `longitude` | number, `-180` to `180`; must be paired with `latitude` |
| `todayPlan` | non-empty after trim; required for WFH punch-in |

Expected `201`, message `Punched in`.

QA checks:

- Missing `x-device-id` returns `400`.
- Wrong device id returns `403`.
- No bound device returns `400`.
- Office punch requires latitude and longitude.
- Latitude without longitude or longitude without latitude returns `400`.
- Office punch outside geofence returns `400` with distance message.
- Missing geofence profile returns `400`.
- WFH punch requires `todayPlan` and does not require location.
- Cannot punch on weekly off, holiday, or approved leave.
- Duplicate punch-in for the same business day returns `409`.
- Successful punch creates or updates attendance summary with `WORKING`.

#### POST `/api/v1/mobile/me/attendance/punch-out`

Headers:

```http
x-device-id: {{deviceId}}
```

Office body:

```json
{
  "latitude": 19.076,
  "longitude": 72.8777
}
```

WFH body:

```json
{
  "report": "Completed API QA regression"
}
```

Expected `200`, message `Punched out`.

QA checks:

- Must have punched in today first.
- Duplicate punch-out returns `409`.
- Wrong or missing device header follows punch-in behavior.
- Office punch-out requires valid in-geofence location.
- WFH punch-out requires non-empty `report`.
- `workedMinutes` is calculated and attendance summary is updated to final status.

### 6.4 Mobile leave requests

#### GET `/api/v1/mobile/me/leave-requests`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `status` | no | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `page` | no | integer, default `1` |
| `limit` | no | integer, default `20` |

Expected `200`, `data` is a list and `meta` has pagination.

QA note: this mobile list endpoint currently parses query params manually rather than through the shared validation middleware. Include invalid `status`, `page`, and `limit` robustness tests and log any `500` as a defect.

#### POST `/api/v1/mobile/me/leave-requests`

Body:

```json
{
  "startDate": "2026-06-01",
  "endDate": "2026-06-03",
  "reason": "Family function"
}
```

Expected `201`, message `Leave request created`.

Key response fields:

- `id`
- `userId`
- `startDate`
- `endDate`
- `workingDayCount`
- `reason`
- `status: PENDING`
- `workingDates`

QA checks:

- `startDate` and `endDate` must be `YYYY-MM-DD`.
- `reason` is required.
- `startDate > endDate` returns `400`.
- Past start date returns `400`.
- Starting today after punching in returns `400`.
- Range containing only weekly offs/holidays returns `400`.
- Overlap with existing pending leave returns `409`.
- Overlap with approved leave's approved range returns `409`.
- Initial thread message is created with type `REQUEST`.

#### PATCH `/api/v1/mobile/me/leave-requests/:leaveRequestId/cancel`

Expected `200`, message `Leave request cancelled`.

QA checks:

- User can cancel only their own leave.
- Only `PENDING` requests can be cancelled.
- Cancellation creates a thread message with type `CANCELLATION`.

#### GET `/api/v1/mobile/me/leave-requests/:leaveRequestId/thread`

Expected `200`:

```json
{
  "success": true,
  "data": {
    "leaveRequestId": "<uuid>",
    "messages": []
  }
}
```

QA checks:

- User can access only their own leave thread.
- Messages sort ascending by `createdAt`.
- Actor object includes effective `roles`.

#### POST `/api/v1/mobile/me/leave-requests/:leaveRequestId/thread/messages`

Comment body:

```json
{
  "message": "Can this be reviewed today?"
}
```

Proposal body:

```json
{
  "message": "I can shift this by one day",
  "proposedStartDate": "2026-06-02",
  "proposedEndDate": "2026-06-04"
}
```

Expected `201`, message `Leave thread message created`.

Validation checks:

- Comment requires non-empty `message`.
- Proposal requires both `proposedStartDate` and `proposedEndDate`.
- Proposal dates must be ordered.
- Proposal cannot overlap another pending/approved leave.
- Thread actions are allowed only while leave is `PENDING`.

#### PATCH `/api/v1/mobile/me/leave-requests/:leaveRequestId/thread/messages/:messageId/accept`

Expected `200`, message `Leave proposal accepted`.

QA checks:

- Only proposal messages can be accepted.
- User cannot accept their own proposal.
- Accepting a manager proposal approves the leave with proposed dates.
- Creates an `ACCEPTANCE` thread message and updates attendance summaries.

### 6.5 Mobile device change requests

#### GET `/api/v1/mobile/me/device-change-requests`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `status` | no | `PENDING`, `APPROVED`, `REJECTED` |
| `page` | no | integer, default `1` |
| `limit` | no | integer, default `20` |

Expected `200`, list plus pagination.

QA note: this mobile list endpoint also parses query params manually. Include invalid query robustness tests.

#### POST `/api/v1/mobile/me/device-change-requests`

Body:

```json
{
  "requestedDeviceId": "qa-device-002",
  "reason": "Phone replaced"
}
```

Expected `201`, message `Device change request created`.

QA checks:

- Required fields are enforced.
- Existing pending request for the user is auto-rejected with note `Replaced by new request`.
- New request captures `currentDeviceIdSnapshot`.

## 7. Web Portal API

All routes in this section require:

```http
Authorization: Bearer {{webAccessToken}}
```

Using a mobile token should return `403`. Employee-only web access should return `403`.

### 7.1 Web profile and dashboard

#### GET `/api/v1/web/me/profile`

Expected `200`; same profile contract as mobile.

#### GET `/api/v1/web/dashboard/overview`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Format |
|---|---:|---|
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |

Expected `200`.

Key fields:

- `range`
- `headcount`
- `attendanceSummary`
- `pendingLeaveCount`
- `pendingDeviceChangeCount`
- `upcomingHolidays`

QA checks:

- Manager sees direct-report counts only.
- Admin sees organization-wide non-admin users.
- Current/future end date is clamped in `range.appliedEndDate`.
- Pending leave/device counts match seeded pending records.

### 7.2 Users

#### GET `/api/v1/web/users`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `search` | no | name/email substring |
| `role` | no | `EMPLOYEE`, `MANAGER`, `ADMIN` |
| `isActive` | no | `true`, `false` |
| `page` | no | integer `>=1`, default `1` |
| `limit` | no | integer `1..100`, default `20` |

Expected `200`, list plus pagination.

QA checks:

- Search matches full name and email case-insensitively.
- Role `EMPLOYEE` includes users with DB role `null` or `EMPLOYEE`.
- Manager list is restricted to direct reports.
- Admin can list all users.
- Pagination metadata is correct.

#### POST `/api/v1/web/users`

Roles: `MANAGER`, `ADMIN`

Body using `roles`:

```json
{
  "fullName": "QA Employee",
  "email": "qa.employee3@b2winfotech.ai",
  "roles": ["EMPLOYEE"],
  "managerUserId": "<manager-uuid>"
}
```

Body using `role`:

```json
{
  "fullName": "QA Manager",
  "email": "qa.manager2@b2winfotech.ai",
  "role": "MANAGER",
  "managerUserId": null
}
```

Expected `201`, message `User created`.

Validation:

- `fullName`: required, `1..120`.
- `email`: required email, max `150`, normalized lowercase.
- Either `roles` or `role` is required.
- `roles`: array of `EMPLOYEE`, `MANAGER`, `ADMIN`, min length `1`.
- `role`: `EMPLOYEE`, `MANAGER`, `ADMIN`, or `null`.
- `managerUserId`: UUID, nullable.

QA checks:

- Email must be unique.
- Email domain must equal `COMPANY_DOMAIN`.
- Attendance profile is created with the user.
- Admin role forces `managerUserId` to `null`.
- `managerUserId` must refer to a manager.
- Caller cannot assign a role higher than their own.
- Manager-created users are assigned to that manager regardless of supplied `managerUserId`.

#### PATCH `/api/v1/web/users/:userId`

Roles: `MANAGER`, `ADMIN`

Body can include:

```json
{
  "fullName": "QA Employee Updated",
  "roles": ["EMPLOYEE", "MANAGER"],
  "managerUserId": "<manager-uuid>",
  "isActive": true
}
```

Expected `200`, message `User updated`.

QA checks:

- Manager can update direct reports only.
- Manager cannot reassign manager.
- Role can be promoted but not downgraded.
- Caller cannot assign role higher than their own.
- Updating user to `ADMIN` clears manager.
- Inactive user cannot log in.

### 7.3 Attendance profiles

#### GET `/api/v1/web/users/:userId/attendance-profile`

Roles: `MANAGER`, `ADMIN`

Expected `200`.

QA checks:

- Missing profile is auto-created.
- Manager can view direct reports only.

#### PUT `/api/v1/web/users/:userId/attendance-profile`

Roles: `MANAGER`, `ADMIN`

Body:

```json
{
  "officeLatitude": 19.076,
  "officeLongitude": 72.8777,
  "officeRadiusMeters": 150
}
```

Expected `200`, message `Attendance profile updated`.

Validation:

- Latitude: number `-90..90`.
- Longitude: number `-180..180`.
- Radius: integer `1..10000`.

QA checks:

- Updates `updatedByUserId`.
- Values support mobile geofence punch tests.
- Manager can update direct reports only.

### 7.4 Web attendance

#### GET `/api/v1/web/attendance/overview`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |
| `search` | no | employee name/email |
| `page` | no | integer `>=1`, default `1` |
| `limit` | no | integer `1..100`, default `20` |

Expected `200`, `data` is user summary list and `meta` includes pagination plus:

- `range`
- `aggregate`

QA checks:

- Manager sees direct reports only.
- Admin scope excludes admins from attendance aggregation.
- Aggregate counts equal sum of returned page items for the page.
- Current/future end date is clamped.
- Search and pagination work together.

#### GET `/api/v1/web/attendance/records`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |
| `status` | no | `present`, `halfDay`, `absent`, `working`, `onLeave`, `holiday`, `weeklyOff`, `regularized` |
| `search` | no | employee name/email |
| `page` | no | integer `>=1`, default `1` |
| `limit` | no | integer `1..100`, default `20` |

Expected `200`, row-level attendance list plus pagination and `range`.

QA checks:

- `endDate < startDate` returns `400`.
- Future requested end date is trimmed to today.
- Current day without summary is omitted.
- Status filters match expected records.
- Rows sort by date desc, then employee name/email.

#### PUT `/api/v1/web/users/:userId/attendance-regularizations/:date`

Roles: `MANAGER`, `ADMIN`

Path `date`: `YYYY-MM-DD`

Body for present/half day:

```json
{
  "overrideStatus": "PRESENT",
  "overridePunchInAt": "2026-05-14T04:00:00.000Z",
  "overridePunchOutAt": "2026-05-14T13:00:00.000Z",
  "reason": "Manual correction after biometric issue"
}
```

Body for absent/on leave:

```json
{
  "overrideStatus": "ABSENT",
  "reason": "No punch data"
}
```

Expected `200`, message `Regularization saved`.

Validation:

- `overrideStatus`: `PRESENT`, `HALF_DAY`, `ABSENT`, `ON_LEAVE`.
- `reason`: required.
- Datetimes must be valid ISO datetimes when supplied.

Business checks:

- Target date must be in the past.
- Cannot regularize weekly off or holiday.
- Manager can regularize direct reports only.
- `PRESENT` and `HALF_DAY` require both punch-in and punch-out.
- Punch out must be after punch in.
- Both punch times must be on the same date as path `date`.
- `ABSENT` and `ON_LEAVE` clear punch times.
- Attendance summary is rebuilt from regularization.

#### DELETE `/api/v1/web/users/:userId/attendance-regularizations/:date`

Roles: `MANAGER`, `ADMIN`

Expected `200`, message `Regularization deleted`, `data: null`.

QA checks:

- Missing regularization returns `404`.
- Manager scope applies.
- Attendance summary is rebuilt after deletion.

### 7.5 Work from home

#### GET `/api/v1/web/attendance/work-from-home`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |
| `search` | no | employee name/email |
| `page` | no | integer `>=1`, default `1` |
| `limit` | no | integer `1..100`, default `20` |

Expected `200`, list plus pagination.

QA checks:

- `endDate < startDate` returns `400`.
- Manager sees direct reports only.
- Search filters by active user name/email.

#### POST `/api/v1/web/users/:userId/attendance/work-from-home`

Roles: `MANAGER`, `ADMIN`

Body:

```json
{
  "ranges": [
    { "startDate": "2026-06-01", "endDate": "2026-06-03" }
  ]
}
```

Expected `201`, message `Work from home assigned`.

QA checks:

- `ranges` min length is `1`.
- Each range must be ordered.
- WFH dates must be after today, not today or past.
- Cannot assign WFH on weekly off.
- Cannot assign WFH overlapping active holidays.
- Cannot assign WFH overlapping approved leave.
- Duplicate assignment is skipped and reflected in `count`.
- Manager can assign direct reports only.
- Employee mobile dashboard shows upcoming WFH days.
- WFH punch-in requires `todayPlan`; WFH punch-out requires `report`.

#### DELETE `/api/v1/web/users/:userId/attendance/work-from-home`

Roles: `MANAGER`, `ADMIN`

Body:

```json
{
  "ranges": [
    { "startDate": "2026-06-01", "endDate": "2026-06-03" }
  ]
}
```

Expected `200`, message `Work from home removed`.

QA checks:

- Same future-date and manager scope checks as assign.
- Response includes `deletedCount`.
- Removing a date that does not exist should not fail; count should be `0`.

### 7.6 Web leave requests

#### GET `/api/v1/web/leave-requests`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `status` | no | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |
| `search` | no | employee name/email |
| `page` | no | integer `>=1`, default `1` |
| `limit` | no | integer `1..100`, default `20` |

Expected `200`, list plus pagination.

QA checks:

- Manager sees direct-report leave requests only.
- Date filter returns leaves overlapping the selected window.
- Search filters by employee name/email.

#### GET `/api/v1/web/leave-requests/:leaveRequestId/thread`

Roles: `MANAGER`, `ADMIN`

Expected `200`, same thread contract as mobile.

QA checks:

- Manager can access direct-report leave only.

#### POST `/api/v1/web/leave-requests/:leaveRequestId/thread/messages`

Roles: `MANAGER`, `ADMIN`

Body contract is the same as mobile thread message creation.

Expected `201`, message `Leave thread message created`.

QA checks:

- Manager/admin can comment or propose date changes on pending direct-report leave.
- Proposal validation matches mobile.

#### PATCH `/api/v1/web/leave-requests/:leaveRequestId/thread/messages/:messageId/accept`

Roles: `MANAGER`, `ADMIN`

Expected `200`, message `Leave proposal accepted`.

QA checks:

- Web user can accept only employee proposals.
- Web user cannot accept their own proposal.
- Acceptance approves leave using proposed dates.

#### PATCH `/api/v1/web/leave-requests/:leaveRequestId/approve`

Roles: `MANAGER`, `ADMIN`

Body:

```json
{
  "actionNote": "Approved"
}
```

`actionNote` is optional.

Expected `200`, message `Leave request approved`.

QA checks:

- Only pending leave can be approved.
- Caller cannot approve their own leave.
- Manager scope applies.
- Approval creates `DIRECT_APPROVAL` thread message.
- Attendance summaries are created for approved leave dates.

#### PATCH `/api/v1/web/leave-requests/:leaveRequestId/reject`

Roles: `MANAGER`, `ADMIN`

Body:

```json
{
  "actionNote": "Insufficient staffing"
}
```

Expected `200`, message `Leave request rejected`.

QA checks:

- `actionNote` is required.
- Only pending leave can be rejected.
- Caller cannot reject their own leave.
- Rejection creates `REJECTION` thread message.

### 7.7 Web device change requests

#### GET `/api/v1/web/device-change-requests`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `status` | no | `PENDING`, `APPROVED`, `REJECTED` |
| `search` | no | employee name/email |
| `page` | no | integer `>=1`, default `1` |
| `limit` | no | integer `1..100`, default `20` |

Expected `200`, list plus pagination.

QA checks:

- Manager sees direct-report requests only.
- Search and status filters work together.

#### PATCH `/api/v1/web/device-change-requests/:requestId/approve`

Roles: `MANAGER`, `ADMIN`

Body:

```json
{
  "actionNote": "Approved after identity check"
}
```

`actionNote` is optional.

Expected `200`, message `Device change approved`.

QA checks:

- Only pending request can be approved.
- Caller cannot approve their own request.
- Manager scope applies.
- User attendance profile `boundDeviceId` updates to `requestedDeviceId`.
- All active mobile refresh tokens for the employee are revoked.
- Employee can log in with new device afterward.
- Employee cannot continue refreshing with old mobile refresh token.

#### PATCH `/api/v1/web/device-change-requests/:requestId/reject`

Roles: `MANAGER`, `ADMIN`

Body:

```json
{
  "actionNote": "Device details did not match"
}
```

Expected `200`, message `Device change rejected`.

QA checks:

- `actionNote` is required.
- Only pending request can be rejected.
- Caller cannot reject their own request.
- Bound device remains unchanged.

### 7.8 Holidays

#### GET `/api/v1/web/holidays`

Roles: `MANAGER`, `ADMIN`

Query parameters:

| Name | Required | Values |
|---|---:|---|
| `startDate` | no | `YYYY-MM-DD` |
| `endDate` | no | `YYYY-MM-DD` |
| `includeDeleted` | no | `true` or any other value as false |

Expected `200`, `data` is list of holidays.

QA checks:

- Managers and admins can read holidays.
- Deleted holidays are omitted unless `includeDeleted=true`.
- Date filters return holidays overlapping the selected window.

#### GET `/api/v1/web/holidays/:holidayId/history`

Roles: `MANAGER`, `ADMIN`

Expected `200`, newest change logs first.

QA checks:

- History includes `CREATED`, `UPDATED`, and `DELETED` logs.
- `changedBy` is populated.
- Missing holiday returns `404`.

#### POST `/api/v1/web/holidays`

Roles: `ADMIN` only.

Body:

```json
{
  "title": "QA Holiday",
  "description": "Regression test holiday",
  "startDate": "2026-06-10",
  "endDate": "2026-06-10"
}
```

Expected `201`, message `Holiday created`.

Validation:

- `title`: required, `1..120`.
- `description`: optional.
- Date fields: `YYYY-MM-DD`, valid dates.

QA checks:

- Manager receives `403`.
- `startDate > endDate` returns `400`.
- Past dates return `400`.
- Overlap with existing active holiday returns `409`.
- Creation writes a `CREATED` history log with reason `Initial creation`.
- Attendance summaries are rebuilt for the holiday range.

#### PATCH `/api/v1/web/holidays/:holidayId`

Roles: `ADMIN` only.

Body:

```json
{
  "title": "QA Holiday Updated",
  "description": null,
  "startDate": "2026-06-11",
  "endDate": "2026-06-11",
  "reason": "Date corrected"
}
```

Expected `200`, message `Holiday updated`.

Validation:

- `reason` is required.
- Other fields are optional.
- `description` can be `null`.

QA checks:

- Cannot update deleted holiday.
- Cannot update holiday that has already started.
- New date range cannot overlap active holiday.
- Past dates return `400`.
- Update writes `UPDATED` history with before/after snapshots.
- Attendance summaries are rebuilt for old and new affected ranges.

#### DELETE `/api/v1/web/holidays/:holidayId`

Roles: `ADMIN` only.

Body:

```json
{
  "reason": "Created by QA test"
}
```

Expected `200`, message `Holiday deleted`, `data: null`.

QA checks:

- `reason` is required.
- Cannot delete already deleted holiday.
- Cannot delete holiday that has already started.
- Delete is soft-delete (`isDeleted=true`).
- Delete writes `DELETED` history log.
- Attendance summaries are rebuilt for deleted holiday range.

## 8. End-to-End QA Workflows

### 8.1 Employee first-login and office punch

1. Create employee via web API.
2. Set attendance profile geofence via web API.
3. Login mobile with `deviceId=qa-device-001`.
4. Confirm profile shows bound device.
5. Punch in inside geofence.
6. Confirm dashboard status is `working`.
7. Punch out inside geofence.
8. Confirm dashboard status is `completed`.
9. Confirm attendance overview and web records show present/half-day according to worked minutes.

Negative variants:

- Punch in outside geofence.
- Punch out without punch in.
- Punch twice.
- Use wrong `x-device-id`.

### 8.2 Device change approval

1. Login employee with original device.
2. Attempt login with `qa-device-002`; expect `403`.
3. Submit public device change request with Google token and new device.
4. Confirm request appears in mobile self-list and web manager/admin list.
5. Approve request as manager/admin.
6. Confirm attendance profile bound device changes.
7. Confirm old mobile refresh token is revoked.
8. Login successfully with new device.

Negative variants:

- Reject request and confirm bound device stays unchanged.
- Try self-approval.
- Try approval as unrelated manager.

### 8.3 Leave approval and attendance impact

1. Employee creates future leave for working days.
2. Confirm `workingDayCount` excludes weekly offs and holidays.
3. Confirm initial thread message exists.
4. Manager lists pending leave.
5. Manager approves leave.
6. Employee sees leave as approved.
7. Attendance overview for approved range shows `onLeave`.
8. Employee cannot punch in on approved leave day.

Negative variants:

- Overlap pending leave.
- Create leave only on holidays/weekly offs.
- Approve non-pending leave.
- Self-approve.

### 8.4 Leave proposal negotiation

1. Employee creates leave.
2. Manager creates proposal with alternate dates.
3. Employee accepts proposal.
4. Confirm leave is approved using proposed dates.
5. Confirm acceptance message links to accepted proposal.

Reverse variant:

1. Employee creates proposal in thread.
2. Manager accepts proposal from web.
3. Confirm web cannot accept manager-authored proposals.

### 8.5 Holiday lifecycle

1. Admin creates future holiday.
2. Manager confirms holiday is visible.
3. Employee confirms holiday appears in mobile holidays.
4. Admin updates holiday date/title with reason.
5. Confirm history has `CREATED` and `UPDATED`.
6. Admin deletes holiday with reason.
7. Confirm default list hides deleted holiday.
8. Confirm `includeDeleted=true` shows deleted holiday.
9. Confirm history has `DELETED`.

Negative variants:

- Manager creates, updates, deletes holiday: expect `403`.
- Create overlapping holiday: expect `409`.
- Edit/delete started holiday: expect `400`.

### 8.6 Work from home lifecycle

1. Manager/admin assigns future WFH dates to employee.
2. Employee dashboard shows upcoming WFH day.
3. On WFH day, employee punch-in without `todayPlan`: expect `400`.
4. Punch-in with `todayPlan`: expect `201`.
5. Punch-out without `report`: expect `400`.
6. Punch-out with `report`: expect `200`.
7. Remove future WFH assignment.

Negative variants:

- Assign WFH on weekly off.
- Assign WFH on active holiday.
- Assign WFH overlapping approved leave.
- Assign WFH for today or past date.

### 8.7 Attendance regularization

1. Create employee attendance record or leave an absence for a past working day.
2. Manager/admin upserts regularization to `PRESENT` with punch times.
3. Confirm web records show `regularized`.
4. Confirm overview aggregate changes.
5. Delete regularization.
6. Confirm summary is rebuilt from original punch/leave/missing data.

Negative variants:

- Regularize today or future date.
- Regularize weekly off/holiday.
- Present/half-day without both punch times.
- Punch out before punch in.
- Punch times on different date than path date.

## 9. Global Negative Test Matrix

Run these against at least one protected mobile route and one protected web route:

| Case | Expected |
|---|---|
| No `Authorization` header | `401`, `UNAUTHORIZED` |
| Header not starting with `Bearer ` | `401`, `UNAUTHORIZED` |
| Expired access token | `401`, `UNAUTHORIZED` |
| Tampered JWT | `401`, `UNAUTHORIZED` |
| Mobile token on web route | `403`, portal access error |
| Web token on mobile route | `403`, portal access error |
| Employee-only user on web route | `403`, insufficient/web role error |
| Manager on admin-only holiday mutation | `403`, insufficient role |
| Invalid enum in validated query/body | `400`, validation details |
| Page `0` or limit `101` on validated lists | `400`, validation details |
| Malformed date `2026/06/01` | `400`, validation details |
| Unknown `/api/v1/...` route | `404`, `ROUTE_NOT_FOUND` |

Path-parameter robustness:

- Most path params are not schema-validated in the route layer. Use UUID values for normal QA.
- Also test malformed UUID path params such as `abc`.
- If malformed IDs return `500`, log as a server robustness defect and include the endpoint.

Validation coverage note:

- Most body/query validation is handled by route-level Zod schemas.
- The web dashboard query and the mobile leave/device-change list queries are manually parsed or passed through without route-level date/order validation. Include invalid values for these endpoints in robustness testing and log any `500` as a defect.

## 10. Endpoint Catalog

### Public and auth

| Method | Path | Auth | Expected success |
|---|---|---|---:|
| GET | `/health` | none | 200 |
| POST | `/api/v1/mobile/auth/google/login` | none | 200 |
| POST | `/api/v1/mobile/auth/refresh` | none | 200 |
| POST | `/api/v1/mobile/auth/logout` | none | 200 |
| POST | `/api/v1/mobile/auth/device-change-request` | none | 200 |
| POST | `/api/v1/web/auth/google/login` | none | 200 |
| POST | `/api/v1/web/auth/refresh` | none | 200 |
| POST | `/api/v1/web/auth/logout` | none | 200 |

### Mobile protected

| Method | Path | Role | Expected success |
|---|---|---|---:|
| GET | `/api/v1/mobile/me/profile` | EMPLOYEE | 200 |
| GET | `/api/v1/mobile/me/dashboard` | EMPLOYEE | 200 |
| GET | `/api/v1/mobile/me/holidays` | EMPLOYEE | 200 |
| GET | `/api/v1/mobile/me/attendance/overview` | EMPLOYEE | 200 |
| POST | `/api/v1/mobile/me/attendance/punch-in` | EMPLOYEE | 201 |
| POST | `/api/v1/mobile/me/attendance/punch-out` | EMPLOYEE | 200 |
| GET | `/api/v1/mobile/me/leave-requests` | EMPLOYEE | 200 |
| POST | `/api/v1/mobile/me/leave-requests` | EMPLOYEE | 201 |
| PATCH | `/api/v1/mobile/me/leave-requests/:leaveRequestId/cancel` | EMPLOYEE | 200 |
| GET | `/api/v1/mobile/me/leave-requests/:leaveRequestId/thread` | EMPLOYEE | 200 |
| POST | `/api/v1/mobile/me/leave-requests/:leaveRequestId/thread/messages` | EMPLOYEE | 201 |
| PATCH | `/api/v1/mobile/me/leave-requests/:leaveRequestId/thread/messages/:messageId/accept` | EMPLOYEE | 200 |
| GET | `/api/v1/mobile/me/device-change-requests` | EMPLOYEE | 200 |
| POST | `/api/v1/mobile/me/device-change-requests` | EMPLOYEE | 201 |

### Web protected

| Method | Path | Role | Expected success |
|---|---|---|---:|
| GET | `/api/v1/web/me/profile` | WEB token | 200 |
| GET | `/api/v1/web/dashboard/overview` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/users` | MANAGER/ADMIN | 200 |
| POST | `/api/v1/web/users` | MANAGER/ADMIN | 201 |
| PATCH | `/api/v1/web/users/:userId` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/users/:userId/attendance-profile` | MANAGER/ADMIN | 200 |
| PUT | `/api/v1/web/users/:userId/attendance-profile` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/attendance/overview` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/attendance/records` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/attendance/work-from-home` | MANAGER/ADMIN | 200 |
| PUT | `/api/v1/web/users/:userId/attendance-regularizations/:date` | MANAGER/ADMIN | 200 |
| DELETE | `/api/v1/web/users/:userId/attendance-regularizations/:date` | MANAGER/ADMIN | 200 |
| POST | `/api/v1/web/users/:userId/attendance/work-from-home` | MANAGER/ADMIN | 201 |
| DELETE | `/api/v1/web/users/:userId/attendance/work-from-home` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/leave-requests` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/leave-requests/:leaveRequestId/thread` | MANAGER/ADMIN | 200 |
| POST | `/api/v1/web/leave-requests/:leaveRequestId/thread/messages` | MANAGER/ADMIN | 201 |
| PATCH | `/api/v1/web/leave-requests/:leaveRequestId/thread/messages/:messageId/accept` | MANAGER/ADMIN | 200 |
| PATCH | `/api/v1/web/leave-requests/:leaveRequestId/approve` | MANAGER/ADMIN | 200 |
| PATCH | `/api/v1/web/leave-requests/:leaveRequestId/reject` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/device-change-requests` | MANAGER/ADMIN | 200 |
| PATCH | `/api/v1/web/device-change-requests/:requestId/approve` | MANAGER/ADMIN | 200 |
| PATCH | `/api/v1/web/device-change-requests/:requestId/reject` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/holidays` | MANAGER/ADMIN | 200 |
| GET | `/api/v1/web/holidays/:holidayId/history` | MANAGER/ADMIN | 200 |
| POST | `/api/v1/web/holidays` | ADMIN | 201 |
| PATCH | `/api/v1/web/holidays/:holidayId` | ADMIN | 200 |
| DELETE | `/api/v1/web/holidays/:holidayId` | ADMIN | 200 |

## 11. Release Regression Checklist

Before approving a release, QA should complete and record evidence for:

- Health endpoint returns `200`.
- Web login works for manager and admin.
- Mobile login works for employee and binds first device.
- Refresh token rotates and old refresh token is rejected.
- Portal mismatch is rejected both directions.
- Manager direct-report scoping is enforced in users, attendance, leave, device change, WFH.
- Employee cannot access web protected APIs.
- Manager cannot access admin-only holiday mutations.
- Office punch-in/out geofence happy and negative paths pass.
- WFH assignment plus WFH punch-in/out happy and negative paths pass.
- Leave create, thread, approve, reject, cancel, proposal accept workflows pass.
- Device change create, approve, reject workflows pass and mobile refresh revocation is verified.
- Holiday create, update, delete, list, history workflows pass.
- Attendance regularization create/update/delete rebuilds summary correctly.
- List endpoints return correct pagination metadata.
- Unknown route and validation errors use the standard error envelope.
- No expected negative API case returns `500`.
