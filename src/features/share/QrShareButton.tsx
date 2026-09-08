import { useEffect, useId, useRef, useState } from 'react'
import './QrShareButton.css'

interface QrCodeOptions {
  text: string
  width: number
  height: number
  correctLevel: unknown
}

interface QrCodeConstructor {
  new (element: HTMLElement, options: QrCodeOptions): unknown
  CorrectLevel: {
    M: unknown
  }
}

function getQrCodeConstructor(): QrCodeConstructor | undefined {
  return (window as typeof window & { QRCode?: QrCodeConstructor }).QRCode
}

export function QrShareButton() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [generatorAvailable, setGeneratorAvailable] = useState(true)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const qrCodeRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (!open || !url) return

    const target = qrCodeRef.current
    if (!target) return

    target.replaceChildren()

    const QRCode = getQrCodeConstructor()
    if (!QRCode) {
      setGeneratorAvailable(false)
      return
    }

    setGeneratorAvailable(true)
    new QRCode(target, {
      text: url,
      width: 256,
      height: 256,
      correctLevel: QRCode.CorrectLevel.M,
    })
  }, [open, url])

  function openQrCode(): void {
    setUrl(window.location.href)
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        className="qr-share__button"
        aria-label="Aktuelle URL als QR-Code anzeigen"
        title="QR-Code"
        onClick={openQrCode}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h6v6H4V4Zm2 2v2h2V6H6Zm8-2h6v6h-6V4Zm2 2v2h2V6h-2ZM4 14h6v6H4v-6Zm2 2v2h2v-2H6Zm8-2h2v2h-2v-2Zm4 0h2v4h-2v-4Zm-4 4h4v2h-4v-2Z" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        className="qr-share__dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault()
          setOpen(false)
        }}
        onClose={() => {
          if (open) setOpen(false)
        }}
      >
        <div className="qr-share__card">
          <button
            type="button"
            className="qr-share__close"
            aria-label="Schließen"
            onClick={() => setOpen(false)}
          >
            ×
          </button>

          <div className="qr-share__body">
            <p className="qr-share__eyebrow">Aktuelle Seite</p>
            <h2 id={titleId}>QR-Code</h2>
            <div
              ref={qrCodeRef}
              className="qr-share__code"
              role="img"
              aria-label={url ? `QR-Code für ${url}` : 'QR-Code der aktuellen Seite'}
            />
            {!generatorAvailable ? (
              <p className="qr-share__message" role="status">
                Der QR-Code-Generator konnte nicht geladen werden. Die URL steht
                unten zum manuellen Öffnen bereit.
              </p>
            ) : null}
            <p className="qr-share__url">{url}</p>
          </div>
        </div>
      </dialog>
    </>
  )
}
