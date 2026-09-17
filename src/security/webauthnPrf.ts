import { base64Url, randomBytes } from './crypto/bytes'
import type { PrfWrapEnrollmentMaterial } from './localState'

export class WebAuthnPrfUnavailableError extends Error {
  constructor(message = 'WebAuthn PRF is unavailable in this browser or authenticator.') {
    super(message)
    this.name = 'WebAuthnPrfUnavailableError'
  }
}

export interface WebAuthnPrfAssertionMaterial {
  credentialId: Uint8Array
  prfOutput: Uint8Array
}

interface PrfClientExtensionResults {
  prf?: {
    enabled?: boolean
    results?: {
      first?: BufferSource
    }
  }
}

function copiedBytes(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0))
  if (!ArrayBuffer.isView(source)) throw new Error('WebAuthn PRF returned an invalid buffer.')
  return new Uint8Array(new Uint8Array(source.buffer, source.byteOffset, source.byteLength))
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

function requireCredentialApi(): CredentialsContainer {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new WebAuthnPrfUnavailableError('WebAuthn credential APIs are unavailable.')
  }
  if (typeof navigator.credentials.create !== 'function' || typeof navigator.credentials.get !== 'function') {
    throw new WebAuthnPrfUnavailableError('WebAuthn credential APIs are incomplete.')
  }
  if (typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext) {
    throw new WebAuthnPrfUnavailableError('WebAuthn PRF requires a secure context.')
  }
  return navigator.credentials
}

function effectiveRpId(explicit?: string): string {
  const rpId = explicit ?? (typeof location === 'undefined' ? '' : location.hostname)
  if (!rpId || rpId.trim() !== rpId) throw new Error('A valid WebAuthn RP ID is required.')
  return rpId
}

function asPublicKeyCredential(value: Credential | null, phase: string): PublicKeyCredential {
  if (
    !value ||
    value.type !== 'public-key' ||
    !('rawId' in value) ||
    typeof (value as Partial<PublicKeyCredential>).getClientExtensionResults !== 'function'
  ) {
    throw new WebAuthnPrfUnavailableError(`WebAuthn ${phase} did not return a public-key credential.`)
  }
  return value as PublicKeyCredential
}

function extensionResults(credential: PublicKeyCredential): PrfClientExtensionResults {
  return credential.getClientExtensionResults() as unknown as PrfClientExtensionResults
}

function verifiedPrfOutput(credential: PublicKeyCredential): Uint8Array {
  const first = extensionResults(credential).prf?.results?.first
  if (!first) throw new WebAuthnPrfUnavailableError('Authenticator did not return a WebAuthn PRF result.')
  const output = copiedBytes(first)
  if (output.byteLength !== 32) throw new WebAuthnPrfUnavailableError('WebAuthn PRF output must be exactly 32 bytes.')
  return output
}

export async function assertWebAuthnPrf(
  credentialId: Uint8Array,
  prfEvalInput: Uint8Array,
  rpId: string,
): Promise<WebAuthnPrfAssertionMaterial> {
  if (credentialId.byteLength === 0) throw new Error('WebAuthn credential ID must not be empty.')
  if (prfEvalInput.byteLength !== 32) throw new Error('WebAuthn PRF evaluation input must be 32 bytes.')
  const credentials = requireCredentialApi()
  const checkedRpId = effectiveRpId(rpId)
  const encodedCredentialId = base64Url(credentialId)
  const publicKey = {
    challenge: arrayBuffer(randomBytes(32)),
    rpId: checkedRpId,
    allowCredentials: [
      {
        type: 'public-key',
        id: arrayBuffer(credentialId),
      },
    ],
    userVerification: 'required',
    timeout: 60_000,
    extensions: {
      prf: {
        evalByCredential: {
          [encodedCredentialId]: {
            first: arrayBuffer(prfEvalInput),
          },
        },
      },
    },
  } as unknown as PublicKeyCredentialRequestOptions
  const assertion = asPublicKeyCredential(await credentials.get({ publicKey }), 'assertion')
  const assertedCredentialId = copiedBytes(assertion.rawId)
  if (!sameBytes(assertedCredentialId, credentialId)) {
    throw new Error('WebAuthn assertion returned a different credential ID.')
  }
  return {
    credentialId: assertedCredentialId,
    prfOutput: verifiedPrfOutput(assertion),
  }
}

export async function enrollWebAuthnPrf(rpId?: string): Promise<PrfWrapEnrollmentMaterial> {
  const credentials = requireCredentialApi()
  const checkedRpId = effectiveRpId(rpId)
  const prfEvalInput = randomBytes(32)
  const publicKey = {
    challenge: arrayBuffer(randomBytes(32)),
    rp: {
      id: checkedRpId,
      name: 'EDS Diary',
    },
    user: {
      id: arrayBuffer(randomBytes(32)),
      name: `eds-diary-local-${base64Url(randomBytes(9))}`,
      displayName: 'EDS Diary local encryption key',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: {
      userVerification: 'required',
      residentKey: 'discouraged',
    },
    attestation: 'none',
    timeout: 60_000,
    extensions: {
      prf: {
        eval: {
          first: arrayBuffer(prfEvalInput),
        },
      },
    },
  } as unknown as PublicKeyCredentialCreationOptions
  const created = asPublicKeyCredential(await credentials.create({ publicKey }), 'registration')
  if (extensionResults(created).prf?.enabled !== true) {
    throw new WebAuthnPrfUnavailableError('The created credential does not support WebAuthn PRF.')
  }
  const credentialId = copiedBytes(created.rawId)
  if (credentialId.byteLength === 0) throw new Error('WebAuthn registration returned an empty credential ID.')
  const assertion = await assertWebAuthnPrf(credentialId, prfEvalInput, checkedRpId)
  return {
    credentialId: assertion.credentialId,
    prfEvalInput: new Uint8Array(prfEvalInput),
    prfOutput: assertion.prfOutput,
    rpId: checkedRpId,
  }
}
