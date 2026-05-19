import { sendSuccess, sendCreated } from '../../common/response.js';
import * as leavesService from './leaves.service.js';
// Thin transport/controller wrapper around leave domain rules.
export async function createLeaveRequest(req, res) {
    const result = await leavesService.createLeaveRequest(req.user.sub, req.body);
    sendCreated(res, result, 'Leave request created');
}
export async function getMyLeaveRequests(req, res) {
    // Query is validated by middleware (page/limit are already numbers).
    const result = await leavesService.getMyLeaveRequests(req.user.sub, req.query);
    sendSuccess(res, result.items, result.meta);
}
export async function cancelLeaveRequest(req, res) {
    const result = await leavesService.cancelLeaveRequest(req.user.sub, req.params.leaveRequestId);
    sendSuccess(res, result, undefined, 'Leave request cancelled');
}
export async function listLeaveRequestsWeb(req, res) {
    // Query is validated by middleware (page/limit are already numbers)
    const result = await leavesService.listLeaveRequestsWeb(req.user.roles, req.user.sub, req.query);
    sendSuccess(res, result.items, result.meta);
}
export async function approveLeaveRequest(req, res) {
    const result = await leavesService.approveLeaveRequest(req.user.roles, req.user.sub, req.params.leaveRequestId, req.body?.actionNote);
    sendSuccess(res, result, undefined, 'Leave request approved');
}
export async function rejectLeaveRequest(req, res) {
    const result = await leavesService.rejectLeaveRequest(req.user.roles, req.user.sub, req.params.leaveRequestId, req.body.actionNote);
    sendSuccess(res, result, undefined, 'Leave request rejected');
}

export async function getMyLeaveRequestThread(req, res) {
    const result = await leavesService.getMyLeaveRequestThread(req.user.sub, req.params.leaveRequestId);
    sendSuccess(res, result);
}

export async function createMyLeaveThreadMessage(req, res) {
    const result = await leavesService.createMyLeaveThreadMessage(req.user.sub, req.params.leaveRequestId, req.body);
    sendCreated(res, result, 'Leave thread message created');
}

export async function acceptMyLeaveThreadProposal(req, res) {
    const result = await leavesService.acceptMyLeaveThreadProposal(req.user.sub, req.params.leaveRequestId, req.params.messageId);
    sendSuccess(res, result, undefined, 'Leave proposal accepted');
}

export async function getLeaveRequestThreadWeb(req, res) {
    const result = await leavesService.getLeaveRequestThreadWeb(req.user.roles, req.user.sub, req.params.leaveRequestId);
    sendSuccess(res, result);
}

export async function createLeaveThreadMessageWeb(req, res) {
    const result = await leavesService.createLeaveThreadMessageWeb(req.user.roles, req.user.sub, req.params.leaveRequestId, req.body);
    sendCreated(res, result, 'Leave thread message created');
}

export async function acceptLeaveThreadProposalWeb(req, res) {
    const result = await leavesService.acceptLeaveThreadProposalWeb(req.user.roles, req.user.sub, req.params.leaveRequestId, req.params.messageId);
    sendSuccess(res, result, undefined, 'Leave proposal accepted');
}
