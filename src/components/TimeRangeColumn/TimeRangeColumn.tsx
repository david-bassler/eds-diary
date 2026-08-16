import { useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./TimeRangeColumn.css";

export type TimeRange = {
  start: string;
  end: string;
};

export type TimeRangeColumnProps = {
  begin: string;
  end: string;
  resolution: number;
  value?: TimeRange;
  onChange?: (range: TimeRange) => void;
  label?: string;
};

type DragState = {
  pointerId: number;
  originX: number;
  side: "left" | "right";
  anchor: number;
  coarseTime: number;
};

const MINUTES_PER_DAY = 24 * 60;
const FINE_GESTURE_DISTANCE = 52;

function parseTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0))
    return Number.NaN;
  return hours * 60 + minutes;
}

function formatTime(minutes: number) {
  const safeMinutes = Math.max(
    0,
    Math.min(MINUTES_PER_DAY, Math.round(minutes)),
  );
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function snap(value: number, step: number, min: number, max: number) {
  return Math.max(
    min,
    Math.min(max, min + Math.round((value - min) / step) * step),
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function timeFromPointer(
  clientY: number,
  bounds: DOMRect,
  begin: number,
  end: number,
  step: number,
) {
  const ratio = Math.max(
    0,
    Math.min(1, (clientY - bounds.top) / bounds.height),
  );
  return snap(begin + ratio * (end - begin), step, begin, end);
}

function createTicks(begin: number, end: number) {
  const firstHour = Math.ceil(begin / 60) * 60;
  const ticks: number[] = [];
  for (let minute = firstHour; minute <= end; minute += 60) ticks.push(minute);
  return ticks;
}

export function TimeRangeColumn({
  begin,
  end,
  resolution,
  value,
  onChange,
  label = "Zeitraum auswählen",
}: TimeRangeColumnProps) {
  const beginMinutes = parseTime(begin);
  const endMinutes = parseTime(end);
  const valid =
    Number.isFinite(beginMinutes) &&
    Number.isFinite(endMinutes) &&
    endMinutes > beginMinutes &&
    resolution > 0;
  const defaultStart = valid
    ? snap(
        beginMinutes + (endMinutes - beginMinutes) * 0.32,
        resolution,
        beginMinutes,
        endMinutes,
      )
    : 0;
  const defaultEnd = valid
    ? snap(
        beginMinutes + (endMinutes - beginMinutes) * 0.48,
        resolution,
        beginMinutes,
        endMinutes,
      )
    : 0;
  const [internalRange, setInternalRange] = useState({
    start: defaultStart,
    end: defaultEnd,
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [fineMode, setFineMode] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();

  if (!valid) {
    return (
      <section className="timerange timerange--invalid" aria-label={label}>
        <strong>Zeitraum nicht verfügbar</strong>
        <p>
          „begin“ und „end“ müssen gültige Uhrzeiten sein; „resolution“ muss
          größer als 0 sein.
        </p>
      </section>
    );
  }

  const controlledRange = value
    ? { start: parseTime(value.start), end: parseTime(value.end) }
    : internalRange;
  const range = {
    start: clamp(
      Number.isFinite(controlledRange.start)
        ? controlledRange.start
        : defaultStart,
      beginMinutes,
      endMinutes,
    ),
    end: clamp(
      Number.isFinite(controlledRange.end) ? controlledRange.end : defaultEnd,
      beginMinutes,
      endMinutes,
    ),
  };
  const normalizedRange =
    range.start <= range.end ? range : { start: range.end, end: range.start };
  const duration = normalizedRange.end - normalizedRange.start;
  const ticks = createTicks(beginMinutes, endMinutes);
  const fineResolution = Math.max(1, Math.floor(resolution / 5));

  const emitRange = (next: { start: number; end: number }) => {
    const normalized =
      next.start <= next.end ? next : { start: next.end, end: next.start };
    if (!value) setInternalRange(normalized);
    onChange?.({
      start: formatTime(normalized.start),
      end: formatTime(normalized.end),
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !surfaceRef.current) return;
    const bounds = surfaceRef.current.getBoundingClientRect();
    const time = timeFromPointer(
      event.clientY,
      bounds,
      beginMinutes,
      endMinutes,
      resolution,
    );
    const side =
      event.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
    event.currentTarget.setPointerCapture(event.pointerId);
    setFineMode(false);
    setDrag({
      pointerId: event.pointerId,
      originX: event.clientX,
      side,
      anchor: time,
      coarseTime: time,
    });
    emitRange({ start: time, end: time });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId || !surfaceRef.current)
      return;
    const bounds = surfaceRef.current.getBoundingClientRect();
    const lateralDistance =
      drag.side === "left"
        ? event.clientX - drag.originX
        : drag.originX - event.clientX;
    const isFine = lateralDistance >= FINE_GESTURE_DISTANCE;
    const step = isFine ? fineResolution : resolution;
    const current = timeFromPointer(
      event.clientY,
      bounds,
      beginMinutes,
      endMinutes,
      step,
    );
    setFineMode(isFine);
    setDrag({ ...drag, coarseTime: isFine ? drag.coarseTime : current });
    emitRange({ start: drag.anchor, end: isFine ? current : current });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
    setFineMode(false);
  };

  const updateBoundary = (boundary: "start" | "end", nextValue: number) => {
    emitRange({ ...normalizedRange, [boundary]: nextValue });
  };

  return (
    <section className="timerange" aria-label={label}>
      <header className="timerange__header">
        <div>
          <span className="timerange__eyebrow">Tagesplanung</span>
          <h2>{label}</h2>
        </div>
        <output className="timerange__summary" aria-live="polite">
          <strong>
            {formatTime(normalizedRange.start)}–
            {formatTime(normalizedRange.end)}
          </strong>
          <span>{duration} Minuten</span>
        </output>
      </header>

      <p id={descriptionId} className="timerange__hint">
        Ziehe senkrecht für {resolution}-Minuten-Schritte. Ziehe von einer Seite
        zur Mitte, um lokal auf {fineResolution} Minute
        {fineResolution === 1 ? "" : "n"} zu verfeinern.
      </p>

      <div className="timerange__workspace">
        <div className="timerange__times" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              style={{
                top: `${((tick - beginMinutes) / (endMinutes - beginMinutes)) * 100}%`,
              }}
            >
              {formatTime(tick)}
            </span>
          ))}
        </div>
        <div
          ref={surfaceRef}
          className={`timerange__surface${fineMode ? " timerange__surface--fine" : ""}`}
          aria-describedby={descriptionId}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          data-testid="time-range-surface"
        >
          <div className="timerange__grid" aria-hidden="true" />
          <div
            className="timerange__lane timerange__lane--left"
            aria-hidden="true"
          >
            Start links
          </div>
          <div
            className="timerange__lane timerange__lane--right"
            aria-hidden="true"
          >
            Start rechts
          </div>
          <div
            className="timerange__selection"
            style={{
              top: `${((normalizedRange.start - beginMinutes) / (endMinutes - beginMinutes)) * 100}%`,
              height: `${Math.max(1.2, (duration / (endMinutes - beginMinutes)) * 100)}%`,
            }}
            aria-hidden="true"
          >
            <span>{formatTime(normalizedRange.start)}</span>
            <span className="timerange__selectionend">
              {formatTime(normalizedRange.end)}
            </span>
          </div>
          {fineMode && (
            <div className="timerange__finelabel" role="status">
              Feinmodus · {fineResolution} min
            </div>
          )}
        </div>
      </div>

      <fieldset className="timerange__controls">
        <legend>Präzise Auswahl per Tastatur</legend>
        <label>
          <span>
            Beginn <output>{formatTime(normalizedRange.start)}</output>
          </span>
          <input
            aria-label="Beginn anpassen"
            type="range"
            min={beginMinutes}
            max={endMinutes}
            step={resolution}
            value={normalizedRange.start}
            onChange={(event) =>
              updateBoundary("start", Number(event.target.value))
            }
          />
        </label>
        <label>
          <span>
            Ende <output>{formatTime(normalizedRange.end)}</output>
          </span>
          <input
            aria-label="Ende anpassen"
            type="range"
            min={beginMinutes}
            max={endMinutes}
            step={resolution}
            value={normalizedRange.end}
            onChange={(event) =>
              updateBoundary("end", Number(event.target.value))
            }
          />
        </label>
      </fieldset>
    </section>
  );
}
