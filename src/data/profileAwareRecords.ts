import { fixedBase64Url, fromBase64Url } from '../security/crypto/bytes'
import { legacyRecordId, singletonRecordId } from '../security/revisions'
import type { DomainRecordTypeV2 } from '../security/v2/domainWrite'
import type { RevisionV2 } from '../security/v2/types'
import type { CanonicalFullResultV2 } from '../security/v2/verifier'
import {
  LOCAL_STORES,
  UnresolvedRecordConflictError,
  activeProtocolSelectionV2,
  getAllRecords as getAllRecordsV1,
  getRecord as getRecordV1,
  listRecordConflicts as listRecordConflictsV1,
  mergeRecord as mergeRecordV1,
  putRecord as putRecordV1,
  putRecords as putRecordsV1,
  type LocalStoreName,
  type StoreRecordConflict,
} from './localDatabase'
import {
  TransferableSingleWriterV2SyncService,
  loadActiveV2CanonicalFromCache,
} from './transferableSingleWriterV2SyncService'

let v2Runtime:TransferableSingleWriterV2SyncService|null=null

export function installV2RecordRuntime(runtime:TransferableSingleWriterV2SyncService):void{v2Runtime=runtime}
export function clearV2RecordRuntime(runtime?:TransferableSingleWriterV2SyncService):void{
  if(runtime===undefined||runtime===v2Runtime)v2Runtime=null
}
export function hasV2RecordRuntime():boolean{return v2Runtime!==null}

interface StoreProfileV2 {recordType:DomainRecordTypeV2;logicalSingletonId?:string}
function profileFor(store:LocalStoreName,id?:string):StoreProfileV2{
  if(store===LOCAL_STORES.painEntries)return{recordType:'pain_entry'}
  if(store===LOCAL_STORES.activityEntries)return{recordType:'activity_entry'}
  if(store===LOCAL_STORES.medicationEntries)return{recordType:'medication_entry'}
  if(store===LOCAL_STORES.medicationPrescriptions)return{recordType:'medication_prescription'}
  if(store===LOCAL_STORES.settings){
    if(id==='activity-types'||id==='activity-type-settings')return{recordType:'activity_type_settings',logicalSingletonId:'activity-types'}
    return{recordType:'pain_type_settings',logicalSingletonId:'custom-pain-types'}
  }
  throw new Error('Unsupported app record store.')
}
function logicalId(revision:RevisionV2,profile:StoreProfileV2):string{
  return profile.logicalSingletonId??revision.record_id
}
function compareIds(left:string,right:string):number{
  const a=fromBase64Url(left),b=fromBase64Url(right),limit=Math.min(a.byteLength,b.byteLength)
  for(let i=0;i<limit;i++){const delta=a[i]!-b[i]!;if(delta!==0)return delta}
  return a.byteLength-b.byteLength
}
function headsFor(result:CanonicalFullResultV2,recordId:string):RevisionV2[]{
  if(!result)throw new Error('Canonical v2 result is unavailable.')
  const ids=result.accepted_revision_graph.heads_by_record.get(recordId)??new Set<string>()
  return [...ids].sort(compareIds).map(id=>{
    const revision=result.accepted_revision_graph.revisions.get(id)
    if(!revision)throw new Error('Canonical v2 graph references a missing head.')
    return revision
  })
}
async function canonicalRecordId(
  diaryId:string,
  profile:StoreProfileV2,
  logical:string,
  result:NonNullable<Awaited<ReturnType<typeof loadActiveV2CanonicalFromCache>>>['result'],
):Promise<string>{
  if(profile.logicalSingletonId)return singletonRecordId(diaryId,profile.recordType as 'pain_type_settings'|'activity_type_settings')
  let canonicalCandidate=false
  try{fixedBase64Url(logical,16,'record_id');canonicalCandidate=true}catch{/* ordinary app-local ID */}
  if(canonicalCandidate){
    const existing=[...result.accepted_revision_graph.revisions.values()].find(revision=>revision.record_id===logical)
    if(existing){
      if(existing.record_type!==profile.recordType)throw new Error('Record ID belongs to a different v2 domain type.')
      return logical
    }
  }
  return legacyRecordId(diaryId,profile.recordType,logical)
}
function recordData(value:Record<string,unknown>):unknown{
  if(value.status==='deleted')return null
  const data={...value};delete data.id;delete data.status;return data
}
async function v2Materialized<T>(store:LocalStoreName):Promise<T[]>{
  const loaded=await loadActiveV2CanonicalFromCache()
  if(!loaded)throw new Error('No active v2 epoch is selected.')
  const profiles=store===LOCAL_STORES.settings
    ?[profileFor(store,'custom-pain-types'),profileFor(store,'activity-types')]
    :[profileFor(store)]
  const allowed=new Set(profiles.map(profile=>profile.recordType))
  const output:T[]=[]
  for(const [recordId,ids] of loaded.result.accepted_revision_graph.heads_by_record){
    const firstId=[...ids][0],first=firstId?loaded.result.accepted_revision_graph.revisions.get(firstId):undefined
    if(!first||!allowed.has(first.record_type as DomainRecordTypeV2))continue
    const heads=[...ids].sort(compareIds)
    if(heads.length>1)throw new UnresolvedRecordConflictError(recordId,heads)
    const revision=loaded.result.accepted_revision_graph.revisions.get(heads[0]!)
    if(!revision)throw new Error('Canonical v2 graph head is missing.')
    const profile=profiles.find(candidate=>candidate.recordType===revision.record_type)
    if(!profile)continue
    if(revision.record_status==='deleted')output.push({id:logicalId(revision,profile),status:'deleted'} as T)
    else{
      const data=revision.record_data
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Canonical active v2 domain head has invalid record_data.')
      output.push({id:logicalId(revision,profile),...(structuredClone(data) as Record<string,unknown>)} as T)
    }
  }
  return output
}
async function requireRuntime():Promise<TransferableSingleWriterV2SyncService>{
  if(!v2Runtime)throw new Error('V2-Schreibzugriff benötigt eine authentifizierte Google-Verbindung.')
  return v2Runtime
}
async function putV2(store:LocalStoreName,value:{id:string}):Promise<void>{
  const runtime=await requireRuntime()
  await runtime.synchronize()
  const loaded=await loadActiveV2CanonicalFromCache()
  if(!loaded)throw new Error('No active v2 epoch is selected.')
  const profile=profileFor(store,value.id),recordId=await canonicalRecordId(loaded.context.diaryId,profile,value.id,loaded.result)
  const heads=headsFor(loaded.result,recordId)
  if(heads.some(head=>head.record_type!==profile.recordType))throw new Error('Canonical v2 record heads disagree on domain type.')
  if(heads.length>1)throw new UnresolvedRecordConflictError(recordId,heads.map(head=>head.revision_id).sort(compareIds))
  await runtime.prepareDomainWrite({
    recordType:profile.recordType,
    recordId,
    parentRevisionIds:heads.map(head=>head.revision_id),
    status:(value as {status?:unknown}).status==='deleted'?'deleted':'active',
    data:recordData(value as Record<string,unknown>),
  })
  await runtime.synchronize()
}

