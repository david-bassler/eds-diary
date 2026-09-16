import { describe, expect, it } from 'vitest'
import { base64Url } from '../security/crypto/bytes'
import { canonicalBytes } from '../security/crypto/canonical'
import { derivePassphraseMaterial, sha256 } from '../security/crypto/core'
import { createAnchor, prefixHash } from '../sync/core/prefix'
import { legacyRecordId, singletonRecordId } from '../security/revisions'

const diary = 'AAECAwQFBgcICQoLDA0ODw'
const epoch = 'EBESExQVFhcYGRobHB0eHw'

describe('remaining normative protocol vectors', () => {
  it('matches H0/H1/H2 including row length', async () => {
    expect(await prefixHash(diary, epoch, [])).toBe('QNdRgLk7idJSD31lWxyuHM3tVRj_gNyuIoTLswdK7mM')
    const rows = [
      ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCCCCCCCCCCC'],
      ['DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 'EEEEEEEEEEEEEEEE', 'FFFFFFFFFFFFFFFFFFFFFFFF'],
    ]
    expect(await prefixHash(diary, epoch, rows.slice(0, 1))).toBe('uSjwuqCX1uhRM43i9S4ueKrUOvahK1hKspQE0truQbM')
    expect(await prefixHash(diary, epoch, rows)).toBe('DAbJMCMsMiUvPSuMf7Xq4V6DPmPtYjUvZcGVIE6VOFE')
    expect(base64Url(await sha256(canonicalBytes(await createAnchor(diary, epoch, rows) as never)))).toBe('rj2L-NXE5_jfBdeR37qB5_9ctolJlEyL9UEJEyV8rSI')
  })

  it('matches the normative passphrase Argon2id vector', () => {
    expect(base64Url(derivePassphraseMaterial('correct horse battery staple 2026', Uint8Array.from({ length: 16 }, (_, i) => 160 + i)))).toBe('QPscWLpX6ynZAgQKRrhShgbDKix7Y318RV9S_j4UptA')
  }, 20_000)

  it('matches legacy and singleton identifiers', async () => {
    expect(await legacyRecordId(diary, 'pain_entry', 'pain-legacy-001')).toBe('6VfGNsfksH5Z3lPHFXoqhw')
    expect(await singletonRecordId(diary, 'pain_type_settings')).toBe('bi484VDkyiS35gsH75PJkg')
    expect(await singletonRecordId(diary, 'activity_type_settings')).toBe('zq46iIq3qX9xlm_MBuqAkQ')
  })
})
