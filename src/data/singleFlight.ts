export interface SingleFlight<T> {
  run(work: () => Promise<T>): Promise<T>
}

/** Shares only the currently running operation. Settled values and failures are
 * never cached, so callers always observe the next authoritative read. */
export function createSingleFlight<T>(): SingleFlight<T> {
  let inFlight: Promise<T> | null = null
  return {
    run(work) {
      if (inFlight) return inFlight
      const current = work()
      inFlight = current
      void current.finally(() => {
        if (inFlight === current) inFlight = null
      }).catch(() => undefined)
      return current
    },
  }
}
