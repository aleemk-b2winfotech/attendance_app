import { sendSuccess, sendCreated } from '../../common/response.js';
import * as holidaysService from './holidays.service.js';
// Controller wrappers for holiday CRUD + audit history endpoints.
export async function createHoliday(req, res) {
    const result = await holidaysService.createHoliday(req.user.sub, req.body);
    sendCreated(res, result, 'Holiday created');
}
export async function updateHoliday(req, res) {
    const result = await holidaysService.updateHoliday(req.user.sub, req.params.holidayId, req.body);
    sendSuccess(res, result, undefined, 'Holiday updated');
}
export async function deleteHoliday(req, res) {
    await holidaysService.deleteHoliday(req.user.sub, req.params.holidayId, req.body.reason);
    sendSuccess(res, null, undefined, 'Holiday deleted');
}
export async function listHolidays(req, res) {
    const result = await holidaysService.listHolidays(req.query);
    sendSuccess(res, result);
}
export async function listEmployeeHolidays(req, res) {
    const result = await holidaysService.listEmployeeHolidays(req.user.sub, req.query);
    sendSuccess(res, result);
}
export async function getHolidayHistory(req, res) {
    const result = await holidaysService.getHolidayHistory(req.params.holidayId);
    sendSuccess(res, result);
}
//# sourceMappingURL=holidays.controller.js.map
