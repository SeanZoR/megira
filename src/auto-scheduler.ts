import {
  getReadyContentWithoutSchedule,
  getScheduledTimes,
  createScheduleEntry,
  markContentScheduled,
} from './notion';

// Optimal posting times for Israeli audience (Israel time)
// Posts every day including weekends
const OPTIMAL_SLOTS = [
  { hour: 8, minute: 3 },
  { hour: 12, minute: 35 },
  { hour: 15, minute: 43 },
  { hour: 17, minute: 30 },
];

// Add randomness to avoid posting at exact same time every day
// Returns a random offset between 0 and 12 minutes forward
function getRandomMinuteOffset(): number {
  return Math.floor(Math.random() * 13); // 0 to 12
}

interface Bindings {
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  NOTION_SCHEDULE_DB_ID: string;
  TIMEZONE: string;
}

/**
 * Get all available time slots for the next 14 days
 * 4 slots per day, every day, with slight randomness in timing
 */
function getAvailableSlots(
  timezone: string,
  takenTimes: Date[],
  daysAhead: number = 14
): Date[] {
  const now = new Date();
  const slots: Date[] = [];

  // Generate slots for the next N days
  for (let day = 0; day < daysAhead; day++) {
    for (const slot of OPTIMAL_SLOTS) {
      // Create date in Israel timezone
      const localNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const slotDate = new Date(localNow);
      slotDate.setDate(localNow.getDate() + day);

      // Add randomness: base time + 0-12 minutes forward
      const randomOffset = getRandomMinuteOffset();
      slotDate.setHours(slot.hour, slot.minute + randomOffset, 0, 0);

      const utcSlot = new Date(slotDate.getTime());

      // Skip if in the past
      if (utcSlot <= now) continue;

      // Skip if already taken (within 30 min window)
      const isTaken = takenTimes.some((taken) => {
        const diff = Math.abs(taken.getTime() - utcSlot.getTime());
        return diff < 30 * 60 * 1000; // 30 minutes
      });

      if (!isTaken) {
        slots.push(utcSlot);
      }
    }
  }

  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Determine platforms based on content's Platforms field
 * If empty, defaults to both X and LinkedIn
 */
function determinePlatforms(platforms?: string[]): string[] {
  if (!platforms || platforms.length === 0) {
    return ['X', 'LinkedIn'];
  }
  return platforms;
}

/**
 * Auto-schedule Ready content into the next available optimal time slots
 * Buffer-style: fills up the queue with optimal posting times
 * Content marked "Immediate schedule?" will be scheduled for immediate publishing
 */
export async function autoScheduleReadyContent(
  env: Bindings
): Promise<{ scheduled: number; errors: string[] }> {
  const errors: string[] = [];
  let scheduled = 0;

  try {
    // Get Ready content that doesn't have a schedule yet
    const readyContent = await getReadyContentWithoutSchedule(
      env.NOTION_TOKEN,
      env.NOTION_DATABASE_ID,
      env.NOTION_SCHEDULE_DB_ID
    );

    if (readyContent.length === 0) {
      console.log('No Ready content to schedule');
      return { scheduled: 0, errors: [] };
    }

    console.log(`Found ${readyContent.length} Ready posts to auto-schedule`);

    // Split into immediate and regular content
    const immediateContent = readyContent.filter((c) => c.immediateSchedule);
    const regularContent = readyContent.filter((c) => !c.immediateSchedule);

    console.log(`  - ${immediateContent.length} marked for immediate publishing`);
    console.log(`  - ${regularContent.length} for optimal slot scheduling`);

    // Schedule immediate content first (use current time so publisher picks it up)
    for (const content of immediateContent) {
      const platforms = determinePlatforms(content.platforms);
      const now = new Date();

      try {
        await createScheduleEntry(
          env.NOTION_TOKEN,
          env.NOTION_SCHEDULE_DB_ID,
          content.id,
          content.title || 'Untitled',
          now,
          platforms,
          content.includeQuote
        );

        await markContentScheduled(env.NOTION_TOKEN, content.id);

        console.log(
          `Scheduled "${content.title}" for IMMEDIATE publishing on ${platforms.join(', ')}`
        );
        scheduled++;
      } catch (error) {
        errors.push(`Failed to schedule "${content.title}": ${error}`);
      }
    }

    // Schedule regular content to optimal slots
    if (regularContent.length > 0) {
      // Get already scheduled times
      const takenTimes = await getScheduledTimes(
        env.NOTION_TOKEN,
        env.NOTION_SCHEDULE_DB_ID
      );

      // Get available slots
      const availableSlots = getAvailableSlots(env.TIMEZONE, takenTimes);

      if (availableSlots.length === 0 && regularContent.length > 0) {
        errors.push('No available time slots in the next 14 days');
      }

      // Assign each regular content to the next available slot
      for (let i = 0; i < regularContent.length; i++) {
        const content = regularContent[i];

        if (i >= availableSlots.length) {
          errors.push(`No more slots available for: ${content.title}`);
          continue;
        }

        const slot = availableSlots[i];
        const platforms = determinePlatforms(content.platforms);

        try {
          await createScheduleEntry(
            env.NOTION_TOKEN,
            env.NOTION_SCHEDULE_DB_ID,
            content.id,
            content.title || 'Untitled',
            slot,
            platforms,
            content.includeQuote
          );

          await markContentScheduled(env.NOTION_TOKEN, content.id);

          console.log(
            `Scheduled "${content.title}" for ${slot.toISOString()} on ${platforms.join(', ')}`
          );
          scheduled++;
        } catch (error) {
          errors.push(`Failed to schedule "${content.title}": ${error}`);
        }
      }
    }
  } catch (error) {
    errors.push(`Auto-scheduler error: ${error}`);
  }

  return { scheduled, errors };
}
