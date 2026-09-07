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
  value?: readonly TimeRange[];
  onChange?: (ranges: TimeRange[]) => void;
  label?: string;
};

type MinuteRange = {
  start: number;
  end: number;
};

type DragState = {
  pointerId: number;
  originX: number;
  side: "left" | "right";
  anchor: number;
  current: number;
  baseRanges: MinuteRange[];
};

type LayoutRange = MinuteRange & {
  index: number;
  column: number;
  columns: number;
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

function normalizeMinuteRange(
  range: MinuteRange,
  begin: number,
  end: number,
): MinuteRange {
  const start = clamp(range.start, begin, end);
  const finish = clamp(range.end, begin, end);
  return start <= finish
    ? { start, end: finish }
    : { start: finish, end: start };
}

function parseRanges(
  ranges: readonly TimeRange[],
  begin: number,
  end: number,
): MinuteRange[] {
  return ranges.flatMap((range) => {
    const start = parseTime(range.start);
    const finish = parseTime(range.end);
    if (!Number.isFinite(start) || !Number.isFinite(finish)) return [];
    return [normalizeMinuteRange({ start, end: finish }, begin, end)];
  });
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

function layoutRanges(
  ranges: readonly MinuteRange[],
  resolution: number,
  end: number,
): LayoutRange[] {
  const sorted = ranges
    .map((range, index) => ({
      ...range,
      index,
      layoutEnd: Math.max(
        range.end,
        Math.min(end, range.start + Math.max(1, resolution)),
      ),
    }))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.layoutEnd - right.layoutEnd ||
        left.index - right.index,
    );

  const result: LayoutRange[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (!cluster.length) return;

    let active: Array<{ end: number; column: number }> = [];
    const assignments = new Map<number, number>();
    let columns = 1;

    for (const item of cluster) {
      active = active.filter((entry) => entry.end > item.start);
      const usedColumns = new Set(active.map((entry) => entry.column));
      let column = 0;
      while (usedColumns.has(column)) column += 1;

      assignments.set(item.index, column);
      active.push({ end: item.layoutEnd, column });
      columns = Math.max(columns, active.length, column + 1);
    }

    for (const item of cluster) {
      result.push({
        start: item.start,
        end: item.end,
        index: item.index,
        column: assignments.get(item.index) ?? 0,
        columns,
      });
    }

    cluster = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    if (cluster.length && item.start >= clusterEnd) flushCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.layoutEnd);
  }
  flushCluster();

  return result.sort((left, right) => left.index - right.index);
}

