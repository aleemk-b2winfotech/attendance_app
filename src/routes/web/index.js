import { Router } from "express";
import {
  authenticate,
  requirePortal,
  requireRoles,
} from "../../middlewares/index.js";
import { validate } from "../../middlewares/validate.js";
import * as authController from "../../modules/auth/auth.controller.js";
import {
  googleLoginWebSchema,
  refreshTokenSchema,
} from "../../modules/auth/auth.schemas.js";
import * as usersController from "../../modules/users/users.controller.js";
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  attendanceProfileSchema,
} from "../../modules/users/users.schemas.js";
import * as attendanceController from "../../modules/attendance/attendance.controller.js";
import {
  regularizationSchema,
  webAttendanceRecordsQuerySchema,
  webAttendanceOverviewQuerySchema,
} from "../../modules/attendance/attendance.schemas.js";
import * as leavesController from "../../modules/leaves/leaves.controller.js";
import {
  leaveActionSchema,
  leaveRejectSchema,
  leaveThreadMessageSchema,
  listLeaveRequestsQuerySchema,
} from "../../modules/leaves/leaves.schemas.js";
import * as deviceChangesController from "../../modules/device-changes/device-changes.controller.js";
import {
  deviceChangeActionSchema,
  deviceChangeRejectSchema,
  listDeviceChangeQuerySchema,
  userDeviceChangeLogsQuerySchema,
} from "../../modules/device-changes/device-changes.schemas.js";
import * as holidaysController from "../../modules/holidays/holidays.controller.js";
import {
  createHolidaySchema,
  updateHolidaySchema,
  deleteHolidaySchema,
  listHolidaysQuerySchema,
} from "../../modules/holidays/holidays.schemas.js";
import * as workFromHomeController from "../../modules/work-from-home/work-from-home.controller.js";
import {
  listWorkFromHomeQuerySchema,
  workFromHomeRangesSchema,
} from "../../modules/work-from-home/work-from-home.schemas.js";
import * as dashboardController from "../../modules/dashboard/dashboard.controller.js";
import { Portal, Role } from "@prisma/client";
const router = Router();
// Public auth endpoints (login / refresh / logout).
router.post(
  "/auth/google/login",
  validate(googleLoginWebSchema),
  authController.webGoogleLogin,
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
// Protected zone: token must be WEB portal. Fine-grained roles applied per route.
router.use(authenticate, requirePortal(Portal.WEB));
// Profile
router.get("/me/profile", usersController.getMyProfile);
// Dashboard
router.get(
  "/dashboard/overview",
  requireRoles(Role.MANAGER, Role.ADMIN),
  dashboardController.webDashboard,
);
// Users
router.get(
  "/users",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(listUsersQuerySchema, "query"),
  usersController.listUsers,
);
router.post(
  "/users",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(createUserSchema),
  usersController.createUser,
);
router.patch(
  "/users/:userId",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(updateUserSchema),
  usersController.updateUser,
);
router.patch(
  "/users/:userId/deactivate",
  requireRoles(Role.MANAGER, Role.ADMIN),
  usersController.deactivateUser,
);
// Attendance profiles
router.get(
  "/users/:userId/attendance-profile",
  requireRoles(Role.MANAGER, Role.ADMIN),
  usersController.getAttendanceProfile,
);
router.put(
  "/users/:userId/attendance-profile",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(attendanceProfileSchema),
  usersController.updateAttendanceProfile,
);
// Attendance overview
router.get(
  "/attendance/overview",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(webAttendanceOverviewQuerySchema, "query"),
  attendanceController.webAttendanceOverview,
);
router.get(
  "/attendance/records",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(webAttendanceRecordsQuerySchema, "query"),
  attendanceController.webAttendanceRecords,
);
router.get(
  "/attendance/work-from-home",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(listWorkFromHomeQuerySchema, "query"),
  workFromHomeController.listWorkFromHomeDays,
);
// Regularizations
router.put(
  "/users/:userId/attendance-regularizations/:date",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(regularizationSchema),
  attendanceController.upsertRegularization,
);
router.delete(
  "/users/:userId/attendance-regularizations/:date",
  requireRoles(Role.MANAGER, Role.ADMIN),
  attendanceController.deleteRegularization,
);
router.post(
  "/users/:userId/attendance/work-from-home",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(workFromHomeRangesSchema),
  workFromHomeController.assignWorkFromHomeDays,
);
router.delete(
  "/users/:userId/attendance/work-from-home",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(workFromHomeRangesSchema),
  workFromHomeController.deleteWorkFromHomeDays,
);
// Leave requests
router.get(
  "/leave-requests",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(listLeaveRequestsQuerySchema, "query"),
  leavesController.listLeaveRequestsWeb,
);
router.get(
  "/leave-requests/:leaveRequestId/thread",
  requireRoles(Role.MANAGER, Role.ADMIN),
  leavesController.getLeaveRequestThreadWeb,
);
router.post(
  "/leave-requests/:leaveRequestId/thread/messages",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(leaveThreadMessageSchema),
  leavesController.createLeaveThreadMessageWeb,
);
router.patch(
  "/leave-requests/:leaveRequestId/thread/messages/:messageId/accept",
  requireRoles(Role.MANAGER, Role.ADMIN),
  leavesController.acceptLeaveThreadProposalWeb,
);
router.patch(
  "/leave-requests/:leaveRequestId/approve",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(leaveActionSchema),
  leavesController.approveLeaveRequest,
);
router.patch(
  "/leave-requests/:leaveRequestId/reject",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(leaveRejectSchema),
  leavesController.rejectLeaveRequest,
);
// Device change requests
router.get(
  "/device-change-requests",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(listDeviceChangeQuerySchema, "query"),
  deviceChangesController.listDeviceChangeRequestsWeb,
);
router.get(
  "/users/:userId/device-change-logs",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(userDeviceChangeLogsQuerySchema, "query"),
  deviceChangesController.listDeviceChangeLogsForUser,
);
router.patch(
  "/device-change-requests/:requestId/approve",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(deviceChangeActionSchema),
  deviceChangesController.approveDeviceChange,
);
router.patch(
  "/device-change-requests/:requestId/reject",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(deviceChangeRejectSchema),
  deviceChangesController.rejectDeviceChange,
);
// Holidays: read for manager/admin, mutate/delete for admin only.
router.get(
  "/holidays",
  requireRoles(Role.MANAGER, Role.ADMIN),
  validate(listHolidaysQuerySchema, "query"),
  holidaysController.listHolidays,
);
router.get(
  "/holidays/:holidayId/history",
  requireRoles(Role.MANAGER, Role.ADMIN),
  holidaysController.getHolidayHistory,
);
router.post(
  "/holidays",
  requireRoles(Role.ADMIN),
  validate(createHolidaySchema),
  holidaysController.createHoliday,
);
router.patch(
  "/holidays/:holidayId",
  requireRoles(Role.ADMIN),
  validate(updateHolidaySchema),
  holidaysController.updateHoliday,
);
router.delete(
  "/holidays/:holidayId",
  requireRoles(Role.ADMIN),
  validate(deleteHolidaySchema),
  holidaysController.deleteHoliday,
);
export default router;
