import { Fragment, useEffect, useId, useRef, useState } from "react";
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
  rangeColors?: readonly string[];
  rangeLabels?: readonly string[];
  rangeOngoing?: readonly boolean[];
  onChange?: (ranges: TimeRange[]) => void;
  onRangeActivate?: (index: number) => void;
  onRangeCreated?: (index: number, range: TimeRange) => void;
  activeRangeIndex?: number | null;
  label?: string;
  workspaceAnchorId?: string;
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

type TouchGestureState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastY: number;
  anchor: number;
  current: number;
  baseRanges: MinuteRange[];
  mode: "pending" | "scrolling" | "creating";
  holdTimer: number;
};

type LayoutRange = MinuteRange & {
  index: number;
  column: number;
  columns: number;
};

const MINUTES_PER_DAY = 24 * 60;
const FINE_GESTURE_DISTANCE = 52;
const TOUCH_SCROLL_THRESHOLD = 10;
const TOUCH_HOLD_DELAY_MS = 300;
const MIN_LABEL_DURATION_MINUTES = 150;

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
  rangeColors,
  rangeLabels,
  rangeOngoing,
  onChange,
  onRangeActivate,
  onRangeCreated,
  activeRangeIndex = null,
  label = "Zeiträume auswählen",
  workspaceAnchorId,
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
  const [touchCreateMode, setTouchCreateMode] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const touchGestureRef = useRef<TouchGestureState | null>(null);
  const descriptionId = useId();

  useEffect(() => {
    return () => {
      const gesture = touchGestureRef.current;
      if (gesture) window.clearTimeout(gesture.holdTimer);
    };
  }, []);

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

    if (event.pointerType === "touch") {
      const pointerId = event.pointerId;
      const gesture: TouchGestureState = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastY: event.clientY,
        anchor: time,
        current: time,
        baseRanges: ranges,
        mode: "pending",
        holdTimer: 0,
      };

      gesture.holdTimer = window.setTimeout(() => {
        const activeGesture = touchGestureRef.current;
        if (
          !activeGesture ||
          activeGesture.pointerId !== pointerId ||
          activeGesture.mode !== "pending"
        ) {
          return;
        }

        activeGesture.mode = "creating";
        setTouchCreateMode(true);
        emitRanges([
          ...activeGesture.baseRanges,
          { start: activeGesture.anchor, end: activeGesture.anchor },
        ]);
      }, TOUCH_HOLD_DELAY_MS);

      touchGestureRef.current = gesture;
      return;
    }

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
    const touchGesture = touchGestureRef.current;
    if (touchGesture?.pointerId === event.pointerId) {
      if (touchGesture.mode === "pending") {
        const movement = Math.hypot(
          event.clientX - touchGesture.startX,
          event.clientY - touchGesture.startY,
        );
        if (movement < TOUCH_SCROLL_THRESHOLD) return;

        window.clearTimeout(touchGesture.holdTimer);
        touchGesture.mode = "scrolling";
      }

      if (touchGesture.mode === "scrolling") {
        const scrollDelta = touchGesture.lastY - event.clientY;
        touchGesture.lastY = event.clientY;
        window.scrollBy(0, scrollDelta);
        return;
      }

      if (touchGesture.mode === "creating" && surfaceRef.current) {
        const bounds = surfaceRef.current.getBoundingClientRect();
        const current = timeFromPointer(
          event.clientY,
          bounds,
          beginMinutes,
          endMinutes,
          resolution,
        );
        touchGesture.current = current;
        emitRanges([
          ...touchGesture.baseRanges,
          { start: touchGesture.anchor, end: current },
        ]);
      }
      return;
    }

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
    const touchGesture = touchGestureRef.current;
    if (touchGesture?.pointerId === event.pointerId) {
      window.clearTimeout(touchGesture.holdTimer);
      touchGestureRef.current = null;

      if (touchGesture.mode !== "creating") return;

      setTouchCreateMode(false);

      if (touchGesture.current === touchGesture.anchor) {
        emitRanges(touchGesture.baseRanges);
        return;
      }

      const createdRange = normalizeMinuteRange(
        { start: touchGesture.anchor, end: touchGesture.current },
        beginMinutes,
        endMinutes,
      );

      emitRanges([...touchGesture.baseRanges, createdRange]);
      const createdIndex = touchGesture.baseRanges.length;
      onRangeCreated?.(createdIndex, {
        start: formatTime(createdRange.start),
        end: formatTime(createdRange.end),
      });
      return;
    }

    if (!drag || drag.pointerId !== event.pointerId) return;

    const endCandidate =
      drag.current === drag.anchor
        ? drag.anchor + resolution <= endMinutes
          ? drag.anchor + resolution
          : drag.anchor - resolution
        : drag.current;
    const createdRange = normalizeMinuteRange(
      { start: drag.anchor, end: endCandidate },
      beginMinutes,
      endMinutes,
    );

    emitRanges([...drag.baseRanges, createdRange]);

    const createdIndex = drag.baseRanges.length;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
    setFineMode(false);
    onRangeCreated?.(createdIndex, {
      start: formatTime(createdRange.start),
      end: formatTime(createdRange.end),
    });
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const touchGesture = touchGestureRef.current;
    if (touchGesture?.pointerId === event.pointerId) {
      window.clearTimeout(touchGesture.holdTimer);
      touchGestureRef.current = null;
      setTouchCreateMode(false);
      if (touchGesture.mode === "creating") emitRanges(touchGesture.baseRanges);
      return;
    }

    if (!drag || drag.pointerId !== event.pointerId) return;

    emitRanges(drag.baseRanges);
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
    setFineMode(false);
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
        Mit der Maus ziehst du senkrecht, um einen Zeitraum in {resolution}-Minuten-
        Schritten hinzuzufügen. Auf Touchscreens scrollt eine direkte Wischgeste;
        halte kurz an einer Startzeit, bis die Auswahl aktiviert ist, und ziehe dann
        zum Ende der Aktivität. Überschneidungen werden gleich breit nebeneinander
        dargestellt. Mit der Maus kannst du von einer Seite zur Mitte ziehen, um
        lokal auf {fineResolution} Minute{fineResolution === 1 ? "" : "n"} zu
        verfeinern.
        {onRangeActivate
          ? " Die rechte Hälfte eines Zeitraums öffnet seine Details."
          : ""}
      </p>

      <div className="timerange__workspace" id={workspaceAnchorId}>
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
          className={`timerange__surface${fineMode ? " timerange__surface--fine" : ""}${touchCreateMode ? " timerange__surface--touch-create" : ""}`}
          aria-describedby={descriptionId}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={cancelDrag}
          data-testid="time-range-surface"
        >
          <div className="timerange__grid" aria-hidden="true" />
          {layout.map((range) => {
            const duration = Math.max(0, range.end - range.start);
            const left = (range.column / range.columns) * 100;
            const width = 100 / range.columns;
            const rangeLabel = rangeLabels?.[range.index]?.trim() ?? "";
            const isOngoing = rangeOngoing?.[range.index] === true;
            const showRangeLabel =
              Boolean(rangeLabel) && duration >= MIN_LABEL_DURATION_MINUTES;

            const top =
              ((range.start - beginMinutes) / (endMinutes - beginMinutes)) * 100;
            const height = Math.max(
              1.2,
              (duration / (endMinutes - beginMinutes)) * 100,
            );
            const center = top + height / 2;

            return (
              <Fragment key={range.index}>
                <div
                  className={`timerange__selection${activeRangeIndex === range.index ? " timerange__selection--active" : ""}${isOngoing ? " timerange__selection--ongoing" : ""}`}
                  style={{
                    top: `${top}%`,
                    height: `${height}%`,
                    left: `calc(${left}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    backgroundColor: rangeColors?.[range.index],
                  }}
                  aria-hidden="true"
                  data-range-index={range.index}
                  data-overlap-columns={range.columns}
                  data-range-color={rangeColors?.[range.index]}
                >
                  <span>{formatTime(range.start)}</span>
                  {showRangeLabel ? (
                    <span className="timerange__selectionlabel" title={rangeLabel}>
                      {rangeLabel}
                    </span>
                  ) : null}
                  <span className="timerange__selectionend">
                    {isOngoing ? "läuft" : formatTime(range.end)}
                  </span>
                </div>
                {onRangeActivate ? (
                  <button
                    type="button"
                    className="timerange__selectionaction"
                    style={{
                      top: `clamp(22px, ${center}%, calc(100% - 22px))`,
                      height: `max(44px, ${height}%)`,
                      left: `calc(${left + width / 2}% + 2px)`,
                      width: `calc(${width / 2}% - 4px)`,
                    }}
                    aria-label={`Zeitraum ${range.index + 1} · ${formatTime(range.start)}–${isOngoing ? "läuft noch" : formatTime(range.end)}${rangeLabel ? ` · ${rangeLabel}` : ""} öffnen`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRangeActivate(range.index);
                    }}
                  />
                ) : null}
              </Fragment>
            );
          })}
          {fineMode && (
            <div className="timerange__finelabel" role="status">
              Feinmodus · {fineResolution} min
            </div>
          )}
        </div>
      </div>


    </section>
  );
}
