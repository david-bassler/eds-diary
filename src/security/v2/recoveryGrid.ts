import { base64Url, utf8 } from '../crypto/bytes'
import { canonicalBytes, parseCanonicalJson } from '../crypto/canonical'
import { sha256 } from '../crypto/core'
import { validateRecoveryArtifactV6, type RecoveryArtifactV6 } from './recovery'

export const RECOVERY_GRID_ROWS_V6=45
export const RECOVERY_GRID_CHUNK_CHARS_V6=32_000
export const MAX_RECOVERY_GRID_CHUNKS_V6=44

export interface RecoveryGridHeaderV6 {
  grid_format:'sync-recovery-grid-v6'
  grid_version:6
  artifact_header:{
    format:'sync-recovery-v6'
    version:6
    recovery_artifact_id:string
    kdf_profile_id:'recovery-hkdf-v6-1'
    salt:string
    wrap_iv:string
  }
  wrapped_payload_chars:number
  wrapped_payload_sha256:string
  chunk_chars:32000
  chunk_count:number
}

const HEADER_KEYS=['grid_format','grid_version','artifact_header','wrapped_payload_chars','wrapped_payload_sha256','chunk_chars','chunk_count'] as const
const ARTIFACT_HEADER_KEYS=['format','version','recovery_artifact_id','kdf_profile_id','salt','wrap_iv'] as const
function exact(value:object,keys:readonly string[],label:string):void{
  if(Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))throw new Error(`${label} schema mismatch.`)
}
async function payloadHash(value:string):Promise<string>{return base64Url(await sha256(utf8(value)))}

export async function recoveryArtifactToGridV6(artifact:RecoveryArtifactV6):Promise<readonly string[]>{
  validateRecoveryArtifactV6(artifact)
  const count=Math.ceil(artifact.wrapped_payload.length/RECOVERY_GRID_CHUNK_CHARS_V6)
  if(count<1||count>MAX_RECOVERY_GRID_CHUNKS_V6)throw new Error('RecoveryArtifactV6 grid chunk bound exceeded.')
  const header:RecoveryGridHeaderV6={
    grid_format:'sync-recovery-grid-v6',
    grid_version:6,
    artifact_header:{
      format:artifact.format,
      version:artifact.version,
      recovery_artifact_id:artifact.recovery_artifact_id,
      kdf_profile_id:artifact.kdf_profile_id,
      salt:artifact.salt,
      wrap_iv:artifact.wrap_iv,
    },
    wrapped_payload_chars:artifact.wrapped_payload.length,
    wrapped_payload_sha256:await payloadHash(artifact.wrapped_payload),
    chunk_chars:RECOVERY_GRID_CHUNK_CHARS_V6,
    chunk_count:count,
  }
  const cells=Array<string>(RECOVERY_GRID_ROWS_V6).fill('')
  cells[0]=new TextDecoder().decode(canonicalBytes(header as never))
  for(let index=0;index<count;index+=1)cells[index+1]=artifact.wrapped_payload.slice(index*RECOVERY_GRID_CHUNK_CHARS_V6,(index+1)*RECOVERY_GRID_CHUNK_CHARS_V6)
  return cells
}

export async function recoveryArtifactFromGridV6(cells:readonly string[]):Promise<RecoveryArtifactV6>{
  if(cells.length!==RECOVERY_GRID_ROWS_V6||cells.some(cell=>typeof cell!=='string'))throw new Error('Recovery grid must contain exactly 45 string cells.')
  if(!cells[0])throw new Error('Recovery grid header is missing.')
  const header=parseCanonicalJson(utf8(cells[0])) as unknown as RecoveryGridHeaderV6
  if(!header||typeof header!=='object')throw new Error('Recovery grid header schema mismatch.')
  exact(header,HEADER_KEYS,'Recovery grid header')
  if(header.grid_format!=='sync-recovery-grid-v6'||header.grid_version!==6||header.chunk_chars!==RECOVERY_GRID_CHUNK_CHARS_V6)throw new Error('Recovery grid profile mismatch.')
  if(!header.artifact_header||typeof header.artifact_header!=='object')throw new Error('Recovery grid artifact header schema mismatch.')
  exact(header.artifact_header,ARTIFACT_HEADER_KEYS,'Recovery grid artifact header')
  if(header.artifact_header.format!=='sync-recovery-v6'||header.artifact_header.version!==6||header.artifact_header.kdf_profile_id!=='recovery-hkdf-v6-1')throw new Error('Recovery grid artifact profile mismatch.')
  if(!Number.isSafeInteger(header.wrapped_payload_chars)||header.wrapped_payload_chars<1
    ||!Number.isSafeInteger(header.chunk_count)||header.chunk_count<1||header.chunk_count>MAX_RECOVERY_GRID_CHUNKS_V6
    ||header.chunk_count!==Math.ceil(header.wrapped_payload_chars/RECOVERY_GRID_CHUNK_CHARS_V6))throw new Error('Recovery grid chunk metadata mismatch.')
  const chunks=cells.slice(1,1+header.chunk_count)
  for(let index=0;index<chunks.length;index+=1){
    const expected=index===chunks.length-1
      ? header.wrapped_payload_chars-RECOVERY_GRID_CHUNK_CHARS_V6*(chunks.length-1)
      : RECOVERY_GRID_CHUNK_CHARS_V6
    if(chunks[index]!.length!==expected||expected<1||expected>RECOVERY_GRID_CHUNK_CHARS_V6)throw new Error('Recovery grid chunk length mismatch.')
  }
  if(cells.slice(1+header.chunk_count).some(cell=>cell!==''))throw new Error('Recovery grid contains trailing data.')
  const wrapped_payload=chunks.join('')
  if(wrapped_payload.length!==header.wrapped_payload_chars||await payloadHash(wrapped_payload)!==header.wrapped_payload_sha256)throw new Error('Recovery grid payload hash mismatch.')
  const artifact:RecoveryArtifactV6={...header.artifact_header,wrapped_payload}
  validateRecoveryArtifactV6(artifact)
  return artifact
}
