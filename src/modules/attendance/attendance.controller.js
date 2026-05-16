import { sendSuccess, sendCreated } from '../../common/response.js';
import * as attendanceService from './attendance.service.js';

export async function punchIn(req, res) {
    // Device ID is validated by requireDeviceId middleware
    const punch = await attendanceService.punchIn(req.user.sub, req.body, req.deviceId);
    sendCreated(res, punch, 'Punched in');
}

export async function punchOut(req, res) {
    // Device ID is validated by requireDeviceId middleware
    const punch = await attendanceService.punchOut(req.user.sub, req.deviceId, req.body ?? {});
    sendSuccess(res, punch, undefined, 'Punched out');
}
export async function myAttendanceOverview(req, res) {
    // Query is validated by middleware
    const { startDate, endDate, includeHolidayHistory } = req.query;
    const result = await attendanceService.getUserAttendanceOverview(req.user.sub, startDate, endDate, includeHolidayHistory);
    sendSuccess(res, result);
}
export async function webAttendanceOverview(req, res) {
    // Query is validated by middleware (page/limit are already numbers)
    const result = await attendanceService.getWebAttendanceOverview(req.user.roles, req.user.sub, req.query);
    sendSuccess(res, result.items, { ...result.meta, range: result.range, aggregate: result.aggregate });
}
export async function webAttendanceRecords(req, res) {
    // Query is validated by middleware
    const result = await attendanceService.getWebAttendanceRecords(req.user.roles, req.user.sub, req.query);
    sendSuccess(res, result.items, { ...result.meta, range: result.range });
}
export async function upsertRegularization(req, res) {
    const result = await attendanceService.upsertRegularization(req.user.roles, req.user.sub, req.params.userId, req.params.date, req.body);
    sendSuccess(res, result, undefined, 'Regularization saved');
}
export async function deleteRegularization(req, res) {
    await attendanceService.deleteRegularization(req.user.roles, req.user.sub, req.params.userId, req.params.date);
    sendSuccess(res, null, undefined, 'Regularization deleted');
}
