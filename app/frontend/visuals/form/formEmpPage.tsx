import React, { useState, useEffect, useMemo } from "react";
import "../styles/formPage.css";
import { ScheduleInput, ScheduleDay, DEFAULT_SCHEDULE, validateSchedule } from "../components/ScheduleInput";

const APIURL = import.meta.env.VITE_API_URL as string;
const FIRST4 = [
  "Имя",
  "Фамилия",
  "Отчество (при наличии)",
  "Город",
];
const OPTIONAL_LABEL = "Отчество (при наличии)";

type Manager = { username: string; fullname: string };

type QuestionsResponse = {
  questions: string[];
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

  // Schedule state - default Mon-Fri
  const [schedule, setSchedule] = useState<ScheduleDay[]>([...DEFAULT_SCHEDULE]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

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

    if (!validateSchedule(schedule, setScheduleError)) {
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
          <ScheduleInput
            schedule={schedule}
            setSchedule={setSchedule}
            scheduleError={scheduleError}
          />

          <button type="submit" className="submit-btn">
            Отправить
          </button>
        </form>
      </div>
    </div>
  );
};