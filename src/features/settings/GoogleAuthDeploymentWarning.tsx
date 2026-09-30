import { googleAuthDeploymentWarning } from '../../sync/google/googleAuthDeploymentPolicy'

export function GoogleAuthDeploymentWarning(){
  const authUrl=import.meta.env.VITE_GOOGLE_AUTH_ORIGIN as string|undefined
  const warning=googleAuthDeploymentWarning(authUrl)
  if(!warning)return null
  return <div className="google-sync-settings__problem" role="alert">
    <strong>Google-Testbereitstellung</strong>
    <p>{warning}</p>
  </div>
}
