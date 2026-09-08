import { useEffect, useId, useRef } from 'react'
import './CopyDayDialog.css'

export interface CopyDayItem {
  id: string
  primary: string
  secondary?: string
}

export interface CopyDayDialogProps {
  open: boolean
  sourceDate: string
  targetDate: string
  items: readonly CopyDayItem[]
  selectedIds: ReadonlySet<string>
  loading?: boolean
  busy?: boolean
  emptyMessage: string
  errorMessage?: string
  onSourceDateChange: (date: string) => void
  onSelectionChange: (id: string, selected: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  return `${match[3]}.${match[2]}.${match[1]}`
}

export function CopyDayDialog({
  open,
  sourceDate,
  targetDate,
  items,
  selectedIds,
  loading = false,
  busy = false,
  emptyMessage,
  errorMessage = '',
  onSourceDateChange,
  onSelectionChange,
  onCancel,
  onConfirm,
}: CopyDayDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const sameDay = sourceDate === targetDate
  const canConfirm =
    !loading &&
    !busy &&
    !sameDay &&
    items.some((item) => selectedIds.has(item.id))

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="copy-day-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClose={() => {
        if (open) onCancel()
      }}
    >
      <div className="copy-day-dialog__card">
        <header className="copy-day-dialog__header">
          <div>
            <h2 id={titleId}>Tag kopieren</h2>
            <p>Ausgewählte Einträge werden nach {formatDate(targetDate)} übernommen.</p>
          </div>
        </header>

        <div className="copy-day-dialog__body">
          <label className="copy-day-dialog__date">
            <span>Einträge von</span>
            <input
              type="date"
              value={sourceDate}
              disabled={busy}
              onChange={(event) => onSourceDateChange(event.target.value)}
            />
          </label>

          {sameDay ? (
            <p className="copy-day-dialog__message">
              Quelltag und Zieltag müssen verschieden sein.
            </p>
          ) : errorMessage ? (
            <p className="copy-day-dialog__message copy-day-dialog__message--error">
              {errorMessage}
            </p>
          ) : loading ? (
            <p className="copy-day-dialog__message" aria-live="polite">
              Einträge werden geladen …
            </p>
          ) : items.length ? (
            <fieldset className="copy-day-dialog__list">
              <legend>Einträge auswählen</legend>
              {items.map((item) => (
                <label className="copy-day-dialog__item" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    disabled={busy}
                    onChange={(event) =>
                      onSelectionChange(item.id, event.target.checked)
                    }
                  />
                  <span className="copy-day-dialog__item-copy">
                    <strong>{item.primary}</strong>
                    {item.secondary ? <small>{item.secondary}</small> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="copy-day-dialog__message">{emptyMessage}</p>
          )}
        </div>

        <footer className="copy-day-dialog__actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Abbrechen
          </button>
          <button
            type="button"
            className="copy-day-dialog__confirm"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {busy ? 'Übernimmt …' : 'OK'}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
