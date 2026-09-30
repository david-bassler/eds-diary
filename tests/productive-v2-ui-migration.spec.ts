import { expect, test } from '@playwright/test'
import { MultiDeviceHarness } from './support/multiDeviceHarness'

test('migrates productive v1 through the Settings UI and remains usable across reload and Join',async({browser})=>{
  test.setTimeout(420_000)
  const harness=new MultiDeviceHarness(browser)
  const source=await harness.device('ui-migration-source')
  const joining=await harness.device('ui-migration-joiner')
  try{
    await Promise.all([source.page.goto('/'),joining.page.goto('/')])
    await harness.authenticate(source,'ui_migration_source_initial_auth_0001')
    const v1=await harness.establishProductiveRemoteV1(source)
    const sourceRootKey=await harness.activeV1RootKeySentinel(source)
    expect(await harness.readProductivePain(source)).toBe(1)
    await Promise.all(source.context.pages().filter(page=>page!==source.page).map(page=>page.close()))

    await source.page.getByRole('navigation',{name:'Hauptnavigation'})
      .getByRole('link',{name:'Konfiguration'}).click()
    const settings=source.page.getByRole('region',{name:'Mehrgeräte-Schreibzugriff (v2)'})
    await expect(settings).toBeVisible()
    await settings.getByLabel('Recovery-Schlüssel').fill(v1.recoveryKey)

    const sourcePopupPromise=source.page.waitForEvent('popup')
    await settings.getByRole('button',{name:'Tagebuch auf v2 umstellen'}).click()
    const sourcePopup=await sourcePopupPromise
    const sourceAction=new URL(sourcePopup.url()).searchParams.get('action_id')
    // Both productive providers intentionally use the same named Auth window.
    // Successor authentication therefore navigates the existing Popup instead
    // of emitting a second Page.popup event.
    const successorNavigation=sourcePopup.waitForURL(url=>new URL(url).searchParams.get('action_id')!==sourceAction)
    await sourcePopup.getByRole('button',{name:'Mit Google anmelden'}).click()
    await successorNavigation
    await sourcePopup.getByRole('button',{name:'Mit Google anmelden'}).click()
    await expect(settings.getByText('Tagebuch wurde vollständig auf Transferable Single Writer v2 umgestellt.'))
      .toBeVisible({timeout:240_000})

    const migrated=await source.page.evaluate(async()=>{
      const [localDatabase,painRepository,persistence]=await Promise.all([
        import('/src/data/localDatabase.ts'),import('/src/features/pain/painRepository.ts'),
        import('/src/security/v2/localPersistence.ts'),
      ])
      const selection=await localDatabase.activeProtocolSelectionV2()
      const db=await localDatabase.__localDatabaseTesting.openDatabase()
      const sourceState=(await localDatabase.__localDatabaseTesting.loadEpoch(db)).state
      const v2db=await persistence.__v2LocalPersistenceTesting.openDatabase()
      const artifactTx=v2db.transaction([
        persistence.__v2LocalPersistenceTesting.STORES.recoveryArtifacts,
        persistence.__v2LocalPersistenceTesting.STORES.operationArtifacts,
      ],'readonly')
      const recoveryRequest=artifactTx.objectStore(persistence.__v2LocalPersistenceTesting.STORES.recoveryArtifacts).getAll()
      const operationRequest=artifactTx.objectStore(persistence.__v2LocalPersistenceTesting.STORES.operationArtifacts).getAll()
      const read=<T,>(request:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)
      })
      const [recoveryArtifacts,operationArtifacts]=await Promise.all([read(recoveryRequest),read(operationRequest)])
      return{
        epochId:selection?.epoch_id??null,
        sourceStatus:sourceState.epoch_status,
        recoveryArtifactCount:recoveryArtifacts.length,
        stagedBackup:operationArtifacts.some(entry=>String((entry as {id?:unknown}).id).endsWith(':staged-backup')),
        activatedBackup:operationArtifacts.some(entry=>String((entry as {id?:unknown}).id).endsWith(':activated-backup')),
        painCount:(await painRepository.listPainEntries()).length,
      }
    })
    expect(migrated.epochId).not.toBeNull()
    expect(migrated.sourceStatus).toBe('retired')
    expect(migrated.recoveryArtifactCount).toBeGreaterThan(0)
    expect(migrated.stagedBackup).toBe(true)
    expect(migrated.activatedBackup).toBe(true)
    expect(migrated.painCount).toBe(1)
    // The React component owns its session in component state. Reconstruct the
    // ordinary authenticated application runtime for independent canonical
    // inspection; this happens only after the UI ceremony has completed.
    await harness.restoreProductiveRuntimeAfterCeremony(source,v1.passphrase)
    expect(await harness.verifyProductiveV2Remote(source)).toMatchObject({kind:'canonical_full',writerStatus:'writer_active'})
    expect(await harness.scanBrowserPersistence(source,['productive-crash-source',sourceRootKey])).toEqual([])

    await harness.reloadAuthenticateUnlockAndRestoreProductiveRuntime(
      source,v1.passphrase,'ui_migration_source_reload_auth_00001',
    )
    expect(await harness.readProductivePain(source)).toBe(1)
    expect(await harness.writeProductivePain(source,'ui-migration-after-reload')).toMatchObject({writerStatus:'writer_active'})

    await harness.authenticate(joining,'ui_migration_joiner_auth_000000001')
    const joined=await harness.joinAndUnlockProductiveV2(joining,{
      recoveryKey:v1.recoveryKey,passphrase:v1.passphrase,
    })
    expect(joined.writerStatus).toBe('read_only')
    expect(joined.notes).toContain('productive-crash-source')
    expect(joined.notes).toContain('ui-migration-after-reload')
    expect(await harness.verifyProductiveV2Remote(joining)).toMatchObject({kind:'canonical_full',writerStatus:'read_only'})
  }finally{await harness.close()}
})
