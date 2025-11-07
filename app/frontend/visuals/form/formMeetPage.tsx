import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "../styles/formPage.css";
const API_URL = import.meta.env.VITE_API_URL as string;

type Meeting = {
  id: number;
  topic: string;
  members: string[];
  time: string;
  link: string;
};

type Subordinate = { username: string; fullname: string };

// toDo: нужно реализовать удаление встреч и редактирование встреч, а так же подтягивание всех встреч при открытии мини апп.

export const FormMeetPage: React.FC = () => {
  const [subs, setSubs] = useState<Subordinate[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subsError, setSubsError] = useState<string | null>(null);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Состояния для редактирования
  const [editId, setEditId] = useState<number | null>(null);
  const [origTopic, setOrigTopic] = useState<string>("");
  const [origMembers, setOrigMembers] = useState<string[]>([]);
  const [origTime, setOrigTime] = useState<string>("");
  const [origLink, setOrigLink] = useState<string>("");

  // Хелперы сравнения без учета порядка участников
  const sameString = (a: string, b: string) => (a ?? "") === (b ?? "");
  const sameArray = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const A = new Set(a);
    const B = new Set(b);
    return A.difference(B).size === 0;
  };

  // Дифф участников при редактировании
  const computeMembersDiff = (before: string[], after: string[]) => {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const added = [...afterSet].filter(x => !beforeSet.has(x));
    const removed = [...beforeSet].filter(x => !afterSet.has(x));
    return { added, removed };
  };

  // Получаем username из Telegram WebApp (или из вашего стейта/контекста)
  const username = useMemo(() => {
    const tg = (window as any).Telegram?.WebApp;
    return `@${tg?.initDataUnsafe?.user?.username}`;
  }, []);

  const fetchedOnceRef = useRef(false);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `${API_URL}/get_meetings?username=${encodeURIComponent(username)}`
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setMeetings(Array.isArray(data.meetings) ? data.meetings : []);
    } catch (e: any) {
      setError(e?.message || "Ошибка загрузки встреч");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    //if (!username) return;
    // Чтобы в БД приходил ровно один запрос (оно 2 раза монтируется)
    if (fetchedOnceRef.current) return;
    fetchedOnceRef.current = true;

    fetchMeetings();

    setSubsLoading(true);
    fetch(`${API_URL}/get_subordinates?username=${encodeURIComponent(username)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setSubs(json.subordinates ?? []))
      .catch((e) => setSubsError(e.message))
      .finally(() => setSubsLoading(false));
  }, [username]);

  // Преобразуем в удобные для селектора/поиска опции
  const subordinateOptions = useMemo(
    () =>
      subs.map((s) => ({
        value: s.username,
        label: `${s.username} — ${s.fullname}`,
        raw: s,
      })),
    [subs]
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [meetingTopic, setMeetingTopic] = useState("");

  const isEditChanged = useMemo(() => {
    if (editId === null) return false;
    return !sameString(meetingTopic, origTopic)
      || !sameArray(selectedMembers, origMembers)
      || !sameString(meetingTime, origTime)
      || !sameString(meetingLink, origLink);
  }, [editId, meetingTopic, selectedMembers, meetingTime, meetingLink, origTopic, origMembers, origTime, origLink]);

  // Поиск по подчинённым
  const filteredSubordinates = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return subordinateOptions;
    return subordinateOptions.filter(
      (o) =>
        o.value.toLowerCase().includes(q) || // по tg-username
        o.raw.fullname.toLowerCase().includes(q) // по ФИО
    );
  }, [searchTerm, subordinateOptions]);

  const handleSelectMember = (name: string) => {
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]
    );
  };

  // // Для отображения подписей выбранных участников
  // const selectedLabels = useMemo(
  //   () =>
  //     selectedMembers.map(
  //       (u) => subordinateOptions.find((o) => o.value === u)?.label || u
  //     ),
  //   [selectedMembers, subordinateOptions]
  // );


  // helper для отправки
  async function putCreateMeeting(payload: {
    topic: string;
    members: string[];
    creator: string;
    time: string;
    link: string;
  }) {
    const r = await fetch(`${API_URL}/create_meeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text || 'Failed to create meeting'}`);
    }
    // если сервер возвращает JSON с, например, id или нормализованным time
    return r.json().catch(() => ({}));
  }

  async function putUpdateMeeting(payload: any) {
    const r = await fetch(`${API_URL}/update_meeting`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.ok !== true) {
      const text = data?.detail || `HTTP ${r.status}`;
      throw new Error(text);
    }
    return data;
  }

  const toIsoUtcFromLocal = (local: string) => {
    return local + ":00";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!meetingTopic.trim() || selectedMembers.length === 0 || !meetingTime || !meetingLink.trim()) {
      alert('Заполните все поля');
      return;
    }

    const creator = username;
    // if (!creator) {
    //   alert('Не удалось определить ник создателя');
    //   return;
    // }

    // нормализуем время в ISO, т.к. input[type="datetime-local"] отдаёт локальную строку
    const isoTime = toIsoUtcFromLocal(meetingTime);

    // если editId === null — создаём новую встречу через PUT на связующий сервер
    if (editId === null) {
      try {
        const payload = {
          topic: meetingTopic.trim(),
          members: selectedMembers,
          creator,
          time: isoTime,
          link: meetingLink.trim(),
        };

        const serverRes = await putCreateMeeting(payload);

        // возьмём id с сервера, если он вернулся, иначе сгенерируем локально как раньше
        const newId = (serverRes && serverRes.id) ? Number(serverRes.id) : Date.now();

        const newMeeting: Meeting = {
          id: newId,
          topic: payload.topic,
          members: payload.members,
          time: payload.time,
          link: payload.link,
        };

        setMeetings((prev) => [...prev, newMeeting]);
        alert('Встреча создана');
        resetForm();
        return;
      } catch (err: any) {
        alert(`Ошибка сохранения: ${err?.message || err}`);
        return;
      }
    }

    // EDIT
    if (!isEditChanged) {
      window?.Telegram?.WebApp?.showAlert?.("Нет изменений");
      return;
    }

    const payload: Record<string, any> = { id: editId };
    if (!sameString(meetingTopic, origTopic)) payload.topic = meetingTopic.trim();
    if (!sameString(meetingLink, origLink)) payload.link = meetingLink.trim();
    if (!sameString(meetingTime, origTime)) {
      payload.time = toIsoUtcFromLocal(meetingTime);
    }
    if (!sameArray(selectedMembers, origMembers)) {
      const { added, removed } = computeMembersDiff(origMembers, selectedMembers);
      if (added.length) payload.added_members = added;
      if (removed.length) payload.removed_members = removed;
    }

    try {
      await putUpdateMeeting(payload);
      // Локально обновляем
      setMeetings(prev =>
        prev.map(m =>
          m.id === editId
            ? {
              ...m,
              topic: payload.topic ?? m.topic,
              link: payload.link ?? m.link,
              time: payload.time ?? m.time,
              members: Array.isArray(payload.added_members) || Array.isArray(payload.removed_members)
                ? selectedMembers
                : m.members,
            }
            : m
        )
      );
      window?.Telegram?.WebApp?.showAlert?.("Изменения сохранены");
      resetForm();
    } catch (err: any) {
      window?.Telegram?.WebApp?.showAlert?.(err?.message || "Ошибка сохранения");
    }
  };

  const handleEdit = (meeting: Meeting) => {
    setEditId(meeting.id);
    setMeetingTopic(meeting.topic); // Подставляем тему
    setSelectedMembers(meeting.members);
    setMeetingTime(meeting.time.slice(0, 16));
    setMeetingLink(meeting.link);

    // Сохраняем «до» для сравнения
    setOrigTopic(meeting.topic);
    setOrigMembers(meeting.members);
    setOrigTime(meeting.time.slice(0, 16));
    setOrigLink(meeting.link);
  };

  const handleDelete = useCallback(async (m: Meeting) => {
    try {
      setDeletingId(m.id);

      const payload = {
        topic: m.topic,
        members: m.members,
        time: m.time,
        link: m.link,
        creator: username,
      };

      const resp = await fetch(`${API_URL}/delete_meeting?meeting_id=${m.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await resp.json();

      if (!resp.ok || data?.ok !== true) {
        throw new Error(data?.detail || 'Не удалось удалить встречу');
      }

      if (window?.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert('Встреча успешно удалена');
      }

      await fetchMeetings();
    } catch (e: any) {
      if (window?.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert(e?.message ?? 'Ошибка удаления');
      }
    } finally {
      setDeletingId(null);
    }
  }, [username, fetchMeetings]);

  const resetForm = () => {
    setEditId(null);
    setMeetingTopic("");
    setSearchTerm("");
    setSelectedMembers([]);
    setMeetingTime("");
    setMeetingLink("");
  };

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>{editId ? "Редактировать встречу" : "Назначить встречу"}</h2>

        <form onSubmit={handleSubmit}>
          <label>Тема встречи:</label>
          <input
            type="text"
            placeholder="Введите тему встречи"
            value={meetingTopic}
            onChange={(e) => setMeetingTopic(e.target.value)}
          />

          <label>Поиск по имени:</label>
          <input
            type="text"
            placeholder="Начните вводить ФИО или @ник..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {subsLoading && <div>Загрузка подчинённых…</div>}
          {subsError && <div>Ошибка: {subsError}</div>}

          {searchTerm && (
            <div className="custom-select">
              {filteredSubordinates.length > 0 ? (
                filteredSubordinates.map((o) => (
                  <div
                    key={o.value}
                    className={`option ${selectedMembers.includes(o.value) ? "selected" : ""}`}
                    onClick={() => handleSelectMember(o.value)}
                  >
                    {o.label}
                  </div>
                ))
              ) : (
                <p style={{ marginTop: 8, color: "#888" }}>Совпадений нет</p>
              )}
            </div>
          )}

          {selectedMembers.length > 0 && (
            <div className="selected-list">
              <h4>Выбранные участники:</h4>
              <ul>
                {selectedMembers.map((m) => (
                  <li key={m}>
                    {m}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedMembers((prev) => prev.filter((x) => x !== m))
                      }
                    >
                      ✖
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label>Время встречи:</label>
          <input
            type="datetime-local"
            value={meetingTime}
            onChange={(e) => setMeetingTime(e.target.value)}
          />

          <label>Ссылка на встречу:</label>
          <input
            type="url"
            placeholder="https://..."
            value={meetingLink}
            onChange={(e) => setMeetingLink(e.target.value)}
          />

          <button
            type="submit"
            className="submit-btn"
            disabled={
              editId === null
                ? (!meetingTopic.trim() || selectedMembers.length === 0 || !meetingTime || !meetingLink.trim())
                : !isEditChanged
            }
            aria-disabled={
              editId === null
                ? (!meetingTopic.trim() || selectedMembers.length === 0 || !meetingTime || !meetingLink.trim())
                : !isEditChanged
            }
            data-disabled={
              editId === null
                ? (!meetingTopic.trim() || selectedMembers.length === 0 || !meetingTime || !meetingLink.trim())
                : !isEditChanged
                  ? "true"
                  : undefined
            }
            title={
              editId === null
                ? "Заполните все поля"
                : "Нет изменений"
            }>
            {editId ? "Сохранить изменения" : "Создать встречу"}
          </button>

          {editId && (
            <button
              type="button"
              className="add-btn"
              style={{ marginTop: 10 }}
              onClick={resetForm}
            >
              Отмена редактирования
            </button>
          )}
        </form>

        <div className="meeting-list">
          <h3>Список встреч</h3>
          {meetings.length === 0 && <p>Пока нет встреч</p>}

          {meetings.map((m) => (
            <div key={m.id} className="meeting-item">
              <p>
                <strong>Тема:</strong> {m.topic}
              </p>
              <p>
                <strong>Участники:</strong> {m.members.join(", ")}
              </p>
              <p>
                <strong>Время:</strong> {m.time.slice(0, 16).replace('T', ' ')}
              </p>
              <p>
                <strong>Ссылка:</strong>{" "}
                <a href={m.link} target="_blank" rel="noreferrer">
                  {m.link}
                </a>
              </p>
              <div className="meeting-actions">
                <button onClick={() => handleEdit(m)}>✏️ Редактировать</button>
                <button
                  onClick={() => handleDelete(m)}
                  disabled={deletingId === m.id}
                  style={{ marginTop: 8 }}
                >🗑 {deletingId === m.id ? 'Удаление…' : 'Удалить'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