export function TimeRangeColumn({
  begin,
  end,
  resolution,
  value,
  onChange,
  label = "Zeiträume auswählen",
}: TimeRangeColumnProps) {
  const beginMinutes = parseTime(begin);
  const endMinutes = parseTime(end);
  const valid =
    Number.isFinite(beginMinutes) &&
    Number.isFinite(endMinutes) &&
    endMinutes > beginMinutes &&
    resolution > 0;
  const [internalRanges, setInternalRanges] = useState<MinuteRange[]>([]);
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

  const ranges =
    value === undefined
      ? internalRanges.map((range) =>
          normalizeMinuteRange(range, beginMinutes, endMinutes),
        )
      : parseRanges(value, beginMinutes, endMinutes);
  const layout = layoutRanges(ranges, resolution, endMinutes);
  const ticks = createTicks(beginMinutes, endMinutes);
  const fineResolution = Math.max(1, Math.floor(resolution / 5));
  const totalDuration = ranges.reduce(
    (total, range) => total + Math.max(0, range.end - range.start),
    0,
  );

  const emitRanges = (next: readonly MinuteRange[]) => {
    const normalized = next.map((range) =>
      normalizeMinuteRange(range, beginMinutes, endMinutes),
    );

    if (value === undefined) setInternalRanges(normalized);
    onChange?.(
      normalized.map((range) => ({
        start: formatTime(range.start),
        end: formatTime(range.end),
      })),
    );
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
      current: time,
      baseRanges: ranges,
    });
    emitRanges([...ranges, { start: time, end: time }]);
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
    setDrag({ ...drag, current });
    emitRanges([
      ...drag.baseRanges,
      { start: drag.anchor, end: current },
    ]);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.current === drag.anchor) {
      const endCandidate =
        drag.anchor + resolution <= endMinutes
          ? drag.anchor + resolution
          : drag.anchor - resolution;
      emitRanges([
        ...drag.baseRanges,
        { start: drag.anchor, end: endCandidate },
      ]);
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
    setFineMode(false);
  };

  const updateBoundary = (
    index: number,
    boundary: "start" | "end",
    nextValue: number,
  ) => {
    emitRanges(
      ranges.map((range, rangeIndex) =>
        rangeIndex === index
          ? { ...range, [boundary]: nextValue }
          : range,
      ),
    );
  };

  const removeRange = (index: number) => {
    emitRanges(ranges.filter((_, rangeIndex) => rangeIndex !== index));
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
            {ranges.length
              ? `${ranges.length} ${ranges.length === 1 ? "Zeitraum" : "Zeiträume"}`
              : "Keine Auswahl"}
          </strong>
          <span>
            {ranges.length
              ? `${totalDuration} Minuten gesamt`
              : "Zum Hinzufügen ziehen"}
          </span>
        </output>
      </header>

      <p id={descriptionId} className="timerange__hint">
        Ziehe senkrecht, um einen weiteren Zeitraum in {resolution}-Minuten-
        Schritten hinzuzufügen. Überschneidungen werden gleich breit
        nebeneinander dargestellt. Ziehe von einer Seite zur Mitte, um lokal
        auf {fineResolution} Minute{fineResolution === 1 ? "" : "n"} zu
        verfeinern.
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
          {layout.map((range) => {
            const duration = Math.max(0, range.end - range.start);
            const left = (range.column / range.columns) * 100;
            const width = 100 / range.columns;

            return (
              <div
                key={range.index}
                className="timerange__selection"
                style={{
                  top: `${((range.start - beginMinutes) / (endMinutes - beginMinutes)) * 100}%`,
                  height: `${Math.max(1.2, (duration / (endMinutes - beginMinutes)) * 100)}%`,
                  left: `calc(${left}% + 2px)`,
                  width: `calc(${width}% - 4px)`,
                }}
                aria-hidden="true"
                data-range-index={range.index}
                data-overlap-columns={range.columns}
              >
                <span>{formatTime(range.start)}</span>
                <span className="timerange__selectionend">
                  {formatTime(range.end)}
                </span>
              </div>
            );
          })}
          {fineMode && (
            <div className="timerange__finelabel" role="status">
              Feinmodus · {fineResolution} min
            </div>
          )}
        </div>
      </div>

      {ranges.length ? (
        <fieldset className="timerange__controls">
          <legend>Zeiträume präzise bearbeiten</legend>
          <div className="timerange__control-list">
            {ranges.map((range, index) => (
              <div className="timerange__control" key={index}>
                <div className="timerange__control-header">
                  <strong>Zeitraum {index + 1}</strong>
                  <button type="button" onClick={() => removeRange(index)}>
                    Entfernen
                  </button>
                </div>
                <label>
                  <span>
                    Beginn <output>{formatTime(range.start)}</output>
                  </span>
                  <input
                    aria-label={`Beginn Zeitraum ${index + 1} anpassen`}
                    type="range"
                    min={beginMinutes}
                    max={endMinutes}
                    step={resolution}
                    value={range.start}
                    onChange={(event) =>
                      updateBoundary(
                        index,
                        "start",
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <label>
                  <span>
                    Ende <output>{formatTime(range.end)}</output>
                  </span>
                  <input
                    aria-label={`Ende Zeitraum ${index + 1} anpassen`}
                    type="range"
                    min={beginMinutes}
                    max={endMinutes}
                    step={resolution}
                    value={range.end}
                    onChange={(event) =>
                      updateBoundary(index, "end", Number(event.target.value))
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
