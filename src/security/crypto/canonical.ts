import canonicalize from 'canonicalize'
import { decodeUtf8, utf8 } from './bytes'

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue }

function assertIJson(value: CanonicalValue): void {
  if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value))) throw new Error('I-JSON requires finite safe integers.')
  if (typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) index += 1
      else if (code >= 0xd800 && code <= 0xdfff) throw new Error('I-JSON rejects unpaired surrogates.')
    }
  }
  if (Array.isArray(value)) value.forEach(assertIJson)
  else if (value && typeof value === 'object') Object.values(value).forEach(assertIJson)
}

export function canonicalJson(value: CanonicalValue): string {
  assertIJson(value)
  const result = canonicalize(value)
  if (result === undefined) throw new Error('Value cannot be represented as canonical JSON.')
  return result
}

export function parseCanonicalJson(bytes: Uint8Array): CanonicalValue {
  const source = decodeUtf8(bytes)
  const parsed: unknown = JSON.parse(source)
  if (canonicalJson(parsed as CanonicalValue) !== source) throw new Error('JSON is not canonical JCS or contains unsupported values.')
  return parsed as CanonicalValue
}

export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return utf8(canonicalJson(value))
}
