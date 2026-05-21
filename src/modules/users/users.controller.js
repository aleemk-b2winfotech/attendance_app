import { sendSuccess, sendCreated } from '../../common/response.js';
import * as usersService from './users.service.js';
// Controllers keep transport concerns only; all authorization rules live in service layer.
export async function listUsers(req, res) {
    const result = await usersService.listUsers(req.user.roles, req.user.sub, req.query);
    sendSuccess(res, result.items, result.meta);
}
export async function createUser(req, res) {
    const user = await usersService.createUser(req.user.roles, req.user.sub, req.body);
    sendCreated(res, user, 'User created');
}
export async function updateUser(req, res) {
    const user = await usersService.updateUser(req.user.roles, req.user.sub, req.params.userId, req.body);
    sendSuccess(res, user, undefined, 'User updated');
}
export async function deactivateUser(req, res) {
    const user = await usersService.deactivateUser(req.user.roles, req.user.sub, req.params.userId);
    sendSuccess(res, user, undefined, 'User deactivated');
}
export async function activateUser(req, res) {
    const user = await usersService.activateUser(req.user.roles, req.user.sub, req.params.userId);
    sendSuccess(res, user, undefined, 'User activated');
}
export async function getAttendanceProfile(req, res) {
    const profile = await usersService.getAttendanceProfile(req.user.roles, req.user.sub, req.params.userId);
    sendSuccess(res, profile);
}
export async function updateAttendanceProfile(req, res) {
    const profile = await usersService.updateAttendanceProfile(req.user.roles, req.user.sub, req.params.userId, req.body);
    sendSuccess(res, profile, undefined, 'Attendance profile updated');
}
export async function getMyProfile(req, res) {
    const user = await usersService.getMyProfile(req.user.sub);
    sendSuccess(res, user);
}
//# sourceMappingURL=users.controller.js.map
