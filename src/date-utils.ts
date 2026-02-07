/**
 * Date utility functions for consistent date handling across the application.
 * All dates are handled in UTC timezone to avoid inconsistencies.
 */

/**
 * Convert a YYYY-MM-DD string to a Date object at start of day (00:00:00.000 UTC)
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object at midnight UTC, or null if invalid
 *
 * @example
 * parseStartOfDay('2026-02-05') // Returns: 2026-02-05T00:00:00.000Z
 * parseStartOfDay('02/05/2026') // Returns: null (invalid format)
 * parseStartOfDay('2026-02-31') // Returns: null (invalid date)
 */
export function parseStartOfDay(dateStr: string): Date | null {
  // Validate format: YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return null;
  }

  const date = new Date(dateStr + 'T00:00:00.000Z');

  // Check if date is valid (e.g., not 2026-02-31)
  if (isNaN(date.getTime())) {
    return null;
  }

  // Verify the date didn't roll over (e.g., 2026-02-31 becomes 2026-03-03)
  const isoDate = date.toISOString().split('T')[0];
  if (isoDate !== dateStr) {
    return null;
  }

  return date;
}

/**
 * Convert a YYYY-MM-DD string to a Date object at end of day (23:59:59.999 UTC)
 * This ensures the entire day is included when filtering by end date.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object at end of day UTC, or null if invalid
 *
 * @example
 * parseEndOfDay('2026-02-05') // Returns: 2026-02-05T23:59:59.999Z
 * parseEndOfDay('02/05/2026') // Returns: null (invalid format)
 * parseEndOfDay('2026-02-31') // Returns: null (invalid date)
 */
export function parseEndOfDay(dateStr: string): Date | null {
  // Validate format: YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return null;
  }

  const date = new Date(dateStr + 'T23:59:59.999Z');

  // Check if date is valid (e.g., not 2026-02-31)
  if (isNaN(date.getTime())) {
    return null;
  }

  // Verify the date didn't roll over (e.g., 2026-02-31 becomes 2026-03-03)
  const isoDate = date.toISOString().split('T')[0];
  if (isoDate !== dateStr) {
    return null;
  }

  return date;
}

/**
 * Validate a date range (start must be before or equal to end)
 * @param dateFrom - Start date
 * @param dateTo - End date
 * @returns true if range is valid, false otherwise
 *
 * @example
 * isValidDateRange(
 *   new Date('2026-02-01T00:00:00.000Z'),
 *   new Date('2026-02-05T23:59:59.999Z')
 * ) // Returns: true
 *
 * isValidDateRange(
 *   new Date('2026-02-10T00:00:00.000Z'),
 *   new Date('2026-02-05T23:59:59.999Z')
 * ) // Returns: false
 */
export function isValidDateRange(dateFrom: Date, dateTo: Date): boolean {
  return dateFrom.getTime() <= dateTo.getTime();
}

/**
 * Format a date range for display
 * @param dateFrom - Start date (can be null)
 * @param dateTo - End date (can be null)
 * @returns Human-readable date range string
 *
 * @example
 * formatDateRange(
 *   new Date('2026-02-01T00:00:00.000Z'),
 *   new Date('2026-02-05T23:59:59.999Z')
 * ) // Returns: "2026-02-01 to 2026-02-05 (inclusive)"
 *
 * formatDateRange(new Date('2026-02-01T00:00:00.000Z'), null)
 * // Returns: "From 2026-02-01 onwards"
 *
 * formatDateRange(null, null)
 * // Returns: "All dates"
 */
export function formatDateRange(dateFrom: Date | null, dateTo: Date | null): string {
  if (!dateFrom && !dateTo) {
    return 'All dates';
  }

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  };

  if (dateFrom && dateTo) {
    return `${formatDate(dateFrom)} to ${formatDate(dateTo)} (inclusive)`;
  } else if (dateFrom) {
    return `From ${formatDate(dateFrom)} onwards`;
  } else {
    return `Up to ${formatDate(dateTo!)} (inclusive)`;
  }
}
