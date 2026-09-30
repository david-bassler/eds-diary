import activityEntrySchema from '../schemas/activity-entry.v1.schema.json'
import activityTypeSettingsSchema from '../schemas/activity-type-settings.v1.schema.json'
import epochMigrationSchema from '../schemas/epoch-migration-sw.v2.schema.json'
import medicationEntrySchema from '../schemas/medication-entry.v1.schema.json'
import medicationPrescriptionSchema from '../schemas/medication-prescription.v1.schema.json'
import painEntrySchema from '../schemas/pain-entry.v1.schema.json'
import painTypeSettingsSchema from '../schemas/pain-type-settings.v1.schema.json'
import recoveryAuthorityTransitionSchema from '../schemas/recovery-authority-transition-sw.v2.schema.json'
import rotationAnnouncementSchema from '../schemas/rotation-announcement-sw.v2.schema.json'
import successorActivationConfirmationSchema from '../schemas/successor-activation-confirmation-sw.v2.schema.json'
import writerGrantSchema from '../schemas/writer-grant-sw.v2.schema.json'
import { base64Url } from '../crypto/bytes'
import { canonicalBytes } from '../crypto/canonical'
import { sha256 } from '../crypto/core'
import { SINGLE_WRITER_V2_SCHEMA_ALLOWLIST } from './types'

export const V2_SCHEMA_REGISTRY_HASH='45WLQG41o-vdMhcWnJR1yhF74km8H55N9wlPnGWdduI' as const

export const V2_SCHEMA_REGISTRY:Readonly<Record<string,unknown>>=Object.freeze({
  'activity-entry/v1':activityEntrySchema,
  'activity-type-settings/v1':activityTypeSettingsSchema,
  'epoch-migration-sw-v2':epochMigrationSchema,
  'medication-entry/v1':medicationEntrySchema,
  'medication-prescription/v1':medicationPrescriptionSchema,
  'pain-entry/v1':painEntrySchema,
  'pain-type-settings/v1':painTypeSettingsSchema,
  'recovery-authority-transition-sw-v2':recoveryAuthorityTransitionSchema,
  'rotation-announcement-sw-v2':rotationAnnouncementSchema,
  'successor-activation-confirmation-sw-v2':successorActivationConfirmationSchema,
  'writer-grant-sw-v2':writerGrantSchema,
})

export interface SchemaRegistryEntryV2 {record_schema:string;schema_sha256:string}

export async function schemaRegistryEntriesV2():Promise<SchemaRegistryEntryV2[]>{
  const names=Object.keys(V2_SCHEMA_REGISTRY).sort()
  if(names.join('\0')!==[...SINGLE_WRITER_V2_SCHEMA_ALLOWLIST].sort().join('\0'))throw new Error('v2 schema registry does not match the frozen allowlist.')
  const entries:SchemaRegistryEntryV2[]=[]
  for(const record_schema of names)entries.push({record_schema,schema_sha256:base64Url(await sha256(canonicalBytes(V2_SCHEMA_REGISTRY[record_schema] as never)))})
  return entries
}

export async function schemaRegistryHashV2():Promise<string>{
  const hash=base64Url(await sha256(canonicalBytes(await schemaRegistryEntriesV2() as never)))
  if(hash!==V2_SCHEMA_REGISTRY_HASH)throw new Error('v2 schema registry bytes do not match the frozen protocol hash.')
  return hash
}
