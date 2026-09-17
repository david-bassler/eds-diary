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

  test('pre-color active activity prepares successfully and exposes a guided Google setup',async({page})=>{
    await page.goto('/google-auth/')
    await page.evaluate(async()=>{
      await new Promise<void>((resolve,reject)=>{
        const request=indexedDB.open('eds-diary',5)
        request.onupgradeneeded=()=>{
          for(const name of ['painEntries','medicationEntries','medicationPrescriptions','activityEntries','settings']){
            if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'})
          }
          request.transaction!.objectStore('activityEntries').put({
            id:'legacy-walk',
            date:'2026-09-07',
            startTime:'08:00',
            endTime:'09:00',
            activityName:'Spaziergang',
            note:'',
            status:'active',
            createdAt:'2026-09-07T06:00:00.000Z',
            updatedAt:'2026-09-07T06:00:00.000Z',
          })
        }
        request.onsuccess=()=>{request.result.close();resolve()}
        request.onerror=()=>reject(request.error)
      })
    })

    await page.goto('/konfiguration')
    const storage=page.locator('section.google-sync-settings')
    await expect(storage.getByRole('heading',{name:'Google-Synchronisierung'})).toBeVisible()
    await expect(storage.getByRole('heading',{name:'Google-Konto verbinden'})).toBeVisible()
    await expect(storage.getByText('Google-Synchronisierung konnte noch nicht vorbereitet werden.')).toBeHidden()
    await expect(storage.getByRole('button',{name:'Recovery-Schlüssel erstellen'})).toBeVisible()

    await storage.getByRole('button',{name:'Recovery-Schlüssel erstellen'}).click()
    await expect(storage.getByLabel('Recovery-Schlüssel')).not.toHaveValue('')
    await expect(storage.getByText('Zuerst Schritt 1 abschließen.')).toBeVisible()
    await storage.getByLabel('Ich habe den Schlüssel außerhalb dieser App gespeichert.').check()
    await expect(storage.getByRole('button',{name:'Mit Google verbinden'})).toBeVisible()
  })

  test('backup-restored profile exposes recovery re-export before Google re-enablement',async({page})=>{
    await page.goto('/google-auth/')
    await page.evaluate(async()=>{
      const modulePath='/src/data/recoveryProfile.ts'
      const recoveryModule=await import(modulePath) as {persistRecoveredProfile:(candidate:unknown,bootstrap:unknown,schemas:Readonly<Record<string,unknown>>,options:unknown)=>Promise<unknown>}
      const b64=(length:number,fill:number)=>{
        const bytes=new Uint8Array(length).fill(fill)
        return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'')
      }
      const diary=b64(16,1),epoch=b64(16,2),keyId=b64(16,3),fingerprint=b64(32,4),artifactId=b64(16,6)
      const candidate={rootKey:crypto.getRandomValues(new Uint8Array(32)),recoveryCommitment:b64(32,5),payload:{recovery_artifact_id:artifactId,diary_id:diary,epoch_id:epoch,key_id:keyId,RK_epoch:b64(32,7),manifest_fingerprint:fingerprint,remote_anchor:null,google_account_binding:b64(32,8),recovery_generation:1,created_at:'2026-09-17T12:00:00.000Z'}}
      const bootstrap={source:'verified-backup',verified:{snapshot:{manifest:[],rows:[]},manifestFingerprint:fingerprint,retired:false,verifiedEnvelopeIds:new Set<string>()},remoteBinding:null}
      const artifact={format:'sync-recovery-v5',version:5,recovery_artifact_id:artifactId,kdf_profile_id:'recovery-hkdf-v5-1',salt:b64(32,9),wrap_iv:b64(12,10),wrapped_payload:b64(16,11)}
      await recoveryModule.persistRecoveredProfile(candidate,bootstrap,{}, {recoveryArtifact:artifact})
    })
    await page.goto('/konfiguration')
    const storage=page.locator('section.google-sync-settings')
    await storage.getByText('Backup & Wiederherstellung').click()
    await expect(storage.getByRole('button',{name:'Recovery-Datei erneut exportieren'})).toBeVisible()
    await expect(storage.getByRole('button',{name:'Recovery-Schlüssel erstellen'})).toBeVisible()
    const downloadPromise=page.waitForEvent('download')
    await storage.getByRole('button',{name:'Recovery-Datei erneut exportieren'}).click()
    const download=await downloadPromise
    expect(download.suggestedFilename()).toBe('eds-diary-recovery.json')
  })

  test('configuration exposes recovery and explicit conflict-resolution entry points',async({page})=>{
    await page.goto('/konfiguration')
    await expect(page.getByRole('heading',{level:1,name:'Konfiguration'})).toBeVisible()
    await expect(page.getByText('Fachliche Konflikte')).toBeVisible()
    const storage=page.locator('section.google-sync-settings')
    await storage.getByText('Backup & Wiederherstellung').click()
    const recoveryLink=storage.locator('a[href="?mode=recovery"]')
    await expect(recoveryLink).toBeVisible()
    await recoveryLink.click()
    await expect(page.getByRole('heading',{name:'Tagebuch wiederherstellen'})).toBeVisible()
  })

  test('auth-origin entry fails closed when deployment configuration is absent',async({page})=>{
    await page.goto(`/google-auth/?action_id=${b(32)}&return_origin=${encodeURIComponent('https://diary.example')}`)
    await expect(page.getByRole('heading',{name:'Google-Anmeldung'})).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Ungültige oder nicht erlaubte Anmeldeanforderung')
    await expect(page.getByRole('button',{name:'Mit Google anmelden'})).toBeHidden()
  })
})
