export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`
    const hadController = Boolean(navigator.serviceWorker.controller)
    let reloading = false

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
      reloading = true
      window.location.reload()
    })

    void navigator.serviceWorker.register(serviceWorkerUrl)
  })
}
