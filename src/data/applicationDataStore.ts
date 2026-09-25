import {
  LOCAL_STORES,
  UnresolvedRecordConflictError,
  activeProtocolSelectionV2,
  getAllRecords as getAllRecordsV1,
  getRecord as getRecordV1,
  getRecordConflict as getRecordConflictV1,
  listRecordConflicts as listRecordConflictsV1,
  mergeRecord as mergeRecordV1,
  openSuccessorRootWrapV6WithActiveMode,
  putRecord as putRecordV1,
  putRecords as putRecordsV1,
  type LocalStoreName,
  type RecordConflict,
  type StoreRecordConflict,
} from './localDatabase'
import { legacyRecordId, singletonRecordId } from '../security/revisions'
import { fixedBase64Url } from '../security/crypto/bytes'
import { deriveEpochSaltV2 } from '../security/v2/crypto'
import { openRevisionEnvelopeV2 } from '../security/v2/envelopes'
import { IndexedDbV2LocalSecurityStore } from '../security/v2/localPersistence'
import { V2_RECORD_SCHEMA_BY_TYPE, type RevisionV2 } from '../security/v2/types'
import type { DomainRecordTypeV2, PrepareDomainRevisionV2Input } from '../security/v2/domainWrite'
import { requireActiveV2SyncService } from './v2ApplicationRuntime'

export {LOCAL_STORES,UnresolvedRecordConflictError}
export type {LocalStoreName,RecordConflict,StoreRecordConflict}

interface StoreProfileV2 {recordType:DomainRecordTypeV2;recordSchema:string}
const STORE_PROFILE_V2:Record<Exclude<LocalStoreName,'settings'>,StoreProfileV2>={
  painEntries:{recordType:'pain_entry',recordSchema:'pain-entry/v1'},
  activityEntries:{recordType:'activity_entry',recordSchema:'activity-entry/v1'},
  medicationEntries:{recordType:'medication_entry',recordSchema:'medication-entry/v1'},
  medicationPrescriptions:{recordType:'medication_prescription',recordSchema:'medication-prescription/v1'},
}
function profileFor(store:LocalStoreName,id?:string):StoreProfileV2{
  if(store!=='settings')return STORE_PROFILE_V2[store]
  return id==='activity-types'||id==='activity-type-settings'
    ?{recordType:'activity_type_settings',recordSchema:'activity-type-settings/v1'}
    :{recordType:'pain_type_settings',recordSchema:'pain-type-settings/v1'}
}
function allowedTypes(store:LocalStoreName):ReadonlySet<DomainRecordTypeV2>{
  return store==='settings'
    ?new Set<DomainRecordTypeV2>(['pain_type_settings','activity_type_settings'])
    :new Set<DomainRecordTypeV2>([STORE_PROFILE_V2[store].recordType])
}
function logicalAppId(revision:RevisionV2,store:LocalStoreName):string{
  if(store==='settings'){
    if(revision.record_type==='activity_type_settings')return'activity-types'
    if(revision.record_type==='pain_type_settings')return'custom-pain-types'
  }
  return revision.record_id
}
function recordData(value:Record<string,unknown>):unknown{
  if(value.status==='deleted')return null
  const copy={...value}
  delete copy.id
  delete copy.status
  return copy
}

interface AcceptedGraphLocalV2 {
  diaryId:string
  epochId:string
  revisions:Map<string,RevisionV2>
  headsByRecord:Map<string,Set<string>>
}

