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

/** Strict import parser for user-supplied JSON documents.  It rejects duplicate
 * properties and non-I-JSON values but deliberately does not require the source
 * bytes themselves to be JCS-canonical.  This keeps legacy pretty-printed exports
 * importable while all cryptographic comparisons still use canonicalJson/Bytes. */
export function parseStrictJson(bytes: Uint8Array): CanonicalValue {
  const source = decodeUtf8(bytes)
  rejectDuplicateProperties(source)
  const parsed: unknown = JSON.parse(source)
  assertIJson(parsed as CanonicalValue)
  canonicalJson(parsed as CanonicalValue)
  return parsed as CanonicalValue
}

export function parseCanonicalJson(bytes: Uint8Array): CanonicalValue {
  const source = decodeUtf8(bytes)
  const parsed = parseStrictJson(bytes)
  if (canonicalJson(parsed) !== source) throw new Error('JSON is not canonical JCS or contains unsupported values.')
  return parsed
}

/** JSON.parse silently applies last-key-wins.  This small grammar walk records
 * object member names before materialisation, including names containing JSON
 * escapes (for example `"a"` and `"\u0061"`). */
function rejectDuplicateProperties(source: string): void {
  let offset = 0
  const whitespace = () => { while (/\s/u.test(source[offset] ?? '')) offset += 1 }
  const string = (): string => {
    const start = offset
    if (source[offset++] !== '"') throw new Error('Invalid JSON string.')
    while (offset < source.length) {
      const character = source[offset++]
      if (character === '"') return JSON.parse(source.slice(start, offset)) as string
      if (character === '\\') {
        if (source[offset] === 'u') offset += 5
        else offset += 1
      } else if (character < ' ') throw new Error('Invalid JSON string.')
    }
    throw new Error('Unterminated JSON string.')
  }
  const value = (): void => {
    whitespace()
    if (source[offset] === '{') {
      offset += 1; whitespace(); const keys = new Set<string>()
      if (source[offset] === '}') { offset += 1; return }
      while (true) {
        whitespace(); const key = string()
        if (keys.has(key)) throw new Error(`Duplicate JSON property: ${key}`)
        keys.add(key); whitespace()
        if (source[offset++] !== ':') throw new Error('Invalid JSON object.')
        value(); whitespace()
        const separator = source[offset++]
        if (separator === '}') return
        if (separator !== ',') throw new Error('Invalid JSON object.')
      }
    }
    if (source[offset] === '[') {
      offset += 1; whitespace()
      if (source[offset] === ']') { offset += 1; return }
      while (true) {
        value(); whitespace(); const separator = source[offset++]
        if (separator === ']') return
        if (separator !== ',') throw new Error('Invalid JSON array.')
      }
    }
    if (source[offset] === '"') { string(); return }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset))
    if (!match) throw new Error('Invalid JSON value.')
    offset += match[0].length
  }
  value(); whitespace()
  if (offset !== source.length) throw new Error('Trailing JSON input.')
}

export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return utf8(canonicalJson(value))
}
