import { expect, test } from '@playwright/test'

const b=(length:number)=>Buffer.alloc(length).toString('base64url')

test.describe('security product flows',()=>{
  test('recovery mode accepts legacy pretty-printed JSON syntax before cryptographic verification',async({page})=>{
    await page.goto('/?mode=recovery')
    await expect(page.getByRole('heading',{name:'Tagebuch wiederherstellen'})).toBeVisible()
    const artifact={format:'sync-recovery-v5',version:5,recovery_artifact_id:b(16),kdf_profile_id:'recovery-hkdf-v5-1',salt:b(32),wrap_iv:b(12),wrapped_payload:b(16)}
    await page.getByLabel('Recovery-Schlüssel').fill(b(32))
    await page.getByLabel('Recovery-Artefakt').setInputFiles({name:'legacy-pretty-recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(artifact,null,2))})
    await page.getByLabel('Backup-Datei').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from('{}')})
    await page.getByRole('button',{name:'Strikt prüfen und wiederherstellen'}).click()
    const status=page.getByRole('status')
    await expect(status).not.toHaveText('Die Wiederherstellung ist nur in einem frischen Browserprofil möglich.')
    await expect(status).not.toContainText('JSON is not canonical')
  })

  test('configuration exposes recovery and explicit conflict-resolution entry points',async({page})=>{
    await page.goto('/konfiguration')
    await expect(page.getByRole('heading',{level:1,name:'Konfiguration'})).toBeVisible()
    await expect(page.getByText('Fachliche Konflikte')).toBeVisible()
    await expect(page.getByRole('link',{name:/Wiederherstellung/})).toHaveAttribute('href','?mode=recovery')
  })

  test('auth-origin entry fails closed when deployment configuration is absent',async({page})=>{
    await page.goto(`/google-auth/?action_id=${b(32)}&return_origin=${encodeURIComponent('https://diary.example')}`)
    await expect(page.getByRole('heading',{name:'Google-Anmeldung'})).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Ungültige oder nicht erlaubte Anmeldeanforderung')
    await expect(page.getByRole('button',{name:'Mit Google anmelden'})).toBeHidden()
  })
})