async function acceptedGraphV2():Promise<AcceptedGraphLocalV2>{
  const selection=await activeProtocolSelectionV2()
  if(!selection)throw new Error('No active v2 protocol selection exists.')
  const store=new IndexedDbV2LocalSecurityStore()
  const preparedWrap=await store.loadRootWrapV6(selection.epoch_id)
  const rootKey=await openSuccessorRootWrapV6WithActiveMode(preparedWrap)
  const epochSalt=await deriveEpochSaltV2(fixedBase64Url(selection.diary_id,16),fixedBase64Url(selection.epoch_id,16))
  const state=await store.loadState(rootKey,epochSalt,selection.epoch_id)
  if(state.diary_id!==selection.diary_id||state.epoch_id!==selection.epoch_id
    ||state.manifest_fingerprint!==selection.manifest_fingerprint||state.epoch_status!=='active')throw new Error('Active v2 selection does not match authenticated StateV6.')
  const {envelopes}=await store.loadVerifiedReadModel(rootKey,epochSalt,selection.epoch_id)
  const revisions=new Map<string,RevisionV2>(),children=new Set<string>()
  for(const envelope of envelopes){
    const revision=await openRevisionEnvelopeV2(rootKey,epochSalt,{diaryId:selection.diary_id,epochId:selection.epoch_id},envelope)
    if(revisions.has(revision.revision_id))throw new Error('Verified v2 read model contains a duplicate revision ID.')
    for(const parentId of revision.parent_revision_ids){
      const parent=revisions.get(parentId)
      if(!parent)throw new Error('Verified v2 read model parent does not physically precede its child.')
      if(parent.record_id!==revision.record_id||parent.record_type!==revision.record_type||parent.record_schema!==revision.record_schema)throw new Error('Verified v2 read model contains a cross-record parent.')
      children.add(parentId)
    }
    revisions.set(revision.revision_id,revision)
  }
  const headsByRecord=new Map<string,Set<string>>()
  for(const revision of revisions.values()){
    if(revision.record_status==='control'||children.has(revision.revision_id))continue
    const heads=headsByRecord.get(revision.record_id)??new Set<string>()
    heads.add(revision.revision_id)
    headsByRecord.set(revision.record_id,heads)
  }
  return{diaryId:selection.diary_id,epochId:selection.epoch_id,revisions,headsByRecord}
}

async function resolveRecordId(graph:AcceptedGraphLocalV2,store:LocalStoreName,id:string):Promise<string>{
  const profile=profileFor(store,id)
  if(store==='settings')return singletonRecordId(graph.diaryId,profile.recordType as 'pain_type_settings'|'activity_type_settings')
  const canonical=graph.headsByRecord.get(id)
  if(canonical){
    const head=graph.revisions.get([...canonical][0]!)
    if(head&&head.record_type===profile.recordType&&head.record_schema===profile.recordSchema)return id
  }
  return legacyRecordId(graph.diaryId,profile.recordType,id)
}

function valueFromHead<T>(revision:RevisionV2,store:LocalStoreName):T{
  const id=logicalAppId(revision,store)
  if(revision.record_status==='deleted')return{id,status:'deleted'} as T
  if(!revision.record_data||typeof revision.record_data!=='object'||Array.isArray(revision.record_data))throw new Error('Accepted v2 domain head has invalid materialization data.')
  return{id,...revision.record_data as Record<string,unknown>} as T
}

async function getAllRecordsV2<T>(store:LocalStoreName):Promise<T[]>{
  const graph=await acceptedGraphV2(),allowed=allowedTypes(store),output:T[]=[]
  for(const [recordId,headIds] of graph.headsByRecord){
    const ids=[...headIds].sort()
    const first=graph.revisions.get(ids[0]!)
    if(!first||!allowed.has(first.record_type as DomainRecordTypeV2))continue
    if(ids.length>1)throw new UnresolvedRecordConflictError(recordId,ids)
    output.push(valueFromHead<T>(first,store))
  }
  return output
}

async function putRecordV2(valueStore:LocalStoreName,value:{id:string}):Promise<void>{
  const graph=await acceptedGraphV2(),input=value as unknown as Record<string,unknown>,id=String(input.id??'')
  if(!id)throw new Error('Record id is required.')
  const profile=profileFor(valueStore,id),recordId=await resolveRecordId(graph,valueStore,id)
  if(V2_RECORD_SCHEMA_BY_TYPE[profile.recordType]!==profile.recordSchema)throw new Error('Application v2 record profile is inconsistent with the frozen schema map.')
  const write:PrepareDomainRevisionV2Input={
    recordType:profile.recordType,
    recordId,
    status:input.status==='deleted'?'deleted':'active',
    data:recordData(input),
  }
  await (await requireActiveV2SyncService()).prepareAndSynchronizeDomainWrite(write)
}

