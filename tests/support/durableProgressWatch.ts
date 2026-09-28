/** A bounded watchdog for long-running, crash-resumable browser ceremonies.
 * Durable stage changes count as progress; repeated reads of the same stage do not.
 * The absolute deadline still fails a ceremony that keeps creating new work.
 * This observes production persistence but never changes the ceremony or its security checks. */
export async function runWithDurableProgress<T>(
  work: () => Promise<T>,
  options: {
    label: string
    observeStages: () => Promise<readonly string[]>
    pollIntervalMs: number
    idleTimeoutMs: number
    totalTimeoutMs: number
  },
): Promise<T> {
  const { label, observeStages, pollIntervalMs, idleTimeoutMs, totalTimeoutMs } = options
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0
    || !Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= pollIntervalMs
    || !Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= idleTimeoutMs) {
    throw new Error('Durable progress watchdog requires finite increasing poll, idle and total deadlines.')
  }
  let stages = (await observeStages()).join(',')
  const started = Date.now()
  let lastProgress = started
  let observing = false
  let stopped = false
  let fail!: (error: Error) => void
  const deadline = new Promise<never>((_, reject: (error: Error) => void) => { fail = reject })
  const describe = (kind: string): Error => new Error(
    `Durable progress ${kind}: ${label} stage=${stages || 'not-started'} elapsedMs=${Date.now() - started}`,
  )

  const sample = async (): Promise<void> => {
    if (observing || stopped) return
    observing = true
    try {
      const observed = (await observeStages()).join(',')
      if (stopped) return
      if (observed !== stages) {
        stages = observed
        lastProgress = Date.now()
      }
      if (Date.now() - lastProgress >= idleTimeoutMs) fail(describe('stalled'))
    } catch (error) {
      if (!stopped) fail(new Error(`Durable progress observation failed: ${label}`, { cause: error }))
    } finally {
      observing = false
    }
  }

  const poll = setInterval(() => { void sample() }, pollIntervalMs)
  const hardDeadline = setTimeout(() => fail(describe('total deadline exceeded')), totalTimeoutMs)
  try {
    return await Promise.race([Promise.resolve().then(work), deadline])
  } finally {
    stopped = true
    clearInterval(poll)
    clearTimeout(hardDeadline)
  }
}
