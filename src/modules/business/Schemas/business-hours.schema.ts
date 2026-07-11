// src/modules/business/schemas/business-hours.schema.ts
import { z } from 'zod';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DayScheduleSchema = z.object({
  open: z.string().regex(TIME_REGEX, 'Expected HH:mm, e.g. 08:00'),
  close: z.string().regex(TIME_REGEX, 'Expected HH:mm, e.g. 20:00'),
  active: z.boolean(),
});

export const UpdateOperatingHoursSchema = z.object({
  mon: DayScheduleSchema,
  tue: DayScheduleSchema,
  wed: DayScheduleSchema,
  thu: DayScheduleSchema,
  fri: DayScheduleSchema,
  sat: DayScheduleSchema,
  sun: DayScheduleSchema,
});

export type UpdateOperatingHoursInput = z.infer<typeof UpdateOperatingHoursSchema>;