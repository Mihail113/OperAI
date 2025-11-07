import React, { useState, useEffect, useMemo, useRef } from "react";
import "../styles/formPage.css";
const APIURL = import.meta.env.VITE_API_URL as string;
const FIRST4 = [
  "Имя",
  "Фамилия",
  "Отчество (при наличии)",
  "Город",
];
const OPTIONAL_LABEL = "Отчество (при наличии)";

export const FormEmpPage: React.FC = () => {
  const [serverQuestions, setServerQuestions] = useState<string[]>([]);
  const [formatErrorIndexes, setFormatErrorIndexes] = useState<number[]>([]);
  const [selfErrorIndexes, setSelfErrorIndexes] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [managers, setManagers] = useState<string[]>([""]);
  const [mgrError, setMgrError] = useState<string | null>(null);
  const managerRefs = useRef<Array<HTMLInputElement | null>>([]);

  const addManager = () => setManagers((prev) => [...prev, ""]);
  const removeManager = (index: number) =>
    setManagers((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  const updateManager = (index: number, value: string) =>
    setManagers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });

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
    // const tg = (window as any).Telegram?.WebApp;
    // const username: string | undefined = `@${tg?.initDataUnsafe?.user?.username}`
    // if (!username) return;
    if (!actorUsername) return; // ждём корректный ник

    setLoading(true);
    fetch(`${APIURL}/get_questions?username=${encodeURIComponent(actorUsername)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<QuestionsResponse>;
      })
      .then(json => {
        setServerQuestions(Array.isArray(json.questions) ? json.questions : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [APIURL, actorUsername]);

  const handleAnswerChange = (index: number, value: string) => {
    setAnswers(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // очистить прошлые маркеры и ошибку
    setSelfErrorIndexes([]);
    setFormatErrorIndexes([]);
    setMgrError(null);

    const managersWithIndex = managers
      .map((m, i) => ({ value: m.trim(), index: i }))
      .filter(({ value }) => value.length > 0);
    const trimmedManagers = managersWithIndex.map(({ value }) => value);

    // форматная проверка никнеймов
    const badStarts = managersWithIndex
      .filter(({ value }) => !value.startsWith("@"))
      .map(({ index }) => index);
    const tooShort = managersWithIndex
      .filter(({ value }) => value.length < 4)
      .map(({ index }) => index);
    if (badStarts.length > 0 || tooShort.length > 0) {
      setFormatErrorIndexes([...new Set([...badStarts, ...tooShort])]);
      if (badStarts.length > 0 && tooShort.length > 0) {
        setMgrError('Никнэйм должен начинаться с "@" и быть в длину хотя бы 4 символа');
      }
      else if (badStarts.length > 0) {
        setMgrError('Никнэйм должен начинаться с "@"');
      } else {
        setMgrError("Никнэйм должен быть в длину хотя бы 4 символа");
      }
      const firstErr = managerRefs.current[(badStarts[0] ?? tooShort[0])!];
      firstErr?.focus();
      firstErr?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // проверяем, не указал ли пользователь себя
    const selfErrorIdxs = managersWithIndex
      .filter(({ value }) => value === actorUsername)
      .map(({ index }) => index);
    if (selfErrorIdxs.length > 0) {
      setSelfErrorIndexes(selfErrorIdxs);
      setMgrError("Вы не можете указать себя в качестве собственного начальника");
      const firstErr = managerRefs.current[selfErrorIdxs[0]];
      firstErr?.focus();
      firstErr?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // 3) если после очистки нет ни одного менеджера
    if (trimmedManagers.length === 0) {
      setMgrError("Укажите никнейм хотя бы одного начальника");
      const first = managerRefs.current.find((el) => el);
      first?.focus();
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const normalizedAnswers = answers.map((a) => (a ?? "").trim());

    // словарь ответов: "1" -> список начальников, далее — ответы на вопросы
    const payload: Record<string, string | string[]> = {};
    payload["1"] = trimmedManagers;
    for (let i = 0; i < normalizedAnswers.length; i++) {
      payload[String(i + 2)] = normalizedAnswers[i];
    }

    // отправка на связующий сервер
    const res = await fetch(
      `${APIURL}/submit_emp_answers?actor_username=${encodeURIComponent(actorUsername)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    // читаем JSON даже при !res.ok, но основной сценарий — 200 OK
    let data: { status?: string } = {};
    data = await res.json();

    if (res.ok && data.status === "ok") {
      // успешное завершение — закрываем мини‑апп
      (window as any).Telegram?.WebApp?.close();
      return;
    }

    // иначе считаем, что ни одного начальника не нашли — обнуляем список начальников
    setManagers([""]);
    setMgrError("Ни один из введенных ранее начальников не был найден в базе данных, попробуйте ещё раз");
    // сбросим refs, чтобы фокус корректно встал на единственное поле при следующем рендере
    managerRefs.current = [];
  };

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>Анкета для сотрудника</h2>

        {loading && <div>Загрузка вопросов...</div>}
        {error && <div style={{ color: "crimson" }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="question-block">
            <label>Введите никнеймы телеграм своих непосредственных начальников</label>

            {managers.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <input
                  type="text"
                  placeholder="@username"
                  value={m}
                  onChange={(e) => updateManager(i, e.target.value)}
                  ref={(el) => (managerRefs.current[i] = el)}
                  // если индекс в ошибочных, рисуем красную рамку
                  style={
                    selfErrorIndexes.includes(i) || formatErrorIndexes.includes(i)
                      ? { border: "1px solid red" }
                      : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => removeManager(i)}
                  disabled={managers.length === 1}
                >
                  Удалить
                </button>
              </div>
            ))}

            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={addManager}>
                Добавить начальника
              </button>
            </div>

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

          <button type="submit" className="submit-btn">
            Отправить
          </button>
        </form>
      </div>
    </div>
  );
};

