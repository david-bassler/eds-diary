import { utf8 } from './bytes'

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue }

function serialize(value: CanonicalValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON rejects non-finite numbers.')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`
}

export function canonicalJson(value: CanonicalValue): string {
  return serialize(value)
}

export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return utf8(canonicalJson(value))
}
