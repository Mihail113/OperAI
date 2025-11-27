import React, { useState, useEffect, useMemo } from "react";
import "../styles/formPage.css";
const APIURL = import.meta.env.VITE_API_URL as string;
const FIRST4 = [
  "Имя",
  "Фамилия",
  "Отчество (при наличии)",
  "Город",
];
const OPTIONAL_LABEL = "Отчество (при наличии)";

// Days of week in Russian (0 = Monday, 6 = Sunday)
const DAYS_OF_WEEK = [
  { value: 0, label: "Понедельник" },
  { value: 1, label: "Вторник" },
  { value: 2, label: "Среда" },
  { value: 3, label: "Четверг" },
  { value: 4, label: "Пятница" },
  { value: 5, label: "Суббота" },
  { value: 6, label: "Воскресенье" },
];

type Manager = { username: string; fullname: string };

type QuestionsResponse = {
  questions: string[];
};

type TimeInterval = {
  start: string;
  end: string;
};

type ScheduleDay = {
  dayOfWeek: number;
  intervals: TimeInterval[];
};

export const FormEmpPage: React.FC = () => {
  const [serverQuestions, setServerQuestions] = useState<string[]>([]);
  // const [formatErrorIndexes, setFormatErrorIndexes] = useState<number[]>([]);
  // const [selfErrorIndexes, setSelfErrorIndexes] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);

  // State for managers selection
  const [possibleManagers, setPossibleManagers] = useState<Manager[]>([]);
  const [managersLoading, setManagersLoading] = useState(false);
  const [managersFetchError, setManagersFetchError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedManagers, setSelectedManagers] = useState<string[]>([]);
  const [mgrError, setMgrError] = useState<string | null>(null);

  // Schedule state
  const [schedule, setSchedule] = useState<ScheduleDay[]>([
    { dayOfWeek: 0, intervals: [{ start: "09:00", end: "18:00" }] }
  ]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [daySearchTerm, setDaySearchTerm] = useState("");
  const [showDayDropdown, setShowDayDropdown] = useState(false);

  const allQuestions = useMemo(() => [...FIRST4, ...serverQuestions], [serverQuestions]);
  const [answers, setAnswers] = useState<string[]>([]);

  useEffect(() => {
    // Синхронизация длины ответов при изменении списка вопросов
    setAnswers(prev => {
      if (prev.length < allQuestions.length) {
        return [...prev, ...Array(allQuestions.length - prev.length).fill("")];
      }
      if (prev.length > allQuestions.length) {
        return prev.slice(0, allQuestions.length);
      }
      return prev;
    });
  }, [allQuestions.length]);

  const [actorUsername, setActorUsername] = useState<string>("");
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    const uname = `@${tg?.initDataUnsafe?.user?.username}`;
    setActorUsername(uname);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("company_id");
    setCompanyId(idParam ? parseInt(idParam, 10) : null);
  }, []);

  useEffect(() => {
    // const tg = (window as any).Telegram?.WebApp;
    // const username: string | undefined = `@${tg?.initDataUnsafe?.user?.username}`
    // if (!username) return;
    if (!actorUsername || !companyId) return; // ждём корректные данные

    setLoading(true);
    fetch(
      `${APIURL}/get_questions?username=${encodeURIComponent(actorUsername)}&company_id=${companyId}`
    )
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<QuestionsResponse>;
      })
      .then(json => {
        setServerQuestions(Array.isArray(json.questions) ? json.questions : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    // Fetch company workers for manager selection
    setManagersLoading(true);
    fetch(`${APIURL}/get_company_workers?company_id=${companyId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setPossibleManagers(json.workers ?? []))
      .catch((e) => setManagersFetchError(e.message))
      .finally(() => setManagersLoading(false));
  }, [APIURL, actorUsername, companyId]);

  const handleAnswerChange = (index: number, value: string) => {
    setAnswers(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Convert to options for search
  const managerOptions = useMemo(
    () =>
      possibleManagers.map((s) => ({
        value: s.username,
        label: `${s.username} — ${s.fullname}`,
        raw: s,
      })),
    [possibleManagers]
  );

  // Search filter
  const filteredManagers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return managerOptions;
    return managerOptions.filter(
      (o) =>
        o.value.toLowerCase().includes(q) || // by tg-username
        o.raw.fullname.toLowerCase().includes(q) // by fullname
    );
  }, [searchTerm, managerOptions]);

  const handleSelectManager = (name: string) => {
    setSelectedManagers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]
    );
  };

  // Schedule functions
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

  // Проверка перекрытия двух интервалов
  const intervalsOverlap = (a: TimeInterval, b: TimeInterval): boolean => {
    return a.start < b.end && b.start < a.end;
  };

  const validateSchedule = (): boolean => {
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

  const getDayLabel = (dayValue: number) => {
    return DAYS_OF_WEEK.find((d) => d.value === dayValue)?.label || "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setMgrError(null);
    setError(null);
    setScheduleError(null);
    
    if (!companyId) {
      setError("Не удалось определить компанию. Откройте форму из приглашения ещё раз.");
      return;
    }

    if (selectedManagers.length === 0) {
      setMgrError("Укажите хотя бы одного начальника");
      return;
    }

    if (schedule.length === 0) {
      setScheduleError("Добавьте хотя бы один рабочий день");
      return;
    }

    if (!validateSchedule()) {
      return;
    }

    const normalizedAnswers = answers.map((a) => (a ?? "").trim());

    // Format schedule for payload (serialize as JSON string for backend compatibility)
    const schedulePayload = schedule.map((day) => ({
      day: day.dayOfWeek,
      intervals: day.intervals.map((interval) => ({
        start: interval.start,
        end: interval.end
      }))
    }));

    // словарь ответов: "managers" -> список начальников, далее — ответы на вопросы
    const payload: Record<string, unknown> = {};
    payload["managers"] = selectedManagers;
    payload["schedule"] = JSON.stringify(schedulePayload);
    for (let i = 0; i < FIRST4.length; i++) {
      payload[String(i) + "_" + FIRST4[i]] = normalizedAnswers[i];
    }
    for (let i = 0; i < serverQuestions.length; i++) {
      payload[String(i + FIRST4.length) + "_" + serverQuestions[i]] = normalizedAnswers[i + FIRST4.length];
    }

    // отправка на связующий сервер
    try {
      const res = await fetch(
        `${APIURL}/submit_emp_answers?actor_username=${encodeURIComponent(actorUsername)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: companyId, answers: payload }),
        });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      let data: { status?: string } = {};
      data = await res.json();

      if (res.ok && data.status === "ok") {
        // успешное завершение — закрываем мини‑апп
        (window as any).Telegram?.WebApp?.close();
        return;
      }

      // иначе считаем, что ошибка
      setMgrError("Произошла ошибка при сохранении данных.");
    } catch (e: any) {
      setMgrError(e.message || "Ошибка соединения");
    }
  };

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>Анкета для сотрудника</h2>

        {loading && <div>Загрузка вопросов...</div>}
        {error && <div style={{ color: "crimson" }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="question-block">
            <label>Выберите своих непосредственных начальников</label>

            <input
              type="text"
              placeholder="Начните вводить ФИО или @ник..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {managersLoading && <div>Загрузка списка сотрудников...</div>}
            {managersFetchError && <div style={{ color: "crimson" }}>Ошибка: {managersFetchError}</div>}

            {searchTerm && (
              <div className="custom-select">
                {filteredManagers.length > 0 ? (
                  filteredManagers.map((o) => (
                    <div
                      key={o.value}
                      className={`option ${selectedManagers.includes(o.value) ? "selected" : ""}`}
                      onClick={() => handleSelectManager(o.value)}
                    >
                      {o.label}
                    </div>
                  ))
                ) : (
                  <p style={{ marginTop: 8, color: "#888" }}>Совпадений нет</p>
                )}
              </div>
            )}

            {selectedManagers.length > 0 && (
              <div className="selected-list">
                <h4>Выбранные начальники:</h4>
                <ul>
                  {selectedManagers.map((m) => (
                    <li key={m}>
                      {m}{" "}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedManagers((prev) => prev.filter((x) => x !== m))
                        }
                      >
                        ✖
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mgrError && (
              <div style={{ color: "crimson", marginTop: 6 }}>{mgrError}</div>
            )}
          </div>

          {allQuestions.map((q, i) => (
            <div key={i} className="question-block">
              <label>{q}</label>
              <input
                type="text"
                value={answers[i] ?? ""}
                onChange={(e) => handleAnswerChange(i, e.target.value)}
                required={q !== OPTIONAL_LABEL}
              />
            </div>
          ))}

          {/* Schedule section */}
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

          <button type="submit" className="submit-btn">
            Отправить
          </button>
        </form>
      </div>
    </div>
  );
};