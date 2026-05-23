// The ONLY legal way to call any exchange endpoint with a row limit.
// Direct calls with limit:N without this wrapper are forbidden — see CLAUDE.md.

export interface PaginateParams {
  startTime: number
  endTime:   number
  limit?:    number
  delayMs?:  number   // ms between pages — set >0 for rate-limit-sensitive paths
}

export async function paginateByTime<T extends { time: number | string }>(
  fetchPage: (p: { startTime: number; endTime: number; limit: number }) => Promise<T[]>,
  params: PaginateParams,
): Promise<T[]> {
  const limit   = params.limit   ?? 1000
  const delayMs = params.delayMs ?? 0
  const acc: T[] = []
  let cursor = params.startTime

  while (cursor <= params.endTime) {
    // Errors propagate to caller — no silent .catch(() => [])
    const page = await fetchPage({ startTime: cursor, endTime: params.endTime, limit })
    acc.push(...page)
    if (page.length < limit) break
    cursor = Number(page[page.length - 1].time) + 1
    if (delayMs > 0 && cursor <= params.endTime) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return acc
}
