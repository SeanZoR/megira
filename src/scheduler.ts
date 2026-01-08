// Optimal posting times for Tel Aviv (IST/IDT)
// LinkedIn: 7-8 AM, 12 PM, 5-6 PM local
// X/Twitter: 9 AM, 12 PM, 5 PM local

interface TimeSlot {
  hour: number;
  minute: number;
  platforms: ('linkedin' | 'x')[];
}

const OPTIMAL_SLOTS: TimeSlot[] = [
  { hour: 7, minute: 0, platforms: ['linkedin'] },
  { hour: 7, minute: 30, platforms: ['linkedin'] },
  { hour: 8, minute: 0, platforms: ['linkedin'] },
  { hour: 9, minute: 0, platforms: ['x'] },
  { hour: 12, minute: 0, platforms: ['linkedin', 'x'] },
  { hour: 17, minute: 0, platforms: ['linkedin', 'x'] },
  { hour: 17, minute: 30, platforms: ['linkedin'] },
  { hour: 18, minute: 0, platforms: ['linkedin'] },
];

// Window of ±30 minutes around optimal times
const WINDOW_MINUTES = 30;

export function isWithinPostingWindow(timezone: string): boolean {
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentHour = localTime.getHours();
  const currentMinute = localTime.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  for (const slot of OPTIMAL_SLOTS) {
    const slotTotalMinutes = slot.hour * 60 + slot.minute;
    if (Math.abs(currentTotalMinutes - slotTotalMinutes) <= WINDOW_MINUTES) {
      return true;
    }
  }

  return false;
}

export function getNextOptimalSlot(timezone: string): number {
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentHour = localTime.getHours();
  const currentMinute = localTime.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  // Find next slot today
  for (const slot of OPTIMAL_SLOTS) {
    const slotTotalMinutes = slot.hour * 60 + slot.minute;
    if (slotTotalMinutes > currentTotalMinutes) {
      const targetDate = new Date(localTime);
      targetDate.setHours(slot.hour, slot.minute, 0, 0);
      return targetDate.getTime();
    }
  }

  // No more slots today, get first slot tomorrow
  const tomorrow = new Date(localTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(OPTIMAL_SLOTS[0].hour, OPTIMAL_SLOTS[0].minute, 0, 0);
  return tomorrow.getTime();
}

export function getOptimalSlotsForToday(timezone: string): Date[] {
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

  return OPTIMAL_SLOTS.map(slot => {
    const date = new Date(localTime);
    date.setHours(slot.hour, slot.minute, 0, 0);
    return date;
  }).filter(date => date > now);
}
