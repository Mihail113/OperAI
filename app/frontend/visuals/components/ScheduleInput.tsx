import React, { useMemo, useState } from "react";

// Days of week in Russian (0 = Monday, 6 = Sunday)
export const DAYS_OF_WEEK = [
  { value: 0, label: "Понедельник" },
  { value: 1, label: "Вторник" },
  { value: 2, label: "Среда" },
  { value: 3, label: "Четверг" },
  { value: 4, label: "Пятница" },
  { value: 5, label: "Суббота" },
  { value: 6, label: "Воскресенье" },
];

export type TimeInterval = {
  start: string;
  end: string;
};

export type ScheduleDay = {
  dayOfWeek: number;
  intervals: TimeInterval[];
};

// Default Mon-Fri schedule (days 0-4)
export const DEFAULT_SCHEDULE: ScheduleDay[] = [
  { dayOfWeek: 0, intervals: [{ start: "09:00", end: "18:00" }] },
  { dayOfWeek: 1, intervals: [{ start: "09:00", end: "18:00" }] },
  { dayOfWeek: 2, intervals: [{ start: "09:00", end: "18:00" }] },
  { dayOfWeek: 3, intervals: [{ start: "09:00", end: "18:00" }] },
  { dayOfWeek: 4, intervals: [{ start: "09:00", end: "18:00" }] },
];

type ScheduleInputProps = {
  schedule: ScheduleDay[];
  setSchedule: React.Dispatch<React.SetStateAction<ScheduleDay[]>>;
  scheduleError: string | null;
};

// Проверка перекрытия двух интервалов
export const intervalsOverlap = (a: TimeInterval, b: TimeInterval): boolean => {
  return a.start < b.end && b.start < a.end;
};

export const validateSchedule = (
  schedule: ScheduleDay[],
  setScheduleError: (error: string | null) => void
): boolean => {
  for (const day of schedule) {
    for (const interval of day.intervals) {
      if (!interval.start || !interval.end) {
        setScheduleError("Заполните все поля времени");
        return false;
      }
      if (interval.start >= interval.end) {
        const dayLabel = DAYS_OF_WEEK.find((d) => d.value === day.dayOfWeek)?.label;
        setScheduleError(`${dayLabel}: промежуток ${interval.start}–${interval.end} — время начала должно быть меньше времени окончания`);
        return false;
      }
    }

    // Проверка на перекрытие промежутков внутри одного дня
    const intervals = day.intervals;
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        if (intervalsOverlap(intervals[i], intervals[j])) {
          const dayLabel = DAYS_OF_WEEK.find((d) => d.value === day.dayOfWeek)?.label;
          setScheduleError(
            `${dayLabel}: промежутки ${intervals[i].start}–${intervals[i].end} и ${intervals[j].start}–${intervals[j].end} перекрываются. Промежутки для одного дня не должны перекрываться.`
          );
          return false;
        }
      }
    }
  }
  setScheduleError(null);
  return true;
};

