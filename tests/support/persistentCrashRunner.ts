export interface PersistentCrashScenario<Point extends string> {
  readonly points: readonly Point[]
  prepare(point: Point): Promise<void>
  crash(point: Point): Promise<void>
  restart(point: Point): Promise<void>
  unlock(point: Point): Promise<void>
  resume(point: Point): Promise<void>
  verify(point: Point): Promise<void>
  finish(): Promise<void>
  verifyFinished(): Promise<void>
}

/** Reusable browser crash runner. The scenario owns operation-specific fault
 * injection, while this runner enforces the same persistent lifecycle at every
 * named point: fault -> context reload -> unlock -> resume -> canonical verify. */
export async function runPersistentCrashScenario<Point extends string>(
  scenario: PersistentCrashScenario<Point>,
): Promise<void> {
  const runStage = async (point: Point, stage: string, work: () => Promise<void>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Persistent crash stage timed out: point=${point} stage=${stage}`)), 120_000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  for (const point of scenario.points) {
    await runStage(point, 'prepare', () => scenario.prepare(point))
    await runStage(point, 'crash', () => scenario.crash(point))
    await runStage(point, 'restart', () => scenario.restart(point))
    await runStage(point, 'unlock', () => scenario.unlock(point))
    await runStage(point, 'resume', () => scenario.resume(point))
    await runStage(point, 'verify', () => scenario.verify(point))
  }
  await scenario.finish()
  await scenario.verifyFinished()
}
