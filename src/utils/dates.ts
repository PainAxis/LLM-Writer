import type { WriterTimestamp } from '@/types/writer'

/** Clone Date objects as well as timestamps read from older JSON backups. */
export function toDate(value: WriterTimestamp | null | undefined): Date {
  return new Date(value instanceof Date ? value.getTime() : value ?? NaN)
}
