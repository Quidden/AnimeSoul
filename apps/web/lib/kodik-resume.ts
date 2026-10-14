// Keep unconfirmed seek jumps out of watch progress; retry a lost ready message.
export function kodikResume(start: number) {
  let target = Math.max(0, Math.min(86400, start)),
    confirmed = target === 0,
    first = -1,
    firstObserved = -1,
    last = -Infinity,
    attempts = 0;
  return {
    duration(value: number) {
      if (value > 0) target = Math.min(target, Math.max(0, value - 1));
    },
    seek(now: number): number | null {
      if (confirmed || target <= 0 || attempts >= 6 || now - last < 1500) return null;
      if (first < 0) first = now;
      last = now;
      attempts++;
      return target;
    },
    observe(position: number, now: number): "waiting" | "restored" | "failed" {
      if (confirmed) return "restored";
      if (firstObserved < 0) {
        firstObserved = now;
        attempts = 0;
        last = -Infinity;
      }
      if (Math.abs(position - target) <= 5) {
        confirmed = true;
        return "restored";
      }
      if (first >= 0 && now - firstObserved >= 12000) {
        confirmed = true;
        return "failed";
      }
      return "waiting";
    },
  };
}
