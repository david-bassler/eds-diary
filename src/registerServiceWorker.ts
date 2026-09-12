export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`

    // Do not reload the current page when a newly deployed worker takes control.
    // A forced controllerchange reload can interrupt the user's first interaction
    // after opening the app and briefly send the UI back to its initial section.
    // The new worker can control subsequent requests immediately; the current app
    // shell is replaced naturally on the next normal navigation or app start.
    void navigator.serviceWorker.register(serviceWorkerUrl)
  })
}
