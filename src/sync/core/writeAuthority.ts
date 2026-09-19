import { SINGLE_WRITER_V1_PROFILE, type WriteAuthority } from './contracts'

/** Existing single-writer-v1 authorization semantics, extracted behind a
 * profile policy without changing behavior. Retirement remains an epoch-level
 * coordinator concern; v1 otherwise grants writes after the existing full
 * remote verification. */
export class SingleWriterV1WriteAuthority implements WriteAuthority {
  readonly profileId = SINGLE_WRITER_V1_PROFILE
  authorizeAfterPull(): void {}
  assertBeforePush(): void {}
  assertAfterReadback(): void {}
}

export function singleWriterV1WriteAuthority(): WriteAuthority {
  return new SingleWriterV1WriteAuthority()
}
