import { sendSuccess, sendCreated } from '../../common/response.js';
import * as dcService from './device-changes.service.js';
// HTTP handlers for device change workflow.
export async function createDeviceChangeRequest(req, res) {
    const result = await dcService.createDeviceChangeRequest(req.user.sub, req.body);
    sendCreated(res, result, 'Device change request created');
}
export async function getMyDeviceChangeRequests(req, res) {
    // Manual parsing remains here since mobile endpoint doesn't have validation wired
    const filters = {
        status: req.query.status,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
    };
    const result = await dcService.getMyDeviceChangeRequests(req.user.sub, filters);
    sendSuccess(res, result.items, result.meta);
}
export async function listDeviceChangeRequestsWeb(req, res) {
    // Query is validated by middleware (page/limit are already numbers)
    const result = await dcService.listDeviceChangeRequestsWeb(req.user.roles, req.user.sub, req.query);
    sendSuccess(res, result.items, result.meta);
}
export async function listDeviceChangeLogsForUser(req, res) {
    const result = await dcService.listDeviceChangeLogsForUser(req.user.roles, req.user.sub, req.params.userId, req.query);
    sendSuccess(res, result.items, result.meta);
}
export async function approveDeviceChange(req, res) {
    const result = await dcService.approveDeviceChange(req.user.roles, req.user.sub, req.params.requestId, req.body?.actionNote);
    sendSuccess(res, result, undefined, 'Device change approved');
}
export async function rejectDeviceChange(req, res) {
    const result = await dcService.rejectDeviceChange(req.user.roles, req.user.sub, req.params.requestId, req.body.actionNote);
    sendSuccess(res, result, undefined, 'Device change rejected');
}