export async function getAllRecords<T>(store:LocalStoreName):Promise<T[]>{
  return await activeProtocolSelectionV2()?v2Materialized<T>(store):getAllRecordsV1<T>(store)
}
export async function getRecord<T>(store:LocalStoreName,id:string):Promise<T|undefined>{
  if(!await activeProtocolSelectionV2())return getRecordV1<T>(store,id)
  return (await v2Materialized<T&{id:string}>(store)).find(value=>value.id===id) as T|undefined
}
export async function putRecord<T extends{id:string}>(store:LocalStoreName,value:T):Promise<void>{
  if(!await activeProtocolSelectionV2())return putRecordV1(store,value)
  return putV2(store,value)
}
export async function putRecords<T extends{id:string}>(store:LocalStoreName,values:readonly T[]):Promise<void>{
  if(!values.length)return
  if(!await activeProtocolSelectionV2())return putRecordsV1(store,values)
  for(const value of values)await putV2(store,value)
}

export async function listRecordConflicts():Promise<StoreRecordConflict[]>{
  if(!await activeProtocolSelectionV2())return listRecordConflictsV1()
  const loaded=await loadActiveV2CanonicalFromCache()
  if(!loaded)throw new Error('No active v2 epoch is selected.')
  const stores:LocalStoreName[]=[
    LOCAL_STORES.painEntries,LOCAL_STORES.activityEntries,LOCAL_STORES.medicationEntries,
    LOCAL_STORES.medicationPrescriptions,LOCAL_STORES.settings,
  ]
  const profiles=stores.flatMap(store=>store===LOCAL_STORES.settings
    ?[[store,profileFor(store,'custom-pain-types')] as const,[store,profileFor(store,'activity-types')] as const]
    :[[store,profileFor(store)] as const])
  const output:StoreRecordConflict[]=[]
  for(const [recordId,ids] of loaded.result.accepted_revision_graph.heads_by_record){
    if(ids.size<2)continue
    const heads=[...ids].sort(compareIds).map(id=>{
      const revision=loaded.result.accepted_revision_graph.revisions.get(id)
      if(!revision)throw new Error('Canonical v2 conflict references a missing revision.')
      return revision
    })
    const matched=profiles.find(([,profile])=>profile.recordType===heads[0]!.record_type)
    if(!matched)continue
    const [store,profile]=matched
    if(heads.some(head=>head.record_type!==profile.recordType))throw new Error('Canonical v2 conflict mixes domain record types.')
    output.push({
      store,
      id:logicalId(heads[0]!,profile),
      recordId,
      heads:heads.map(head=>({revisionId:head.revision_id,status:head.record_status as 'active'|'deleted',data:structuredClone(head.record_data)})),
    })
  }
  return output
}
export async function mergeRecord<T extends{id:string}>(store:LocalStoreName,value:T):Promise<void>{
  if(!await activeProtocolSelectionV2())return mergeRecordV1(store,value)
  const runtime=await requireRuntime()
  for(let pass=0;pass<1024;pass+=1){
    await runtime.synchronize()
    const loaded=await loadActiveV2CanonicalFromCache()
    if(!loaded)throw new Error('No active v2 epoch is selected.')
    const profile=profileFor(store,value.id),recordId=await canonicalRecordId(loaded.context.diaryId,profile,value.id,loaded.result)
    const heads=headsFor(loaded.result,recordId)
    if(heads.length<2){
      if(pass===0)throw new Error('Record does not have multiple heads to merge.')
      return
    }
    const parents=heads.slice(0,Math.min(8,heads.length)).map(head=>head.revision_id)
    await runtime.prepareDomainWrite({
      recordType:profile.recordType,
      recordId,
      parentRevisionIds:parents,
      status:'active',
      data:recordData(value as Record<string,unknown>),
    })
    await runtime.synchronize()
  }
  throw new Error('V2 conflict merge did not converge within the safety bound.')
}