export async function getAllRecords<T>(store:LocalStoreName):Promise<T[]>{
  return await activeProtocolSelectionV2()?getAllRecordsV2<T>(store):getAllRecordsV1<T>(store)
}
export async function getRecord<T>(store:LocalStoreName,id:string):Promise<T|undefined>{
  if(!await activeProtocolSelectionV2())return getRecordV1<T>(store,id)
  return(await getAllRecords<T&{id:string}>(store)).find(value=>value.id===id)
}
export async function putRecord<T extends{id:string}>(store:LocalStoreName,value:T):Promise<void>{
  if(!await activeProtocolSelectionV2())return putRecordV1(store,value)
  return putRecordV2(store,value)
}
export async function putRecords<T extends{id:string}>(store:LocalStoreName,values:readonly T[]):Promise<void>{
  if(!values.length)return
  if(!await activeProtocolSelectionV2())return putRecordsV1(store,values)
  // Keep ordinary UI mutations linear. Each item is reconciled durably before
  // the next derives parents from a new canonical_full.
  for(const value of values)await putRecordV2(store,value)
}

export async function listRecordConflicts():Promise<StoreRecordConflict[]>{
  if(!await activeProtocolSelectionV2())return listRecordConflictsV1()
  const graph=await acceptedGraphV2(),result:StoreRecordConflict[]=[]
  for(const [recordId,headIds] of graph.headsByRecord){
    if(headIds.size<2)continue
    const heads=[...headIds].sort().map(id=>graph.revisions.get(id)!)
    const first=heads[0]
    if(!first||first.record_status==='control')continue
    const store=(Object.keys(STORE_PROFILE_V2) as Exclude<LocalStoreName,'settings'>[]).find(name=>STORE_PROFILE_V2[name].recordType===first.record_type)
      ??(['pain_type_settings','activity_type_settings'].includes(first.record_type)?'settings':null)
    if(!store)continue
    result.push({
      store,
      id:logicalAppId(first,store),
      recordId,
      heads:heads.map(revision=>({revisionId:revision.revision_id,status:revision.record_status as 'active'|'deleted',data:revision.record_data})),
    })
  }
  return result
}
export async function getRecordConflict<T=unknown>(store:LocalStoreName,id:string):Promise<RecordConflict<T>|null>{
  if(!await activeProtocolSelectionV2())return getRecordConflictV1<T>(store,id)
  const graph=await acceptedGraphV2(),recordId=await resolveRecordId(graph,store,id),headIds=[...(graph.headsByRecord.get(recordId)??[])].sort()
  if(headIds.length<2)return null
  return{recordId,heads:headIds.map(revisionId=>{
    const revision=graph.revisions.get(revisionId)
    if(!revision||revision.record_status==='control')throw new Error('V2 conflict head is missing or invalid.')
    return{revisionId,status:revision.record_status as 'active'|'deleted',data:revision.record_data as T|null}
  })}
}
export async function mergeRecord<T extends{id:string}>(store:LocalStoreName,value:T):Promise<void>{
  if(!await activeProtocolSelectionV2())return mergeRecordV1(store,value)
  const service=await requireActiveV2SyncService()
  for(;;){
    const graph=await acceptedGraphV2(),recordId=await resolveRecordId(graph,store,String(value.id)),headIds=[...(graph.headsByRecord.get(recordId)??[])].sort()
    if(headIds.length<2)throw new Error('Record does not have multiple v2 heads to merge.')
    const profile=profileFor(store,String(value.id)),parents=headIds.length>8?headIds.slice(0,8):headIds
    await service.prepareAndSynchronizeDomainWrite({
      recordType:profile.recordType,
      recordId,
      parentRevisionIds:parents,
      status:'active',
      data:recordData(value as unknown as Record<string,unknown>),
    })
    if(headIds.length<=8)return
  }
}
