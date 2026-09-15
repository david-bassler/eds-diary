const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function utf8(value: string): Uint8Array {
  return encoder.encode(value)
}

export function decodeUtf8(value: Uint8Array): string {
  return decoder.decode(value)
}

export function concatBytes(...values: readonly Uint8Array[]): Uint8Array {
  const length = values.reduce((sum, value) => sum + value.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.byteLength
  }
  return result
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1) throw new Error('Invalid random byte length.')
  return crypto.getRandomValues(new Uint8Array(length))
}

export function uint64be(value: number | bigint): Uint8Array {
  const integer = BigInt(value)
  if (integer < 0n || integer > 0xffffffffffffffffn) throw new Error('Value is outside uint64.')
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, integer)
  return bytes
}

export function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid Base64URL value.')
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer
}
