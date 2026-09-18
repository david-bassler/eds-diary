import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import {
  assertWebAuthnPrf,
  enrollWebAuthnPrf,
  WebAuthnPrfUnavailableError,
} from '../security/webauthnPrf'

function buffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function bytes(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
}

function fakeCredential(
  credentialId: Uint8Array,
  extensionResults: Record<string, unknown>,
): PublicKeyCredential {
  return {
    id: base64Url(credentialId),
    type: 'public-key',
    rawId: buffer(credentialId),
    getClientExtensionResults: () => extensionResults,
  } as unknown as PublicKeyCredential
}

describe('WebAuthn PRF browser ceremony', () => {
  const create = vi.fn()
  const get = vi.fn()

  beforeEach(() => {
    create.mockReset()
    get.mockReset()
    vi.stubGlobal('navigator', { credentials: { create, get } })
    vi.stubGlobal('location', { hostname: 'diary.example.test' })
    vi.stubGlobal('isSecureContext', true)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('requires UV, binds the exact credential and proves a 32-byte PRF result after enrollment', async () => {
    const credentialId = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
    const prfOutput = Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
    create.mockResolvedValue(fakeCredential(credentialId, { prf: { enabled: true } }))
    get.mockResolvedValue(
      fakeCredential(credentialId, { prf: { results: { first: buffer(prfOutput) } } }),
    )

    const material = await enrollWebAuthnPrf()

    expect(material.credentialId).toEqual(credentialId)
    expect(material.prfEvalInput).toHaveLength(32)
    expect(material.prfOutput).toEqual(prfOutput)
    expect(material.rpId).toBe('diary.example.test')

    const creation = create.mock.calls[0]![0] as CredentialCreationOptions
    expect(creation.publicKey?.authenticatorSelection?.userVerification).toBe('required')
    expect(creation.publicKey?.rp.id).toBe('diary.example.test')

    const request = get.mock.calls[0]![0] as CredentialRequestOptions
    expect(request.publicKey?.userVerification).toBe('required')
    expect(request.publicKey?.rpId).toBe('diary.example.test')
    expect(bytes(request.publicKey!.allowCredentials![0]!.id)).toEqual(credentialId)
    const extensions = request.publicKey?.extensions as unknown as {
      prf: { evalByCredential: Record<string, { first: BufferSource }> }
    }
    expect(Object.keys(extensions.prf.evalByCredential)).toEqual([base64Url(credentialId)])
    expect(bytes(extensions.prf.evalByCredential[base64Url(credentialId)]!.first)).toEqual(
      material.prfEvalInput,
    )
  })

  it('accepts a credential when registration does not advertise PRF but the post-enrollment assertion proves it', async () => {
    const credentialId = new Uint8Array(32).fill(7)
    const prfOutput = new Uint8Array(32).fill(8)
    create.mockResolvedValue(fakeCredential(credentialId, { prf: { enabled: false } }))
    get.mockResolvedValue(
      fakeCredential(credentialId, { prf: { results: { first: buffer(prfOutput) } } }),
    )

    await expect(enrollWebAuthnPrf()).resolves.toMatchObject({
      credentialId,
      prfOutput,
      rpId: 'diary.example.test',
    })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('fails closed when registration is inconclusive and the post-enrollment assertion has no PRF result', async () => {
    const credentialId = new Uint8Array(32).fill(13)
    create.mockResolvedValue(fakeCredential(credentialId, { prf: { enabled: false } }))
    get.mockResolvedValue(fakeCredential(credentialId, { prf: {} }))

    await expect(enrollWebAuthnPrf()).rejects.toBeInstanceOf(WebAuthnPrfUnavailableError)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the post-enrollment assertion returns another credential', async () => {
    const registeredId = new Uint8Array(32).fill(9)
    const assertedId = new Uint8Array(32).fill(10)
    create.mockResolvedValue(fakeCredential(registeredId, { prf: { enabled: true } }))
    get.mockResolvedValue(
      fakeCredential(assertedId, {
        prf: { results: { first: buffer(new Uint8Array(32).fill(11)) } },
      }),
    )

    await expect(enrollWebAuthnPrf()).rejects.toThrow(/different credential ID/)
  })

  it('rejects missing or non-32-byte PRF outputs', async () => {
    const credentialId = new Uint8Array(32).fill(12)
    get.mockResolvedValue(fakeCredential(credentialId, { prf: {} }))
    await expect(
      assertWebAuthnPrf(credentialId, new Uint8Array(32), 'diary.example.test'),
    ).rejects.toBeInstanceOf(WebAuthnPrfUnavailableError)

    get.mockResolvedValue(
      fakeCredential(credentialId, {
        prf: { results: { first: buffer(new Uint8Array(31)) } },
      }),
    )
    await expect(
      assertWebAuthnPrf(credentialId, new Uint8Array(32), 'diary.example.test'),
    ).rejects.toThrow(/exactly 32 bytes/)
  })

  it('detects missing WebAuthn APIs and insecure contexts before enrollment', async () => {
    vi.stubGlobal('navigator', {})
    await expect(enrollWebAuthnPrf('diary.example.test')).rejects.toBeInstanceOf(
      WebAuthnPrfUnavailableError,
    )

    vi.stubGlobal('navigator', { credentials: { create, get } })
    vi.stubGlobal('isSecureContext', false)
    await expect(enrollWebAuthnPrf('diary.example.test')).rejects.toThrow(/secure context/)
  })
})