export const ScheduleInput: React.FC<ScheduleInputProps> = ({
  schedule,
  setSchedule,
  scheduleError,
}) => {
  const [daySearchTerm, setDaySearchTerm] = useState("");
  const [showDayDropdown, setShowDayDropdown] = useState(false);

  const availableDays = useMemo(() => {
    const usedDays = new Set(schedule.map((s) => s.dayOfWeek));
    return DAYS_OF_WEEK.filter((d) => !usedDays.has(d.value));
  }, [schedule]);

  const filteredDays = useMemo(() => {
    const q = daySearchTerm.trim().toLowerCase();
    if (!q) return availableDays;
    return availableDays.filter((d) => d.label.toLowerCase().includes(q));
  }, [daySearchTerm, availableDays]);

  const handleAddDay = (dayValue: number) => {
    setSchedule((prev) => [
      ...prev,
      { dayOfWeek: dayValue, intervals: [{ start: "09:00", end: "18:00" }] }
    ]);
    setDaySearchTerm("");
    setShowDayDropdown(false);
  };

  const handleRemoveDay = (dayIndex: number) => {
    setSchedule((prev) => prev.filter((_, i) => i !== dayIndex));
  };

  const handleAddInterval = (dayIndex: number) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex] = {
        ...updated[dayIndex],
        intervals: [...updated[dayIndex].intervals, { start: "09:00", end: "18:00" }]
      };
      return updated;
    });
  };

  const handleRemoveInterval = (dayIndex: number, intervalIndex: number) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex] = {
        ...updated[dayIndex],
        intervals: updated[dayIndex].intervals.filter((_, i) => i !== intervalIndex)
      };
      // If no intervals left, remove the day
      if (updated[dayIndex].intervals.length === 0) {
        return updated.filter((_, i) => i !== dayIndex);
      }
      return updated;
    });
  };

  const handleIntervalChange = (
    dayIndex: number,
    intervalIndex: number,
    field: "start" | "end",
    value: string
  ) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex] = {
        ...updated[dayIndex],
        intervals: updated[dayIndex].intervals.map((interval, i) =>
          i === intervalIndex ? { ...interval, [field]: value } : interval
        )
      };
      return updated;
    });
  };

  const getDayLabel = (dayValue: number) => {
    return DAYS_OF_WEEK.find((d) => d.value === dayValue)?.label || "";
  };

  return (
    <div className="question-block">
      <label>Расписание (дни недели и рабочие часы)</label>

      {/* Existing schedule days */}
      {schedule
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((day, dayIndex) => (
          <div
            key={day.dayOfWeek}
            style={{
              background: "#f8f8f8",
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <strong>{getDayLabel(day.dayOfWeek)}</strong>
              <button
                type="button"
                onClick={() => handleRemoveDay(dayIndex)}
                style={{
                  background: "#ff6961",
                  border: "none",
                  color: "white",
                  borderRadius: 6,
                  padding: "5px 12px",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1.5,
                  minHeight: "auto",
                }}
              >
                Удалить день
              </button>
            </div>

            {/* Time intervals */}
            {day.intervals.map((interval, intervalIndex) => (
              <div
                key={intervalIndex}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <input
                  type="time"
                  value={interval.start}
                  onChange={(e) =>
                    handleIntervalChange(dayIndex, intervalIndex, "start", e.target.value)
                  }
                  style={{
                    flex: "1 1 80px",
                    minWidth: 80,
                    padding: "6px 10px",
                    lineHeight: 1.3,
                    minHeight: "auto",
                    fontSize: 14,
                  }}
                />
                <span>—</span>
                <input
                  type="time"
                  value={interval.end}
                  onChange={(e) =>
                    handleIntervalChange(dayIndex, intervalIndex, "end", e.target.value)
                  }
                  style={{
                    flex: "1 1 80px",
                    minWidth: 80,
                    padding: "6px 10px",
                    lineHeight: 1.3,
                    minHeight: "auto",
                    fontSize: 14,
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveInterval(dayIndex, intervalIndex)}
                  style={{
                    background: "#ff6961",
                    border: "none",
                    color: "white",
                    borderRadius: 6,
                    padding: "8px 10px",
                    cursor: "pointer",
                    fontSize: 14,
                    minHeight: "auto",
                    lineHeight: 1.3,
                  }}
                >
                  ✖
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => handleAddInterval(dayIndex)}
              style={{
                background: "#40d0b0",
                border: "none",
                color: "white",
                borderRadius: 6,
                padding: "5px 12px",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1.5,
                minHeight: "auto",
                marginTop: 4,
              }}
            >
              + Добавить промежуток
            </button>
          </div>
        ))}

      {/* Add new day */}
      {availableDays.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <input
            type="text"
            placeholder="Введите день недели..."
            value={daySearchTerm}
            onChange={(e) => {
              setDaySearchTerm(e.target.value);
              setShowDayDropdown(true);
            }}
            onFocus={() => setShowDayDropdown(true)}
          />

          {showDayDropdown && (
            <div className="custom-select" style={{ marginTop: 8 }}>
              {filteredDays.length > 0 ? (
                filteredDays.map((d) => (
                  <div
                    key={d.value}
                    className="option"
                    onClick={() => handleAddDay(d.value)}
                  >
                    {d.label}
                  </div>
                ))
              ) : (
                <p style={{ marginTop: 8, color: "#888" }}>Нет доступных дней</p>
              )}
            </div>
          )}
        </div>
      )}

      {scheduleError && (
        <div style={{ color: "crimson", marginTop: 6 }}>{scheduleError}</div>
      )}
    </div>
  );
};

