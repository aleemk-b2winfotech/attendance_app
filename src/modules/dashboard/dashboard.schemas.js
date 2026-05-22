import { z } from 'zod';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function validateDateRange(schema) {
  return schema.refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
    path: ['endDate'],
    message: 'endDate must be on or after startDate',
  });
}

export const webDashboardQuerySchema = validateDateRange(z.object({
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  isActive: z.preprocess((value) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return true;
  }, z.boolean().optional()),
}).strict());
