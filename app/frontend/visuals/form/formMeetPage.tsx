import React, { useState, useEffect, useMemo, useCallback } from "react";
import "../styles/formPage.css";
import {
  Meeting,
  Participant,
  Subordinate,
  ScheduleDay,
  ScheduleInterval,
  getCreatorMeetingsFromCache,
  setCreatorMeetingsToCache,
  getSubordinatesFromCache,
  setSubordinatesToCache,
  addMeetingToMonthCache,
  removeMeetingFromMonthCache,
  addMeetingToCreatorCache,
  removeMeetingFromCreatorCache,
  updateMeetingInCreatorCache,
  setFreeWindowsToCache,
  getFreeWindowsCacheKey,
  setActiveFreeWindowsKey,
  subtractMeetingFromFreeWindowsCache,
  getFreeWindowsFromCache,
  getActiveFreeWindowsKey,
  hasFreeWindowsCache,
  FreeWindowsData,
  saveMeetingFormDraft,
  getMeetingFormDraft,
  clearMeetingFormDraft,
} from "../cache";

const API_URL = import.meta.env.VITE_API_URL as string;

// --- Типы для ответа сервера при конфликте ---
interface ConflictResponse {
  ok: false;
  reasons: string[];
  windows: ScheduleDay[];
  meetings: Record<number, Meeting[]>;
}

// --- Компонент диалога конфликта ---
interface ConflictDialogProps {
  visible: boolean;
  reasons: string[];
  hasFreeWindows: boolean;
  onForceCreate: () => void;
  onShowWindows: () => void;
  onClose: () => void;
  isEdit: boolean;
}

