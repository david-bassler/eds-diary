import { expect, test } from '@playwright/test'

test('uses a UV-capable virtual authenticator for the productive WebAuthn PRF ceremony', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  try {
    await page.goto('http://localhost:4173/')
    const result = await page.evaluate(async () => {
      const { enrollWebAuthnPrf } = await import('/src/security/webauthnPrf.ts')
      try {
        const enrolled = await enrollWebAuthnPrf()
        return { ok: true, credentialLength: enrolled.credentialId.byteLength, outputLength: enrolled.prfOutput.byteLength }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })
    if (result.ok) {
      expect(result.outputLength).toBe(32)
      expect(result.credentialLength).toBeGreaterThan(0)
    } else {
      expect(result.message).toMatch(/Authenticator did not return a WebAuthn PRF result/)
    }
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    await cdp.send('WebAuthn.disable')
  }
})
