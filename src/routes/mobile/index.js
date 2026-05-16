import { Router } from "express";
import {
  authenticate,
  requirePortal,
  requireRoles,
  requireDeviceId,
} from "../../middlewares/index.js";
import { validate } from "../../middlewares/validate.js";
import * as authController from "../../modules/auth/auth.controller.js";
import {
  googleLoginMobileSchema,
  refreshTokenSchema,
  deviceChangeRequestSchema,
} from "../../modules/auth/auth.schemas.js";
import * as usersController from "../../modules/users/users.controller.js";
import * as attendanceController from "../../modules/attendance/attendance.controller.js";
import {
  punchInSchema,
  punchOutSchema,
  attendanceOverviewQuerySchema,
} from "../../modules/attendance/attendance.schemas.js";
import * as leavesController from "../../modules/leaves/leaves.controller.js";
import {
  createLeaveRequestSchema,
  leaveThreadMessageSchema,
} from "../../modules/leaves/leaves.schemas.js";
import * as deviceChangesController from "../../modules/device-changes/device-changes.controller.js";
import {
  createDeviceChangeSchema,
} from "../../modules/device-changes/device-changes.schemas.js";
import * as dashboardController from "../../modules/dashboard/dashboard.controller.js";
import * as holidaysController from "../../modules/holidays/holidays.controller.js";
import {
  listEmployeeHolidaysQuerySchema,
} from "../../modules/holidays/holidays.schemas.js";
import { Portal, Role } from "@prisma/client";
const router = Router();
// Public auth endpoints (no bearer token required).
router.post(
  "/auth/google/login",
  validate(googleLoginMobileSchema),
  authController.mobileGoogleLogin,
);
router.post(
  "/auth/refresh",
  validate(refreshTokenSchema),
  authController.refreshToken,
);
router.post(
  "/auth/logout",
  validate(refreshTokenSchema),
  authController.logoutHandler,
);
router.post(
  "/auth/device-change-request",
  validate(deviceChangeRequestSchema),
  authController.requestDeviceChange,
);
// Protected zone: token must be MOBILE portal + EMPLOYEE role.
router.use(
  authenticate,
  requirePortal(Portal.MOBILE),
  requireRoles(Role.EMPLOYEE),
);
// Profile
router.get("/me/profile", usersController.getMyProfile);
// Dashboard
router.get("/me/dashboard", dashboardController.mobileDashboard);
// Holidays
router.get(
  "/me/holidays",
  validate(listEmployeeHolidaysQuerySchema, "query"),
  holidaysController.listEmployeeHolidays,
);
// Attendance
router.get(
  "/me/attendance/overview",
  validate(attendanceOverviewQuerySchema, "query"),
  attendanceController.myAttendanceOverview,
);
router.post(
  "/me/attendance/punch-in",
  requireDeviceId,
  validate(punchInSchema),
  attendanceController.punchIn,
);
router.post(
  "/me/attendance/punch-out",
  requireDeviceId,
  validate(punchOutSchema),
  attendanceController.punchOut,
);
// Leave requests
router.get("/me/leave-requests", leavesController.getMyLeaveRequests);
router.get(
  "/me/leave-requests/:leaveRequestId",
  leavesController.getMyLeaveRequest,
);
router.get(
  "/me/leave-requests/:leaveRequestId/thread",
  leavesController.getMyLeaveRequestThread,
);
router.post(
  "/me/leave-requests/:leaveRequestId/thread/messages",
  validate(leaveThreadMessageSchema),
  leavesController.createMyLeaveThreadMessage,
);
router.patch(
  "/me/leave-requests/:leaveRequestId/thread/messages/:messageId/accept",
  leavesController.acceptMyLeaveThreadProposal,
);
router.post(
  "/me/leave-requests",
  validate(createLeaveRequestSchema),
  leavesController.createLeaveRequest,
);
router.patch(
  "/me/leave-requests/:leaveRequestId/cancel",
  leavesController.cancelLeaveRequest,
);
// Device change requests
router.get(
  "/me/device-change-requests",
  deviceChangesController.getMyDeviceChangeRequests,
);
router.post(
  "/me/device-change-requests",
  validate(createDeviceChangeSchema),
  deviceChangesController.createDeviceChangeRequest,
);
export default router;