const ConflictDialog: React.FC<ConflictDialogProps> = ({
  visible,
  reasons,
  hasFreeWindows,
  onForceCreate,
  onShowWindows,
  onClose,
  isEdit,
}) => {
  if (!visible) return null;

  const reasonMessages: string[] = [];
  if (reasons.includes("schedule")) {
    reasonMessages.push("Встреча не укладывается в рабочее расписание участников");
  }
  if (reasons.includes("conflict")) {
    reasonMessages.push("Встреча пересекается с другими встречами участников");
  }

  const actionWord = isEdit ? "изменить" : "создать";
  const questionText = hasFreeWindows
    ? `Хотите ли вы все равно ${actionWord} встречу, или выбрать другое время?`
    : `Хотите ли вы все равно ${actionWord} встречу? В ближайшее время для встречи с такой продолжительностью у данных сотрудников нет свободных окон.`;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "400px",
          padding: "24px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: "16px" }}>
          {reasonMessages.map((msg, idx) => (
            <p key={idx} style={{ margin: "0 0 8px 0", color: "#333", fontSize: "15px" }}>
              {msg}
            </p>
          ))}
        </div>
        
        <p style={{ margin: "0 0 20px 0", color: "#666", fontSize: "14px" }}>
          {questionText}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            onClick={onForceCreate}
            style={{
              padding: "14px",
              background: "#007AFF",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            Создать
          </button>
          
          <button
            onClick={hasFreeWindows ? onShowWindows : onClose}
            style={{
              padding: "14px",
              background: hasFreeWindows ? "#34C759" : "#E5E5EA",
              color: hasFreeWindows ? "#fff" : "#333",
              border: "none",
              borderRadius: "10px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            {hasFreeWindows ? "Свободные окна" : "Нет"}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Хелпер для проверки наличия свободных окон нужной длительности ---
const hasFreeWindowsForDuration = (
  windows: ScheduleDay[],
  meetings: Record<number, Meeting[]>,
  durationMinutes: number
): boolean => {
  // Для каждого дня недели вычисляем свободные окна
  for (const daySchedule of windows) {
    const dayFreeWindows = computeFreeWindowsForDay(daySchedule, meetings, durationMinutes);
    if (dayFreeWindows.length > 0) {
      return true;
    }
  }
  return false;
};

// --- Хелпер для вычисления свободных окон на конкретный день ---
const computeFreeWindowsForDay = (
  daySchedule: ScheduleDay,
  allMeetings: Record<number, Meeting[]>,
  minDuration: number
): ScheduleInterval[] => {
  if (!daySchedule.intervals || daySchedule.intervals.length === 0) {
    return [];
  }

  // Собираем все встречи, попадающие на этот день недели
  const dayOfWeek = daySchedule.day;
  const meetingsOnDay: { start: number; end: number }[] = [];

  for (const meetings of Object.values(allMeetings)) {
    for (const m of meetings) {
      if (!m.time) continue;
      const meetingDate = new Date(m.time);
      // JS: 0=Sunday, 1=Monday... API: 0=Monday, 6=Sunday
      const meetingDayOfWeek = meetingDate.getDay() === 0 ? 6 : meetingDate.getDay() - 1;
      
      if (meetingDayOfWeek === dayOfWeek) {
        const startMinutes = meetingDate.getHours() * 60 + meetingDate.getMinutes();
        const duration = m.duration || 40;
        meetingsOnDay.push({
          start: startMinutes,
          end: startMinutes + duration,
        });
      }
    }
  }

  // Сортируем встречи по времени начала
  meetingsOnDay.sort((a, b) => a.start - b.start);

  // Вычисляем свободные промежутки
  const freeWindows: ScheduleInterval[] = [];
  
  for (const interval of daySchedule.intervals) {
    const [startH, startM] = interval.start.split(":").map(Number);
    const [endH, endM] = interval.end.split(":").map(Number);
    const intervalStart = startH * 60 + startM;
    const intervalEnd = endH * 60 + endM;

    // Вычитаем встречи из этого интервала
    let currentStart = intervalStart;
    
    for (const meeting of meetingsOnDay) {
      if (meeting.end <= currentStart || meeting.start >= intervalEnd) {
        continue; // Встреча не пересекается с текущим интервалом
      }
      
      if (meeting.start > currentStart) {
        // Есть свободное окно до встречи
        const windowDuration = meeting.start - currentStart;
        if (windowDuration >= minDuration) {
          freeWindows.push({
            start: `${Math.floor(currentStart / 60).toString().padStart(2, "0")}:${(currentStart % 60).toString().padStart(2, "0")}`,
            end: `${Math.floor(meeting.start / 60).toString().padStart(2, "0")}:${(meeting.start % 60).toString().padStart(2, "0")}`,
          });
        }
      }
      currentStart = Math.max(currentStart, meeting.end);
    }

    // Проверяем окно после последней встречи
    if (currentStart < intervalEnd) {
      const windowDuration = intervalEnd - currentStart;
      if (windowDuration >= minDuration) {
        freeWindows.push({
          start: `${Math.floor(currentStart / 60).toString().padStart(2, "0")}:${(currentStart % 60).toString().padStart(2, "0")}`,
          end: `${Math.floor(intervalEnd / 60).toString().padStart(2, "0")}:${(intervalEnd % 60).toString().padStart(2, "0")}`,
        });
      }
    }
  }

  return freeWindows;
};

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

  // Состояния для диалога конфликта
  const [conflictDialogVisible, setConflictDialogVisible] = useState(false);
  const [conflictReasons, setConflictReasons] = useState<string[]>([]);
  const [conflictWindows, setConflictWindows] = useState<ScheduleDay[]>([]);
  const [conflictMeetings, setConflictMeetings] = useState<Record<number, Meeting[]>>({});
  const [conflictHasFreeWindows, setConflictHasFreeWindows] = useState(false);
  
  // Состояние для режима свободных окон (при возврате с календаря)
  const [selectedWindowInfo, setSelectedWindowInfo] = useState<{start: string; end: string} | null>(null);
  const [selectedWindowDate, setSelectedWindowDate] = useState<string | null>(null);
  const [inFreeWindowsMode, setInFreeWindowsMode] = useState(false); // Флаг режима свободных окон
  
  // Хелпер для преобразования минут в строку времени
  const minutesToTime = (minutes: number): string => {
    return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
  };

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

  const fetchMeetings = useCallback(async (creatorId: number, forceRefresh = false) => {
    // Проверяем кэш (если не форсированное обновление)
    if (!forceRefresh) {
      const cached = getCreatorMeetingsFromCache(creatorId);
      if (cached) {
        setMeetings(cached);
        return;
      }
    }

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
      const meetingsData = Array.isArray(data.meetings) ? data.meetings : [];
      setMeetings(meetingsData);
      // Сохраняем в кэш
      setCreatorMeetingsToCache(creatorId, meetingsData);
    } catch (e: any) {
      setError(e?.message || "Ошибка загрузки встреч");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Сначала проверяем кэш
    const cachedData = getSubordinatesFromCache(username);
    if (cachedData) {
      setSubs(cachedData.subordinates);
      setManagerId(cachedData.managerId);
      // Загружаем встречи (из кэша или с сервера)
      fetchMeetings(cachedData.managerId);
      return;
    }

    // Кэша нет — загружаем с сервера
    setSubsLoading(true);
    fetch(`${API_URL}/get_subordinates?username=${encodeURIComponent(username)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const subordinates = json.subordinates ?? [];
        const mgrId = json.manager_id ?? null;
        
        setSubs(subordinates);
        setManagerId(mgrId);
        
        // Сохраняем в кэш
        if (mgrId) {
          setSubordinatesToCache(username, mgrId, subordinates);
          // Загружаем встречи
          fetchMeetings(mgrId);
        }
      })
      .catch((e) => setSubsError(e.message))
      .finally(() => setSubsLoading(false));
  }, [username, fetchMeetings]);

  // Обработка возврата с календаря с выбранным окном или черновиком
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      
      // Восстановление черновика формы при возврате из календаря
      if (hash.includes("#/meetings") && hash.includes("restoreFormDraft=1")) {
        const draft = getMeetingFormDraft();
        if (draft) {
          setMeetingTopic(draft.topic);
          setSelectedMemberIds(draft.memberIds);
          setMeetingTime(draft.time);
          setMeetingDuration(draft.duration);
          setMeetingLink(draft.link);
          
          if (draft.editId != null) {
            setEditId(draft.editId);
            setOrigTopic(draft.origTopic ?? "");
            setOrigMemberIds(draft.origMemberIds ?? []);
            setOrigTime(draft.origTime ?? "");
            setOrigDuration(draft.origDuration ?? "");
            setOrigLink(draft.origLink ?? "");
          }
          
          clearMeetingFormDraft();
        }
        // Очищаем URL от параметра
        window.location.hash = "#/meetings";
        return;
      }
      
      // Восстановление из freeWindowsCache (без выбора окна - просто возврат по кнопке "Встречи")
      if (hash.includes("#/meetings") && hash.includes("restoreKey=") && !hash.includes("windowStart=")) {
        const params = new URLSearchParams(hash.split("?")[1] || "");
        const restoreKey = params.get("restoreKey");
        
        if (restoreKey) {
          import("../cache").then(({ getFreeWindowsByKey }) => {
            const cached = getFreeWindowsByKey(restoreKey);
            if (cached?.meetingDraft) {
              const draft = cached.meetingDraft;
              setMeetingTopic(draft.topic);
              setSelectedMemberIds(draft.memberIds);
              setMeetingDuration(String(draft.duration));
              setMeetingLink(draft.link);
              // Восстанавливаем введённое время (если было)
              if (draft.time) {
                setMeetingTime(draft.time);
              }
              
              if (draft.editId != null) {
                setEditId(draft.editId);
                setOrigTopic(draft.origTopic ?? draft.topic);
                setOrigMemberIds(draft.origMemberIds ?? draft.memberIds);
                setOrigDuration(draft.origDuration ?? String(draft.duration));
                setOrigLink(draft.origLink ?? draft.link);
                setOrigTime(draft.origTime ?? "");
              }
              
              // Устанавливаем режим свободных окон
              setInFreeWindowsMode(true);
            }
          });
        }
        
        window.location.hash = "#/meetings";
        return;
      }
      
      // Обработка выбора свободного окна
      if (hash.includes("#/meetings") && hash.includes("windowStart=")) {
        const params = new URLSearchParams(hash.split("?")[1] || "");
        const windowStart = params.get("windowStart");
        const windowEnd = params.get("windowEnd");
        const restoreKey = params.get("restoreKey");
        const selectedTime = params.get("selectedTime");
        
        if (windowStart && windowEnd) {
          setSelectedWindowInfo({ start: windowStart, end: windowEnd });
          setInFreeWindowsMode(true);
        }
        
        // Восстанавливаем черновик встречи из кэша
        if (restoreKey) {
          import("../cache").then(({ getFreeWindowsByKey }) => {
            const cached = getFreeWindowsByKey(restoreKey);
            if (cached?.meetingDraft) {
              const draft = cached.meetingDraft;
              setMeetingTopic(draft.topic);
              setSelectedMemberIds(draft.memberIds);
              setMeetingDuration(String(draft.duration));
              setMeetingLink(draft.link);
              
              // Восстанавливаем editId если это было редактирование
              if (draft.editId != null) {
                setEditId(draft.editId);
                // Восстанавливаем ОРИГИНАЛЬНЫЕ значения из сохранённых данных
                setOrigTopic(draft.origTopic ?? draft.topic);
                setOrigMemberIds(draft.origMemberIds ?? draft.memberIds);
                setOrigDuration(draft.origDuration ?? String(draft.duration));
                setOrigLink(draft.origLink ?? draft.link);
                setOrigTime(draft.origTime ?? "");
              }
              
              // Устанавливаем время начала из выбранного окна
              if (selectedTime) {
                const parsedDate = new Date(selectedTime);
                const dateStr = parsedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
                setSelectedWindowDate(dateStr);
                setMeetingTime(selectedTime);
              }
            }
          });
        }
        
        // Очищаем URL от параметров окна
        window.location.hash = "#/meetings";
      }
    };
    
    // Проверяем сразу при загрузке
    handleHashChange();
    
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

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

  // Хелпер для преобразования времени в минуты
  const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };

  // Обновляем дату окна при изменении времени встречи (в режиме окон)
  useEffect(() => {
    if ((selectedWindowInfo || inFreeWindowsMode) && meetingTime) {
      const parsedDate = new Date(meetingTime);
      if (!isNaN(parsedDate.getTime())) {
        const dateStr = parsedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        setSelectedWindowDate(dateStr);
      }
    }
  }, [meetingTime, selectedWindowInfo, inFreeWindowsMode]);

  // Проверка попадания в свободное окно (в режиме окон)
  const windowValidation = useMemo(() => {
    type ValidationResult = {
      valid: boolean;
      message: string;
      newWindow: { start: string; end: string } | null;
      fittingWindow: { start: string; end: string } | null;
    };
    
    const emptyResult: ValidationResult = { valid: true, message: "", newWindow: null, fittingWindow: null };
    
    // Работаем если есть selectedWindowInfo ИЛИ активен режим окон
    if (!selectedWindowInfo && !inFreeWindowsMode) {
      return emptyResult;
    }
    
    // Получаем кэш окон для текущих участников
    const cachedData = getFreeWindowsFromCache(selectedMemberIds);
    if (!cachedData) return emptyResult;
    
    const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : 0;
    if (!meetingTime || !durationNum) return emptyResult;
    
    // Парсим время встречи
    const meetingDate = new Date(meetingTime);
    if (isNaN(meetingDate.getTime())) return emptyResult;
    
    const meetingStartMinutes = meetingDate.getHours() * 60 + meetingDate.getMinutes();
    const meetingEndMinutes = meetingStartMinutes + durationNum;
    
    // Получаем день недели (API: 0=Пн, 6=Вс; JS: 0=Вс, 1=Пн)
    const jsDay = meetingDate.getDay();
    const apiDay = jsDay === 0 ? 6 : jsDay - 1;
    
    // Находим расписание для этого дня
    const daySchedule = cachedData.windows.find(s => s.day === apiDay);
    if (!daySchedule || daySchedule.intervals.length === 0) {
      return { valid: false, message: "Нет рабочего расписания на выбранный день", newWindow: null, fittingWindow: null };
    }
    
    // ID встречи для исключения (при редактировании)
    const excludeId = cachedData.excludeMeetingId;
    
    // Получаем встречи на этот день (исключаем редактируемую встречу)
    const dateKey = `${meetingDate.getFullYear()}-${String(meetingDate.getMonth() + 1).padStart(2, "0")}-${String(meetingDate.getDate()).padStart(2, "0")}`;
    const dayMeetings: { start: number; end: number }[] = [];
    for (const meetings of Object.values(cachedData.meetings)) {
      for (const m of meetings) {
        if (!m.time) continue;
        // Исключаем редактируемую встречу из занятых слотов
        if (excludeId != null && m.id === excludeId) continue;
        
        const mDate = new Date(m.time);
        const mDateKey = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, "0")}-${String(mDate.getDate()).padStart(2, "0")}`;
        if (mDateKey === dateKey) {
          const mStart = mDate.getHours() * 60 + mDate.getMinutes();
          dayMeetings.push({ start: mStart, end: mStart + (m.duration || 40) });
        }
      }
    }
    dayMeetings.sort((a, b) => a.start - b.start);
    
    // Вычисляем свободные окна
    let freeSlots: { start: number; end: number }[] = [];
    for (const interval of daySchedule.intervals) {
      const [startH, startM] = interval.start.split(":").map(Number);
      const [endH, endM] = interval.end.split(":").map(Number);
      const intervalStart = startH * 60 + startM;
      const intervalEnd = endH * 60 + endM;
      
      let currentStart = intervalStart;
      for (const busy of dayMeetings) {
        if (busy.end <= currentStart || busy.start >= intervalEnd) continue;
        if (busy.start > currentStart) {
          freeSlots.push({ start: currentStart, end: busy.start });
        }
        currentStart = Math.max(currentStart, busy.end);
      }
      if (currentStart < intervalEnd) {
        freeSlots.push({ start: currentStart, end: intervalEnd });
      }
    }
    
    // Фильтрация по текущему времени: окна не раньше текущей минуты + 1
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
    
    // Прошлые дни — нет свободных окон
    if (targetDay < today) {
      return { valid: false, message: "Дата и время встречи должны быть не ранее текущего момента", newWindow: null, fittingWindow: null };
    }
    
    // Сегодня — фильтруем по текущему времени
    const currentMinutes = now.getHours() * 60 + now.getMinutes() + 1;
    if (targetDay.getTime() === today.getTime()) {
      // Проверяем, не в прошлом ли выбранное время встречи
      if (meetingStartMinutes < currentMinutes) {
        return { valid: false, message: "Дата и время встречи должны быть не ранее текущего момента", newWindow: null, fittingWindow: null };
      }
      
      freeSlots = freeSlots
        .filter(slot => slot.end > currentMinutes) // Исключаем окна, которые уже закончились
        .map(slot => {
          if (slot.start >= currentMinutes) {
            return slot; // Окно полностью в будущем
          }
          // Обрезаем окно: начало переносим на currentMinutes
          return { ...slot, start: currentMinutes };
        })
        .filter(slot => (slot.end - slot.start) >= durationNum); // Проверяем длительность после обрезки
    }
    
    // Проверяем, попадает ли встреча в одно из свободных окон
    const fittingSlot = freeSlots.find(slot => 
      meetingStartMinutes >= slot.start && meetingEndMinutes <= slot.end
    );
    
    if (!fittingSlot) {
      return { valid: false, message: "Выбранное время не попадает в свободное окно", newWindow: null, fittingWindow: null };
    }
    
    // Формируем окно, в которое попадает время
    const fittingWindow = {
      start: minutesToTime(fittingSlot.start),
      end: minutesToTime(fittingSlot.end)
    };
    
    // Если selectedWindowInfo задан, проверяем, это исходное окно или другое
    if (selectedWindowInfo) {
      const originalStart = timeToMinutes(selectedWindowInfo.start);
      const originalEnd = timeToMinutes(selectedWindowInfo.end);
      
      if (fittingSlot.start === originalStart && fittingSlot.end === originalEnd) {
        return { valid: true, message: "", newWindow: null, fittingWindow };
      }
      
      // Попали в другое окно
      return { valid: true, message: "", newWindow: fittingWindow, fittingWindow };
    }
    
    // Режим без selectedWindowInfo — просто возвращаем найденное окно
    return { valid: true, message: "", newWindow: null, fittingWindow };
  }, [selectedWindowInfo, inFreeWindowsMode, selectedMemberIds, meetingTime, meetingDuration]);

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
    const newMemberIds = selectedMemberIds.includes(id)
      ? selectedMemberIds.filter((m) => m !== id)
      : [...selectedMemberIds, id];
    
    setSelectedMemberIds(newMemberIds);
    
    // При изменении участников в режиме свободных окон
    if (selectedWindowInfo || inFreeWindowsMode) {
      // Сбрасываем выбранное окно (оно было для другого набора участников)
      setSelectedWindowInfo(null);
      
      // Проверяем, есть ли кэш для нового набора участников
      if (newMemberIds.length > 0 && hasFreeWindowsCache(newMemberIds)) {
        // Переключаемся на кэш для нового набора
        const newKey = getFreeWindowsCacheKey(newMemberIds);
        setActiveFreeWindowsKey(newKey);
        // Режим остаётся активным
      } else {
        // Кэша нет — сбрасываем режим
        setInFreeWindowsMode(false);
        setActiveFreeWindowsKey(null);
      }
    }
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
    force?: boolean;
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
    if (!r.ok) {
      const text = data?.detail || `HTTP ${r.status}`;
      throw new Error(text);
    }
    // Возвращаем данные (могут содержать ok: false с reasons)
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

  // Получить participants для выбранных member_ids
  const getSelectedParticipants = (): Participant[] => {
    const result: Participant[] = [];
    for (const id of selectedMemberIds) {
      const sub = subordinateOptions.find(o => o.id === id);
      if (sub) {
        result.push({ username: sub.value, fullname: sub.raw.fullname, id });
      }
    }
    return result;
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

        // Проверяем, не вернул ли сервер ошибку валидации
        if (serverRes && serverRes.ok === false && Array.isArray(serverRes.reasons)) {
          const conflictRes = serverRes as ConflictResponse;
          const duration = durationNum || 40;
          const hasFreeWindows = hasFreeWindowsForDuration(
            conflictRes.windows || [],
            conflictRes.meetings || {},
            duration
          );
          
          // Сохраняем данные конфликта для диалога и кэша
          setConflictReasons(conflictRes.reasons);
          setConflictWindows(conflictRes.windows || []);
          setConflictMeetings(conflictRes.meetings || {});
          setConflictHasFreeWindows(hasFreeWindows);
          setConflictDialogVisible(true);
          return;
        }

        // возьмём id с сервера, если он вернулся, иначе сгенерируем локально как раньше
        const newId = (serverRes && serverRes.id) ? Number(serverRes.id) : Date.now();

        const newMeeting: Meeting = {
          id: newId,
          topic: payload.topic,
          participants: getSelectedParticipants(),
          member_ids: payload.member_ids,
          time: payload.time,
          duration: payload.duration,
          link: payload.link,
        };

        setMeetings((prev) => [...prev, newMeeting]);
        
        // Обновляем кэш
        if (managerId) {
          // Добавляем в кэш страницы встреч
          addMeetingToCreatorCache(managerId, newMeeting);
          // Добавляем в кэш календаря создателя (если месяц закэширован)
          addMeetingToMonthCache(managerId, newMeeting);
          // Кэш участников НЕ трогаем - они ещё не приняли
          // Вычитаем из кэша свободных окон
          subtractMeetingFromFreeWindowsCache(selectedMemberIds, newMeeting);
        }
        
        if (window?.Telegram?.WebApp?.showAlert) {
          window.Telegram.WebApp.showAlert('Встреча создана');
        } else {
          alert('Встреча создана');
        }
        resetForm();
        return;
      } catch (err: any) {
        const errMsg = `Ошибка сохранения: ${err?.message || err}`;
        if (window?.Telegram?.WebApp?.showAlert) {
          window.Telegram.WebApp.showAlert(errMsg);
        } else {
          alert(errMsg);
        }
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
      const updateRes = await putUpdateMeeting(payload);
      
      // Проверяем, не вернул ли сервер ошибку валидации
      if (updateRes && updateRes.ok === false && Array.isArray(updateRes.reasons)) {
        const conflictRes = updateRes as ConflictResponse;
        const duration = durationNum || (origDuration ? parseInt(origDuration, 10) : 40);
        const hasFreeWindows = hasFreeWindowsForDuration(
          conflictRes.windows || [],
          conflictRes.meetings || {},
          duration
        );
        
        // Сохраняем данные конфликта для диалога и кэша
        setConflictReasons(conflictRes.reasons);
        setConflictWindows(conflictRes.windows || []);
        setConflictMeetings(conflictRes.meetings || {});
        setConflictHasFreeWindows(hasFreeWindows);
        setConflictDialogVisible(true);
        return;
      }
      
      // Собираем обновленную встречу
      const updatedMeeting: Meeting = {
        id: editId,
        topic: payload.topic ?? origTopic,
        link: payload.link ?? origLink,
        time: payload.time ?? origTime,
        duration: payload.duration !== undefined ? payload.duration : (origDuration ? parseInt(origDuration, 10) : null),
        participants: Array.isArray(payload.added_member_ids) || Array.isArray(payload.removed_member_ids)
          ? getSelectedParticipants()
          : getSelectedParticipants(), // используем текущих участников
        member_ids: selectedMemberIds,
      };

      // Локально обновляем state
      setMeetings(prev =>
        prev.map(m => m.id === editId ? updatedMeeting : m)
      );
      
      // Обновляем кэш календаря
      if (managerId) {
        // Удаляем старую встречу у всех участников (старых и новых) + создателя
        const allAffectedIds = [...new Set([...origMemberIds, ...selectedMemberIds, managerId])];
        allAffectedIds.forEach(id => {
          removeMeetingFromMonthCache(id, editId, origTime);
        });
        
        // Добавляем новую встречу только создателю (если месяц закэширован)
        addMeetingToMonthCache(managerId, updatedMeeting);
        
        // Обновляем в кэше страницы встреч
        updateMeetingInCreatorCache(managerId, editId, updatedMeeting);
        
        // Вычитаем из кэша свободных окон
        subtractMeetingFromFreeWindowsCache(selectedMemberIds, updatedMeeting);
      }
      
      if (window?.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert("Изменения сохранены");
      } else {
        alert("Изменения сохранены");
      }
      resetForm();
    } catch (err: any) {
      const errMsg = err?.message || "Ошибка сохранения";
      if (window?.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert(errMsg);
      } else {
        alert(errMsg);
      }
    }
  };

  const handleEdit = (meeting: Meeting) => {
    setEditId(meeting.id);
    setMeetingTopic(meeting.topic); // Подставляем тему
    setSelectedMemberIds(meeting.member_ids || []);
    setMeetingTime(meeting.time.slice(0, 16));
    setMeetingDuration(meeting.duration != null ? String(meeting.duration) : "");
    setMeetingLink(meeting.link);

    // Сохраняем «до» для сравнения
    setOrigTopic(meeting.topic);
    setOrigMemberIds(meeting.member_ids || []);
    setOrigTime(meeting.time.slice(0, 16));
    setOrigDuration(meeting.duration != null ? String(meeting.duration) : "");
    setOrigLink(meeting.link);
    
    // Проверяем режим свободных окон
    const memberIdsForEdit = meeting.member_ids || [];
    if (memberIdsForEdit.length > 0 && hasFreeWindowsCache(memberIdsForEdit)) {
      // Есть кэш для этих участников — переключаемся в режим окон
      const cacheKey = getFreeWindowsCacheKey(memberIdsForEdit);
      setActiveFreeWindowsKey(cacheKey);
      setInFreeWindowsMode(true);
      setSelectedWindowInfo(null);
      
      // Обновляем excludeMeetingId и meetingDraft в кэше
      const cached = getFreeWindowsFromCache(memberIdsForEdit);
      if (cached) {
        setFreeWindowsToCache(memberIdsForEdit, {
          ...cached,
          excludeMeetingId: meeting.id,
          meetingDraft: {
            ...cached.meetingDraft,
            editId: meeting.id,
            origTopic: meeting.topic,
            origMemberIds: meeting.member_ids || [],
            origTime: meeting.time.slice(0, 16),
            origDuration: meeting.duration != null ? String(meeting.duration) : "",
            origLink: meeting.link,
          },
        });
      }
    } else {
      // Кэша нет — выключаем режим окон
      setInFreeWindowsMode(false);
      setSelectedWindowInfo(null);
      setActiveFreeWindowsKey(null);
    }
  };

  const handleDelete = useCallback(async (m: Meeting) => {
    try {
      setDeletingId(m.id);

      const payload = {
        creator: username,
        topic: m.topic,
        participants: m.participants,
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

      // Обновляем кэш: удаляем встречу у всех участников + создателя
      if (managerId) {
        // Собираем ID всех участников
        const participantIds: number[] = [];
        m.participants.forEach(p => {
          if (p.id) participantIds.push(p.id);
        });
        if (m.member_ids) {
          m.member_ids.forEach(id => {
            if (!participantIds.includes(id)) participantIds.push(id);
          });
        }
        
        // Удаляем из кэша календаря у всех участников + создателя
        const allIds = [...new Set([...participantIds, managerId])];
        allIds.forEach(id => {
          removeMeetingFromMonthCache(id, m.id, m.time);
        });
        
        // Удаляем из кэша страницы встреч
        removeMeetingFromCreatorCache(managerId, m.id);
      }
      
      // Локально обновляем state
      setMeetings(prev => prev.filter(meeting => meeting.id !== m.id));

      if (window?.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert('Встреча успешно удалена');
      }
    } catch (e: any) {
      if (window?.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert(e?.message ?? 'Ошибка удаления');
      }
    } finally {
      setDeletingId(null);
    }
  }, [managerId, username]);

  const resetForm = () => {
    setEditId(null);
    setMeetingTopic("");
    setSearchTerm("");
    setSelectedMemberIds([]);
    setMeetingTime("");
    setMeetingDuration("");
    setMeetingLink("");
    setSelectedWindowInfo(null);
    setSelectedWindowDate(null);
    setInFreeWindowsMode(false);
  };

  const handleGoToCalendar = () => {
    // Проверяем, есть ли активный режим свободных окон (глобально или локально)
    const activeKey = getActiveFreeWindowsKey();
    const isInFreeWindowsMode = activeKey || inFreeWindowsMode || selectedWindowInfo;
    
    if (isInFreeWindowsMode && selectedMemberIds.length > 0) {
      // Определяем ключ кэша (либо активный, либо генерируем из участников)
      const cacheKey = activeKey || getFreeWindowsCacheKey(selectedMemberIds);
      
      // Обновляем данные в freeWindowsCache перед возвратом в режим свободных окон
      const cached = getFreeWindowsFromCache(selectedMemberIds);
      if (cached) {
        const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : 40;
        const updatedData: FreeWindowsData = {
          ...cached,
          meetingDraft: {
            ...cached.meetingDraft,
            topic: meetingTopic.trim(),
            memberIds: selectedMemberIds,
            duration: durationNum,
            link: meetingLink.trim(),
            time: meetingTime,
            editId: editId,
            origTopic: editId ? origTopic : undefined,
            origMemberIds: editId ? origMemberIds : undefined,
            origTime: editId ? origTime : undefined,
            origDuration: editId ? origDuration : undefined,
            origLink: editId ? origLink : undefined,
          },
        };
        setFreeWindowsToCache(selectedMemberIds, updatedData);
      }
      
      // Устанавливаем активный ключ (если был сброшен)
      setActiveFreeWindowsKey(cacheKey);
      
      // Переходим в режим свободных окон
      const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : 40;
      window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
    } else {
      // Обычный переход — сохраняем черновик формы
      saveMeetingFormDraft({
        topic: meetingTopic,
        memberIds: selectedMemberIds,
        time: meetingTime,
        duration: meetingDuration,
        link: meetingLink,
        editId,
        origTopic: editId ? origTopic : undefined,
        origMemberIds: editId ? origMemberIds : undefined,
        origTime: editId ? origTime : undefined,
        origDuration: editId ? origDuration : undefined,
        origLink: editId ? origLink : undefined,
      });
      window.location.hash = "#/calendar";
    }
  };

  // --- Обработчики диалога конфликта ---
  const handleCloseConflictDialog = () => {
    setConflictDialogVisible(false);
  };

  const handleForceCreate = async () => {
    setConflictDialogVisible(false);
    
    const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : null;
    const isoTime = toIsoUtcFromLocal(meetingTime);
    
    if (editId === null) {
      // Force создание новой встречи
      try {
        const payload = {
          topic: meetingTopic.trim(),
          member_ids: selectedMemberIds,
          creator_id: managerId!,
          creator_username: username,
          time: isoTime,
          duration: durationNum,
          link: meetingLink.trim(),
          force: true, // Флаг force
        };

        const serverRes = await putCreateMeeting(payload as any);

        if (serverRes && serverRes.ok === false) {
          const errMsg = "Не удалось создать встречу";
          if (window?.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert(errMsg);
          } else {
            alert(errMsg);
          }
          return;
        }

        const newId = (serverRes && serverRes.id) ? Number(serverRes.id) : Date.now();

        const newMeeting: Meeting = {
          id: newId,
          topic: payload.topic,
          participants: getSelectedParticipants(),
          member_ids: payload.member_ids,
          time: payload.time,
          duration: payload.duration,
          link: payload.link,
        };

        setMeetings((prev) => [...prev, newMeeting]);
        
        if (managerId) {
          addMeetingToCreatorCache(managerId, newMeeting);
          addMeetingToMonthCache(managerId, newMeeting);
          // Вычитаем из кэша окон
          subtractMeetingFromFreeWindowsCache(selectedMemberIds, newMeeting);
        }
        
        // Выходим из режима окон
        setSelectedWindowInfo(null);
        setActiveFreeWindowsKey(null);
        
        if (window?.Telegram?.WebApp?.showAlert) {
          window.Telegram.WebApp.showAlert('Встреча создана');
        } else {
          alert('Встреча создана');
        }
        resetForm();
      } catch (err: any) {
        const errMsg = `Ошибка сохранения: ${err?.message || err}`;
        if (window?.Telegram?.WebApp?.showAlert) {
          window.Telegram.WebApp.showAlert(errMsg);
        } else {
          alert(errMsg);
        }
      }
    } else {
      // Force редактирование встречи
      try {
        const payload: Record<string, any> = { id: editId, force: true };
        if (!sameString(meetingTopic, origTopic)) payload.topic = meetingTopic.trim();
        if (!sameString(meetingLink, origLink)) payload.link = meetingLink.trim();
        if (!sameString(meetingTime, origTime)) {
          payload.time = isoTime;
        }
        if (!sameString(meetingDuration, origDuration)) {
          payload.duration = durationNum;
        }
        if (!sameNumberArray(selectedMemberIds, origMemberIds)) {
          const { added, removed } = computeMemberIdsDiff(origMemberIds, selectedMemberIds);
          if (added.length) payload.added_member_ids = added;
          if (removed.length) payload.removed_member_ids = removed;
        }

        const updateRes = await putUpdateMeeting(payload);
        
        if (updateRes && updateRes.ok === false) {
          const errMsg = "Не удалось изменить встречу";
          if (window?.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert(errMsg);
          } else {
            alert(errMsg);
          }
          return;
        }
        
        const updatedMeeting: Meeting = {
          id: editId,
          topic: payload.topic ?? origTopic,
          link: payload.link ?? origLink,
          time: payload.time ?? origTime,
          duration: payload.duration !== undefined ? payload.duration : (origDuration ? parseInt(origDuration, 10) : null),
          participants: getSelectedParticipants(),
          member_ids: selectedMemberIds,
        };

        setMeetings(prev => prev.map(m => m.id === editId ? updatedMeeting : m));
        
        if (managerId) {
          const allAffectedIds = [...new Set([...origMemberIds, ...selectedMemberIds, managerId])];
          allAffectedIds.forEach(id => {
            removeMeetingFromMonthCache(id, editId, origTime);
          });
          addMeetingToMonthCache(managerId, updatedMeeting);
          updateMeetingInCreatorCache(managerId, editId, updatedMeeting);
          subtractMeetingFromFreeWindowsCache(selectedMemberIds, updatedMeeting);
        }
        
        // Выходим из режима окон
        setSelectedWindowInfo(null);
        setActiveFreeWindowsKey(null);
        
        if (window?.Telegram?.WebApp?.showAlert) {
          window.Telegram.WebApp.showAlert("Изменения сохранены");
        } else {
          alert("Изменения сохранены");
        }
        resetForm();
      } catch (err: any) {
        const errMsg = err?.message || "Ошибка сохранения";
        if (window?.Telegram?.WebApp?.showAlert) {
          window.Telegram.WebApp.showAlert(errMsg);
        } else {
          alert(errMsg);
        }
      }
    }
  };

  // Функция сохранения текущего состояния формы в кэш свободных окон
  const saveFormToFreeWindowsCache = () => {
    const existingData = getFreeWindowsFromCache(selectedMemberIds);
    if (!existingData) return;
    
    const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : 40;
    const updatedData: FreeWindowsData = {
      ...existingData,
      meetingDraft: {
        ...existingData.meetingDraft,
        topic: meetingTopic.trim(),
        memberIds: selectedMemberIds,
        duration: durationNum,
        link: meetingLink.trim(),
        time: meetingTime,
        editId: editId,
        origTopic: editId ? origTopic : undefined,
        origMemberIds: editId ? origMemberIds : undefined,
        origTime: editId ? origTime : undefined,
        origDuration: editId ? origDuration : undefined,
        origLink: editId ? origLink : undefined,
      },
    };
    
    setFreeWindowsToCache(selectedMemberIds, updatedData);
  };

  const handleShowFreeWindows = () => {
    setConflictDialogVisible(false);
    
    // Сохраняем данные в кэш свободных окон
    const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : 40;
    const freeWindowsData: FreeWindowsData = {
      windows: conflictWindows,
      meetings: conflictMeetings,
      meetingDraft: {
        topic: meetingTopic.trim(),
        memberIds: selectedMemberIds,
        duration: durationNum,
        link: meetingLink.trim(),
        time: meetingTime,  // Сохраняем введённое время
        creatorId: managerId!,
        creatorUsername: username,
        editId: editId,  // Сохраняем ID редактируемой встречи для восстановления
        // Сохраняем оригинальные значения для режима редактирования
        origTopic: editId ? origTopic : undefined,
        origMemberIds: editId ? origMemberIds : undefined,
        origDuration: editId ? origDuration : undefined,
        origLink: editId ? origLink : undefined,
        origTime: editId ? origTime : undefined,
      },
      excludeMeetingId: editId,  // При редактировании исключить эту встречу из расчёта окон
    };
    
    setFreeWindowsToCache(selectedMemberIds, freeWindowsData);
    
    // Устанавливаем активный ключ для календаря
    const cacheKey = getFreeWindowsCacheKey(selectedMemberIds);
    setActiveFreeWindowsKey(cacheKey);
    
    // Переходим в календарь в режиме свободных окон
    window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
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
                        onClick={() => {
                          const newMemberIds = selectedMemberIds.filter((x) => x !== id);
                          setSelectedMemberIds(newMemberIds);
                          
                          // При изменении участников в режиме свободных окон
                          if (selectedWindowInfo || inFreeWindowsMode) {
                            setSelectedWindowInfo(null);
                            
                            // Проверяем, есть ли кэш для нового набора участников
                            if (newMemberIds.length > 0 && hasFreeWindowsCache(newMemberIds)) {
                              const newKey = getFreeWindowsCacheKey(newMemberIds);
                              setActiveFreeWindowsKey(newKey);
                            } else {
                              setInFreeWindowsMode(false);
                              setActiveFreeWindowsKey(null);
                            }
                          }
                        }}
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
            placeholder="Например: 40"
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
          
          {/* Информация о режиме свободных окон */}
          {(selectedWindowInfo || inFreeWindowsMode) && (() => {
            // Зелёный только если валидно И есть подходящее окно
            const isSuccess = windowValidation.valid && windowValidation.fittingWindow;
            return (
            <div style={{
              marginTop: "8px",
              padding: "10px 12px",
              background: isSuccess ? "#E8F5E9" : "#FFEBEE",
              borderRadius: "8px",
              border: `1px solid ${isSuccess ? "#C8E6C9" : "#FFCDD2"}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ 
                color: isSuccess ? "#2E7D32" : "#C62828", 
                fontSize: "13px" 
              }}>
                {windowValidation.valid 
                  ? (windowValidation.fittingWindow 
                    ? `${selectedWindowDate}: ${windowValidation.fittingWindow.start} — ${windowValidation.fittingWindow.end}`
                    : "Укажите время встречи")
                  : windowValidation.message
                }
              </span>
              <button
                type="button"
                onClick={() => {
                  saveFormToFreeWindowsCache();
                  const cacheKey = getFreeWindowsCacheKey(selectedMemberIds);
                  setActiveFreeWindowsKey(cacheKey);
                  const durationNum = meetingDuration ? parseInt(meetingDuration, 10) : 40;
                  window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
                }}
                style={{
                  background: isSuccess ? "#4CAF50" : "#EF5350",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  fontSize: "12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                К окнам
              </button>
            </div>
          );})()}

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
                <strong>Участники:</strong> {m.participants.map(p => p.fullname || p.username).join(", ")}
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

      {/* Диалог конфликта */}
      <ConflictDialog
        visible={conflictDialogVisible}
        reasons={conflictReasons}
        hasFreeWindows={conflictHasFreeWindows}
        onForceCreate={handleForceCreate}
        onShowWindows={handleShowFreeWindows}
        onClose={handleCloseConflictDialog}
        isEdit={editId !== null}
      />
    </div>
  );
};
