/** Rolling limits for new public plays, per client address. */
export const PUBLISH_LIMITS = [
    { count: 5, seconds: 60 * 60 },
    { count: 10, seconds: 8 * 60 * 60 },
] as const;

/** Seconds until every exceeded rolling window has a free slot. */
export function publishRetryAfter(ages: readonly number[]): number {
    let retryAfter = 0;
    for (const { count, seconds } of PUBLISH_LIMITS) {
        const within = ages.filter(age => age >= 0 && age < seconds);
        if (within.length >= count)
            retryAfter = Math.max(retryAfter, Math.max(1, Math.ceil(seconds - Math.max(...within))));
    }
    return retryAfter;
}

export function publishLimitMessage(retryAfter: number): string {
    return `New public plays are limited to 5 per hour and 10 per 8 hours per client. Try again in ${retryAfter} seconds.`;
}
