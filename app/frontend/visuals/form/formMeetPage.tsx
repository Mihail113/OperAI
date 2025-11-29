import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "../styles/formPage.css";
const API_URL = import.meta.env.VITE_API_URL as string;

type Meeting = {
  id: number;
  topic: string;
  members: string[];
  member_ids: number[];
  time: string;
  duration: number | null;  // продолжительность в минутах
  link: string;
};

type Subordinate = { id: number; username: string; fullname: string };

// toDo: нужно реализовать удаление встреч и редактирование встреч, а так же подтягивание всех встреч при открытии мини апп.

export const FormMeetPage: React.FC = () => {
  const [subs, setSubs] = useState<Subordinate[]>([]);
  const [managerId, setManagerId] = useState<number | null>(null);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subsError, setSubsError] = useState<string | null>(null);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Состояния для редактирования
  const [editId, setEditId] = useState<number | null>(null);
  const [origTopic, setOrigTopic] = useState<string>("");
  const [origMemberIds, setOrigMemberIds] = useState<number[]>([]);
  const [origTime, setOrigTime] = useState<string>("");
  const [origDuration, setOrigDuration] = useState<string>("");
  const [origLink, setOrigLink] = useState<string>("");

  // Хелперы сравнения без учета порядка участников
  const sameString = (a: string, b: string) => (a ?? "") === (b ?? "");
  const sameNumberArray = (a: number[], b: number[]) => {
    if (a.length !== b.length) return false;
    const A = new Set(a);
    const B = new Set(b);
    return A.difference(B).size === 0;
  };

  // Дифф участников при редактировании (по id)
  const computeMemberIdsDiff = (before: number[], after: number[]) => {
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

  const fetchMeetings = useCallback(async (creatorId: number) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `${API_URL}/get_meetings?id=${creatorId}`
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
  }, []);

  useEffect(() => {
    //if (!username) return;
    // Чтобы в БД приходил ровно один запрос (оно 2 раза монтируется)
    if (fetchedOnceRef.current) return;
    fetchedOnceRef.current = true;

    setSubsLoading(true);
    fetch(`${API_URL}/get_subordinates?username=${encodeURIComponent(username)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        setSubs(json.subordinates ?? []);
        const mgrId = json.manager_id ?? null;
        setManagerId(mgrId);
        // Загружаем встречи после получения manager_id
        if (mgrId) {
          fetchMeetings(mgrId);
        }
      })
      .catch((e) => setSubsError(e.message))
      .finally(() => setSubsLoading(false));
  }, [username, fetchMeetings]);

  // Преобразуем в удобные для селектора/поиска опции
  const subordinateOptions = useMemo(
    () =>
      subs.map((s) => ({
        id: s.id,
        value: s.username,
        label: `${s.username} — ${s.fullname}`,
        raw: s,
      })),
    [subs]
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingDuration, setMeetingDuration] = useState("");  // продолжительность в минутах
  const [meetingLink, setMeetingLink] = useState("");
  const [meetingTopic, setMeetingTopic] = useState("");

  const isEditChanged = useMemo(() => {
    if (editId === null) return false;
    return !sameString(meetingTopic, origTopic)
      || !sameNumberArray(selectedMemberIds, origMemberIds)
      || !sameString(meetingTime, origTime)
      || !sameString(meetingDuration, origDuration)
      || !sameString(meetingLink, origLink);
  }, [editId, meetingTopic, selectedMemberIds, meetingTime, meetingDuration, meetingLink, origTopic, origMemberIds, origTime, origDuration, origLink]);

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

  const handleSelectMember = (id: number) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  // helper для отправки
  async function putCreateMeeting(payload: {
    topic: string;
    member_ids: number[];
    creator_id: number;
    creator_username: string;
    time: string;
    duration: number | null;
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

  const parseLocalDateTime = (local: string) => {
    if (!local) return null;
    const parsed = new Date(local);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const toIsoUtcFromLocal = (local: string) => {
    return local + ":00";
  };

  // Получить usernames для выбранных member_ids
  const getSelectedUsernames = () => {
    return selectedMemberIds
      .map(id => subordinateOptions.find(o => o.id === id)?.value)
      .filter((u): u is string => !!u);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!meetingTopic.trim() || selectedMemberIds.length === 0 || !meetingTime || !meetingLink.trim()) {
      alert('Заполните все поля');
      return;
    }

    const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : null;
    if (meetingDuration && (isNaN(durationNum as number) || (durationNum as number) <= 0)) {
      alert('Введите продолжительность встречи в минутах');
      return;
    }
    // Проверка на целое число
    if (meetingDuration && !Number.isInteger(Number(meetingDuration))) {
      alert('Введите целое число');
      return;
    }

    if (!managerId) {
      alert('Не удалось определить id создателя');
      return;
    }

    const meetingDate = parseLocalDateTime(meetingTime);
    if (!meetingDate) {
      alert('Некорректные дата и время встречи');
      return;
    }
    if (meetingDate.getTime() < Date.now()) {
      alert('Дата и время встречи должны быть не ранее текущего момента');
      return;
    }
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
          member_ids: selectedMemberIds,
          creator_id: managerId,
          creator_username: username,
          time: isoTime,
          duration: durationNum,
          link: meetingLink.trim(),
        };

        const serverRes = await putCreateMeeting(payload);

        // возьмём id с сервера, если он вернулся, иначе сгенерируем локально как раньше
        const newId = (serverRes && serverRes.id) ? Number(serverRes.id) : Date.now();

        const newMeeting: Meeting = {
          id: newId,
          topic: payload.topic,
          members: getSelectedUsernames(),
          member_ids: payload.member_ids,
          time: payload.time,
          duration: payload.duration,
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
    if (!sameString(meetingDuration, origDuration)) {
      payload.duration = durationNum;
    }
    if (!sameNumberArray(selectedMemberIds, origMemberIds)) {
      const { added, removed } = computeMemberIdsDiff(origMemberIds, selectedMemberIds);
      if (added.length) payload.added_member_ids = added;
      if (removed.length) payload.removed_member_ids = removed;
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
              duration: payload.duration !== undefined ? payload.duration : m.duration,
              members: Array.isArray(payload.added_member_ids) || Array.isArray(payload.removed_member_ids)
                ? getSelectedUsernames()
                : m.members,
              member_ids: Array.isArray(payload.added_member_ids) || Array.isArray(payload.removed_member_ids)
                ? selectedMemberIds
                : m.member_ids,
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
    setSelectedMemberIds(meeting.member_ids);
    setMeetingTime(meeting.time.slice(0, 16));
    setMeetingDuration(meeting.duration != null ? String(meeting.duration) : "");
    setMeetingLink(meeting.link);

    // Сохраняем «до» для сравнения
    setOrigTopic(meeting.topic);
    setOrigMemberIds(meeting.member_ids);
    setOrigTime(meeting.time.slice(0, 16));
    setOrigDuration(meeting.duration != null ? String(meeting.duration) : "");
    setOrigLink(meeting.link);
  };

  const handleDelete = useCallback(async (m: Meeting) => {
    try {
      setDeletingId(m.id);

      const payload = {
        creator: username,
        topic: m.topic,
        members: m.members,
        time: m.time,
        duration: m.duration,
        link: m.link,
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

      if (managerId) {
        await fetchMeetings(managerId);
      }
    } catch (e: any) {
      if (window?.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert(e?.message ?? 'Ошибка удаления');
      }
    } finally {
      setDeletingId(null);
    }
  }, [managerId, fetchMeetings, username]);

  const resetForm = () => {
    setEditId(null);
    setMeetingTopic("");
    setSearchTerm("");
    setSelectedMemberIds([]);
    setMeetingTime("");
    setMeetingDuration("");
    setMeetingLink("");
  };

  const handleGoToCalendar = () => {
    window.location.hash = "#/calendar";
  };

  return (
    <div className="form-page">
      <div className="form-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '-15px 0 -5px 0' }}>
          <button
            type="button"
            onClick={handleGoToCalendar}
            style={{
              background: 'none',
              border: 'none',
              color: '#007AFF',
              fontSize: '14px',
              cursor: 'pointer',
              padding: 0,
              fontWeight: 500,
            }}
          >
            Календарь
          </button>
          <div style={{ width: '70px' }}></div>
        </div>
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
                    key={o.id}
                    className={`option ${selectedMemberIds.includes(o.id) ? "selected" : ""}`}
                    onClick={() => handleSelectMember(o.id)}
                  >
                    {o.label}
                  </div>
                ))
              ) : (
                <p style={{ marginTop: 8, color: "#888" }}>Совпадений нет</p>
              )}
            </div>
          )}

          {selectedMemberIds.length > 0 && (
            <div className="selected-list">
              <h4>Выбранные участники:</h4>
              <ul>
                {selectedMemberIds.map((id) => {
                  const sub = subordinateOptions.find(o => o.id === id);
                  return (
                    <li key={id}>
                      {sub ? sub.label : `ID: ${id}`}{" "}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedMemberIds((prev) => prev.filter((x) => x !== id))
                        }
                      >
                        ✖
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <label>Время встречи:</label>
          <input
            type="datetime-local"
            value={meetingTime}
            onChange={(e) => setMeetingTime(e.target.value)}
          />

          <label>Продолжительность встречи (мин.):</label>
          <input
            type="number"
            placeholder="Например: 60"
            min="1"
            step="1"
            value={meetingDuration}
            onChange={(e) => setMeetingDuration(e.target.value)}
            onInvalid={(e) => {
              const input = e.target as HTMLInputElement;
              if (input.validity.stepMismatch) {
                input.setCustomValidity("Введите целое число");
              } else {
                input.setCustomValidity("");
              }
            }}
            onInput={(e) => {
              (e.target as HTMLInputElement).setCustomValidity("");
            }}
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
              !meetingTopic.trim() || selectedMemberIds.length === 0 || !meetingTime || !meetingDuration.trim() || !meetingLink.trim() || (editId !== null && !isEditChanged)
            }
            aria-disabled={
              !meetingTopic.trim() || selectedMemberIds.length === 0 || !meetingTime || !meetingDuration.trim() || !meetingLink.trim() || (editId !== null && !isEditChanged)
            }
            data-disabled={
              (!meetingTopic.trim() || selectedMemberIds.length === 0 || !meetingTime || !meetingDuration.trim() || !meetingLink.trim() || (editId !== null && !isEditChanged))
                ? "true"
                : undefined
            }
            title={
              (!meetingTopic.trim() || selectedMemberIds.length === 0 || !meetingTime || !meetingDuration.trim() || !meetingLink.trim())
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
                <strong>Продолжительность:</strong> {m.duration != null ? `${m.duration} мин.` : '-'}
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
