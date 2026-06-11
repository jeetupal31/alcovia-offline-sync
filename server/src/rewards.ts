// Pure helpers for the server-side reward logic.
// Mirrors app/src/reducer.ts so server and clients agree on the rules.

export function rewardFor(targetMin: number): number {
  // 2 coins per target minute, minimum 1 (documented in README)
  return Math.max(1, Math.round(targetMin * 2));
}

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// streak = consecutive days, ending at the most recent success date,
// that each have at least one successful session
export function computeStreak(successDates: Set<string>): number {
  if (successDates.size === 0) return 0;
  const sorted = [...successDates].sort();
  let streak = 0;
  const d = new Date(`${sorted[sorted.length - 1]}T00:00:00`);
  while (successDates.has(fmtDate(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
