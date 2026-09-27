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
  for (const point of scenario.points) {
    await scenario.prepare(point)
    await scenario.crash(point)
    await scenario.restart(point)
    await scenario.unlock(point)
    await scenario.resume(point)
    await scenario.verify(point)
  }
  await scenario.finish()
  await scenario.verifyFinished()
}
