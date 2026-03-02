/**
 * Truncate a string to maxLen and append suffix if truncated.
 */
export function truncate(
  str: string,
  maxLen: number,
  suffix = "...truncated"
): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + suffix;
}
