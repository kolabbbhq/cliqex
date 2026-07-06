import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayKey = (typeof DAY_KEYS)[number];

interface DaySchedule {
  open: string;
  close: string;
  active: boolean;
}

@Injectable()
export class BusinessHoursService {
  private readonly logger = new Logger(BusinessHoursService.name);

  isOpen(operatingHours: any, timezone = 'Africa/Lagos'): boolean {
    if (!operatingHours || typeof operatingHours !== 'object') return true;

    const now = DateTime.now().setZone(timezone);
    const day = DAY_KEYS[now.weekday % 7] as DayKey; // luxon: 1=Mon…7=Sun
    const schedule: DaySchedule | undefined = operatingHours[day];

    if (!schedule || !schedule.active) return false;
    if (this.isClosedAllDay(schedule)) return false;

    const current = now.toFormat('HH:mm');
    return this.isTimeBetween(current, schedule.open, schedule.close);
  }

  nextOpeningTime(operatingHours: any, timezone = 'Africa/Lagos'): string {
    if (!operatingHours || typeof operatingHours !== 'object') {
      return 'soon — please check back later';
    }

    const now = DateTime.now().setZone(timezone);

    // Check up to 7 days ahead (today inclusive for later-today case)
    for (let offsetDays = 0; offsetDays <= 7; offsetDays++) {
      const candidate = now.plus({ days: offsetDays });
      const dayKey = DAY_KEYS[candidate.weekday % 7] as DayKey;
      const schedule: DaySchedule | undefined = operatingHours[dayKey];

      if (!schedule || !schedule.active || this.isClosedAllDay(schedule)) continue;

      const openTime = schedule.open; // "08:00"
      const [openHour, openMin] = openTime.split(':').map(Number);

      const openDt = candidate.set({ hour: openHour, minute: openMin, second: 0 });

      // For today (offsetDays === 0), only count if open time is still in the future
      if (offsetDays === 0 && openDt <= now) continue;

      const formattedTime = openDt.toFormat('h:mm a'); // "8:00 AM"

      if (offsetDays === 0) return `today at ${formattedTime}`;
      if (offsetDays === 1) return `tomorrow at ${formattedTime}`;
      return `${openDt.toFormat('cccc')} at ${formattedTime}`; // "Monday at 8:00 AM"
    }

    return 'soon — please check back later';
  }

  private isClosedAllDay(schedule: DaySchedule): boolean {
    return schedule.open === '00:00' && schedule.close === '00:00';
  }

  private isTimeBetween(current: string, open: string, close: string): boolean {
    return current >= open && current <= close;
  }
}