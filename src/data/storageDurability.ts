export interface StorageDurabilityStatus {
  supported:boolean
  persisted:boolean
}

export async function storageDurabilityStatus():Promise<StorageDurabilityStatus>{
  const storage=globalThis.navigator?.storage
  if(!storage||typeof storage.persisted!=='function')return{supported:false,persisted:false}
  return{supported:true,persisted:await storage.persisted()}
}

export async function ensurePersistentStorage():Promise<StorageDurabilityStatus>{
  const storage=globalThis.navigator?.storage
  if(!storage||typeof storage.persisted!=='function'||typeof storage.persist!=='function')return{supported:false,persisted:false}
  if(await storage.persisted())return{supported:true,persisted:true}
  const persisted=await storage.persist()
  return{supported:true,persisted}
}
