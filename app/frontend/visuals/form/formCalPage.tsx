import React, { useState, useEffect, useRef } from "react";
import "../styles/formPage.css";

const API_URL = import.meta.env.VITE_API_URL as string;

// --- Типы ---
interface Employee {
  id: number;
  username: string;
  fullname: string;
}

interface ScheduleInterval {
  start: string;
  end: string;
}

interface ScheduleDay {
  day: number; // 0-6 (0=Пн, 6=Вс в API)
  intervals: ScheduleInterval[];
}

interface Participant {
  username: string;
  fullname: string;
}

interface Meeting {
  id: number;
  topic: string;
  participants: Participant[];
  member_ids?: number[]; // опционально
  time: string; // ISO string
  duration: number | null;
  link: string;
  creator_name?: string; // полное имя создателя
}


type ModalViewMode = 'timeline' | 'select-type' | 'create-task';

// Хелпер для форматирования времени окончания
const getEndTime = (startTime: string, durationMinutes: number): string => {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const FormCalPage: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<ModalViewMode>('timeline');

  // --- Данные ---
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);

  const [myUserId, setMyUserId] = useState<number | null>(null); // получение ID начальника
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [subordinates, setSubordinates] = useState<Employee[]>([]);
  
  const [isInitLoading, setIsInitLoading] = useState(true); // Первая загрузка (ID)
  const [isEventsLoading, setIsEventsLoading] = useState(false); // Загрузка встреч при смене месяца или сотрудника

  // --- Кэш ---
  // Кэш расписаний по userId
  const scheduleCache = useRef<Map<number, ScheduleDay[]>>(new Map());
  // Кэш встреч по ключу "userId-year-month"
  const meetingsCache = useRef<Map<string, Meeting[]>>(new Map());

  // --- Поиск ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // --- Форма ---
  const [newTask, setNewTask] = useState({ title: "", description: "", time: "09:00", duration: 60 });

  // --- Попап встречи ---
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  // --- Линия времени (Current Time Line) ---
  const [nowMinutes, setNowMinutes] = useState(0);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Хелпер для создания ключа кэша встреч
  const getMeetingsCacheKey = (userId: number, y: number, m: number) => `${userId}-${y}-${m}`;

  // Обновляем текущее время для красной линии
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };
    updateTime();
    const interval = setInterval(updateTime, 60000); // раз в минуту
    return () => clearInterval(interval);
  }, []);

  // Скролл к 9:00 при открытии
  useEffect(() => {
    if (showModal && modalMode === 'timeline' && scrollRef.current) {
      // 9 * 60px = 540px
      scrollRef.current.scrollTop = 500;
    }
  }, [showModal, modalMode]);


// 1. Инициализация: Получаем Username -> ID, список подчиненных и данные начальника
  useEffect(() => {
    const controller = new AbortController();
    
    const init = async () => {
      const tg = (window as any).Telegram?.WebApp;
      const user = tg?.initDataUnsafe?.user;
      const username = user?.username ? `@${user.username}` : null;
      // const username = "@riftinink"; // Для тестов локально

      if (!username) {
        setIsInitLoading(false);
        return;
      }
      setMyUsername(username);

      try {
        // 1. Получаем подчиненных и свой ID
        const res = await fetch(`${API_URL}/get_subordinates?username=${username}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to load profile");
        const data = await res.json();

        const managerId = data.manager_id;
        setMyUserId(managerId);
        setSubordinates(data.subordinates || []);

        if (!managerId) return;

        // 2. Параллельно загружаем расписание и встречи для начальника
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth();
        const meetingsCacheKey = getMeetingsCacheKey(managerId, currentYear, currentMonth + 1);

        const [scheduleData, meetingsData] = await Promise.all([
          fetch(`${API_URL}/get_schedule?id=${managerId}`, { signal: controller.signal }).then(r => r.json()),
          fetch(`${API_URL}/get_month_meetings?id=${managerId}&year=${currentYear}&month=${currentMonth + 1}`, { signal: controller.signal }).then(r => r.json())
        ]);

        // Сохраняем в кэш
        scheduleCache.current.set(managerId, scheduleData.schedule || []);
        meetingsCache.current.set(meetingsCacheKey, meetingsData.meetings || []);

        // Устанавливаем в state
        setSchedule(scheduleData.schedule || []);
        setMeetings(meetingsData.meetings || []);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error(e);
        }
      } finally {
        setIsInitLoading(false);
      }
    };

    init();
    
    return () => controller.abort();
  }, []);

  // 2. Загрузка данных при смене месяца или сотрудника (с кэшированием)
  useEffect(() => {
    // Если еще не знаем свой ID - ждем (инициализация еще не завершена)
    if (!myUserId) return;

    const targetId = selectedEmployee ? selectedEmployee.id : myUserId;
    const meetingsCacheKey = getMeetingsCacheKey(targetId, year, month + 1);

    // Проверяем кэш
    const cachedSchedule = scheduleCache.current.get(targetId);
    const cachedMeetings = meetingsCache.current.get(meetingsCacheKey);

    // Если всё есть в кэше - просто устанавливаем из кэша
    if (cachedSchedule && cachedMeetings) {
      setSchedule(cachedSchedule);
      setMeetings(cachedMeetings);
      return;
    }

    // Иначе загружаем недостающее
    const fetchMissingData = async () => {
      setIsEventsLoading(true);

      try {
        const promises: Promise<void>[] = [];

        // Расписание - загружаем только если нет в кэше
        if (!cachedSchedule) {
          promises.push(
            fetch(`${API_URL}/get_schedule?id=${targetId}`)
              .then(r => r.json())
              .then(data => {
                const scheduleData = data.schedule || [];
                scheduleCache.current.set(targetId, scheduleData);
                setSchedule(scheduleData);
              })
          );
        } else {
          setSchedule(cachedSchedule);
        }

        // Встречи - загружаем только если нет в кэше
        if (!cachedMeetings) {
          promises.push(
            fetch(`${API_URL}/get_month_meetings?id=${targetId}&year=${year}&month=${month + 1}`)
              .then(r => r.json())
              .then(data => {
                const meetingsData = data.meetings || [];
                meetingsCache.current.set(meetingsCacheKey, meetingsData);
                setMeetings(meetingsData);
              })
          );
        } else {
          setMeetings(cachedMeetings);
        }

        await Promise.all(promises);
      } catch (e) {
        console.error("Error loading events", e);
      } finally {
        setIsEventsLoading(false);
      }
    };

    fetchMissingData();
  }, [myUserId, year, month, selectedEmployee]); // Перезапуск при смене даты или сотрудника

  // --- Хелперы ---
  const getFirstDayOfMonth = (y: number, m: number) => {
    const day = new Date(y, m, 1).getDay();
    return (day + 6) % 7; 
  };

  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Перевод времени "HH:MM" в минуты от начала дня
  const timeToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  // Конвертация JS дня недели в API формат (API: 0=Пн, 6=Вс; JS: 0=Вс, 1=Пн)
  const jsToApiDay = (jsDay: number) => jsDay === 0 ? 6 : jsDay - 1;

  // Проверка: есть ли рабочее расписание в этот день
  const hasScheduleForDate = (date: Date): boolean => {
    const apiDay = jsToApiDay(date.getDay());
    const daySchedule = schedule.find(s => s.day === apiDay);
    return !!(daySchedule && daySchedule.intervals.length > 0);
  };

  // Проверка: есть ли встречи в этот день
  const hasMeetingsForDate = (date: Date): boolean => {
    const dateKey = formatDateKey(date);
    return meetings.some(m => {
      if (!m.time) return false;
      return formatDateKey(new Date(m.time)) === dateKey;
    });
  };

  // Получение рабочих интервалов для дня (для timeline)
  const getWorkIntervalsForDate = (date: Date): ScheduleInterval[] => {
    const apiDay = jsToApiDay(date.getDay());
    const daySchedule = schedule.find(s => s.day === apiDay);
    return daySchedule?.intervals || [];
  };

  // Получение встреч для дня (для timeline)
  const getMeetingsForDate = (date: Date): Meeting[] => {
    const dateKey = formatDateKey(date);
    return meetings.filter(m => {
      if (!m.time) return false;
      return formatDateKey(new Date(m.time)) === dateKey;
    });
  };

  // --- Actions ---
  const openDay = (day: number) => {
    setSelectedDate(new Date(year, month, day));
    setModalMode('timeline');
    setShowModal(true);
  };

  const handleSaveTask = () => {
    // TODO: Реализовать API для сохранения личных задач
    // Пока функция отключена - нет бэкенда для личных задач
    if (!selectedDate || !newTask.title) return;
    console.log('Создание задачи пока не поддерживается:', newTask);
    setNewTask({ title: "", description: "", time: "09:00", duration: 60 });
    setModalMode('timeline');
  };

  const handleRedirectToMeetings = () => {
    window.location.hash = "#/meetings";
  };

  // --- Рендер Timeline ---
  const renderTimeline = () => {
    if (!selectedDate) return null;
    const workIntervals = getWorkIntervalsForDate(selectedDate);
    const dayMeetings = getMeetingsForDate(selectedDate);
    const isMyCalendar = !selectedEmployee;
    const isToday = new Date().toDateString() === selectedDate.toDateString();

    // Константа высоты часа в пикселях
    const HOUR_HEIGHT = 60; 

    return (
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
        {/* Верхняя панель модалки */}
        <div style={{padding: '16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', zIndex: 10}}>
          <button onClick={() => setShowModal(false)} style={{border: 'none', background: 'none', fontSize: '16px', color: '#007AFF'}}>Закрыть</button>
          <span style={{fontWeight: '600', fontSize: '17px'}}>
            {selectedDate.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})}
          </span>
          {isMyCalendar ? (
            <button onClick={() => setModalMode('select-type')} style={{border: 'none', background: 'none', fontSize: '24px', color: '#007AFF', lineHeight: 0}}>+</button>
          ) : <div style={{width: 24}}></div>}
        </div>

        {/* Скроллируемая область таймлайна */}
        <div ref={scrollRef} style={{flex: 1, overflowY: 'auto', position: 'relative', padding: '10px 0'}}>
          
          {/* Сетка часов (00:00 - 23:00) */}
          {Array.from({length: 24}).map((_, hour) => (
            <div key={hour} style={{height: `${HOUR_HEIGHT}px`, position: 'relative', display: 'flex'}}>
              {/* Время слева */}
              <div style={{width: '50px', textAlign: 'right', paddingRight: '10px', fontSize: '12px', color: '#999', transform: 'translateY(-6px)'}}>
                {`${hour}:00`}
              </div>
              {/* Линия */}
              <div style={{flex: 1, borderTop: '1px solid #f0f0f0'}}></div>
            </div>
          ))}

          {/* Рабочие часы - серый фон (z-index: 1, под встречами) */}
          {workIntervals.map((interval, idx) => {
            const startMinutes = timeToMinutes(interval.start);
            const endMinutes = timeToMinutes(interval.end);
            const top = (startMinutes / 60) * HOUR_HEIGHT + 10;
            const height = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;

            return (
              <div 
                key={`work-${idx}`}
                style={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: '60px',
                  right: '10px',
                  height: `${height}px`,
                  background: '#E0E0E0',
                  borderRadius: '4px',
                  zIndex: 1,
                  opacity: 0.5
                }}
              />
            );
          })}

          {/* Красная линия текущего времени (только если сегодня) */}
          {isToday && (
            <div style={{
              position: 'absolute',
              top: `${(nowMinutes / 60) * HOUR_HEIGHT + 10}px`,
              left: '50px',
              right: 0,
              height: '2px',
              background: '#FF3B30',
              zIndex: 5,
              pointerEvents: 'none'
            }}>
              <div style={{
                width: '8px', height: '8px', background: '#FF3B30', borderRadius: '50%', 
                position: 'absolute', left: '-4px', top: '-3px'
              }} />
            </div>
          )}

          {/* Встречи - синие блоки (z-index: 2, над рабочими часами) */}
          {dayMeetings.map((meeting) => {
            if (!meeting.time) return null;
            const meetingDate = new Date(meeting.time);
            const startMinutes = meetingDate.getHours() * 60 + meetingDate.getMinutes();
            const top = (startMinutes / 60) * HOUR_HEIGHT + 10;
            const duration = meeting.duration || 60; // По умолчанию 60 минут
            const height = (duration / 60) * HOUR_HEIGHT;

            return (
              <div 
                key={`meeting-${meeting.id}`}
                onClick={() => setSelectedMeeting(meeting)}
                style={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: '60px',
                  right: '10px',
                  height: `${height}px`,
                  minHeight: '2px',
                  background: '#E3F2FD',
                  borderLeft: '4px solid #2196F3',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  overflow: 'hidden',
                  fontSize: '12px',
                  zIndex: 2,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  cursor: 'pointer'
                }}
              >
                <div style={{
                  fontWeight: '600', 
                  color: '#1565C0', 
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {meeting.topic}
                </div>
                {height >= 36 && (
                  <div style={{
                    color: '#1976D2', 
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {meetingDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} • {duration} мин
                  </div>
                )}
              </div>
            );
          })}

        </div>
      </div>
    );
  };

  // --- Рендер выбора типа и формы (оставляем как было, чуть упростив стили) ---
  const renderActionScreens = () => {
    if (modalMode === 'select-type') {
      return (
        <div style={{padding: '20px', height: '100%', background: '#f9f9f9'}}>
           <div style={{background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)'}}>
              <h3 style={{textAlign: 'center', marginTop: 0}}>Добавить событие</h3>
              <button onClick={() => setModalMode('create-task')} style={{width: '100%', padding: '15px', marginBottom: '10px', background: '#E8F5E9', color: '#2E7D32', border: 'none', borderRadius: '12px', fontWeight: 'bold'}}>
                📝 Задача
              </button>
              <button onClick={handleRedirectToMeetings} style={{width: '100%', padding: '15px', marginBottom: '20px', background: '#FFF3E0', color: '#EF6C00', border: 'none', borderRadius: '12px', fontWeight: 'bold'}}>
                📞 Созвон
              </button>
              <button onClick={() => setModalMode('timeline')} style={{width: '100%', padding: '12px', background: '#eee', border: 'none', borderRadius: '12px'}}>Отмена</button>
           </div>
        </div>
      );
    }
    if (modalMode === 'create-task') {
      return (
        <div style={{padding: '20px', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column'}}>
          <h3 style={{textAlign: 'center'}}>Новая задача</h3>
          <div style={{flex: 1}}>
            <input type="text" placeholder="Название" className="form-input" value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} style={{marginBottom: '15px'}} />
            <div style={{display: 'flex', gap: '10px', marginBottom: '15px'}}>
              <div style={{flex:1}}><label>Начало</label><input type="time" className="form-input" value={newTask.time} onChange={e => setNewTask({...newTask, time: e.target.value})} /></div>
              <div style={{flex:1}}><label>Мин.</label><input type="number" className="form-input" value={newTask.duration} onChange={e => setNewTask({...newTask, duration: Number(e.target.value)})} /></div>
            </div>
            <textarea placeholder="Описание" className="form-input" rows={4} value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})} />
          </div>
          <div style={{display: 'flex', gap: '10px'}}>
            <button onClick={() => setModalMode('select-type')} className="add-btn" style={{background: '#eee', color: '#333'}}>Назад</button>
            <button onClick={handleSaveTask} className="add-btn">Сохранить</button>
          </div>
        </div>
      );
    }
    return null;
  };

  // --- Основной UI ---
  const firstDayIndex = getFirstDayOfMonth(year, month);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const filteredEmployees = subordinates.filter(e => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return e.fullname.toLowerCase().includes(q) || e.username.toLowerCase().includes(q);
  });

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h2 style={{marginBottom: '20px', fontSize: '22px', fontWeight: '700'}}>{selectedEmployee ? selectedEmployee.fullname : "Мой календарь"}</h2>
      
      {/* Поиск */}
      <div style={{display: 'flex', gap: '10px', marginBottom: '20px', position: 'relative'}}>
        <div style={{flex: 1, position: 'relative'}}>
          <span style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', pointerEvents: 'none', zIndex: 1}}>🔍</span>
          <input 
            type="text" 
            placeholder="Сотрудник..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            onFocus={() => setIsSearchFocused(true)} 
            style={{width: '100%', padding: '10px 32px 10px 36px', borderRadius: '10px', border: '1px solid #ddd', background: '#f5f5f5', outline: 'none', boxSizing: 'border-box'}} 
          />
          {searchQuery && (
            <button 
              onClick={() => {setSearchQuery(""); setIsSearchFocused(false);}}
              style={{position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '16px', color: '#999', lineHeight: 1}}
            >
              ✕
            </button>
          )}
        </div>
        <button onClick={() => {setSelectedEmployee(null); setSearchQuery("")}} style={{background: selectedEmployee ? '#ddd' : '#40d0b0', color: selectedEmployee ? '#333' : '#fff', border: 'none', borderRadius: '10px', padding: '0 15px', fontWeight: '600'}}>Моё</button>
        
        {isSearchFocused && searchQuery && (
          <div style={{position: 'absolute', top: '100%', left: 0, right: 70, background: 'white', zIndex: 10, border: '1px solid #eee', borderRadius: '10px', maxHeight: '200px', overflow: 'auto', boxShadow: '0 4px 10px rgba(0,0,0,0.1)'}}>
            {filteredEmployees.length > 0 ? (
              filteredEmployees.map(e => (
                <div 
                  key={e.id} 
                  onClick={() => {setSelectedEmployee(e); setSearchQuery(`${e.username} — ${e.fullname}`); setIsSearchFocused(false)}} 
                  style={{padding: '10px', borderBottom: '1px solid #eee', cursor: 'pointer'}}
                >
                  {e.username} — {e.fullname}
                </div>
              ))
            ) : (
              <p style={{padding: '10px', color: '#888', margin: 0}}>Совпадений нет</p>
            )}
          </div>
        )}
      </div>

      {/* Календарь Сетка */}
      <div style={{background: '#fff', borderRadius: '20px', padding: '15px', boxShadow: '0 2px 15px rgba(0,0,0,0.05)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '15px', alignItems: 'center'}}>
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} style={{border: 'none', background: 'none', fontSize: '18px'}}>◀</button>
          <span style={{fontWeight: 'bold', textTransform: 'capitalize'}}>{currentDate.toLocaleDateString('ru-RU', {month: 'long', year: 'numeric'})}</span>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} style={{border: 'none', background: 'none', fontSize: '18px'}}>▶</button>
        </div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '5px'}}>
          {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <div key={d} style={{textAlign: 'center', fontSize: '12px', color: '#888', marginBottom: '5px'}}>{d}</div>)}
          {Array(firstDayIndex).fill(0).map((_,i) => <div key={`e-${i}`}/>)}
          {Array(daysInMonth).fill(0).map((_, i) => {
             const d = i + 1;
             const dayDate = new Date(year, month, d);
             const isToday = new Date().toDateString() === dayDate.toDateString();
             const hasSchedule = hasScheduleForDate(dayDate);
             const hasMeetings = hasMeetingsForDate(dayDate);
             return (
               <div key={d} onClick={() => openDay(d)} style={{aspectRatio: '1', borderRadius: '10px', background: isToday ? '#40d0b0' : '#f5f5f5', color: isToday?'#fff':'#333', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'}}>
                 <span style={{fontWeight: '600'}}>{d}</span>
                 <div style={{display: 'flex', gap: '3px', marginTop: '3px'}}>
                   {hasSchedule && <div style={{width: '5px', height: '5px', borderRadius: '50%', background: isToday ? 'rgba(255,255,255,0.7)' : '#9E9E9E'}}/>}
                   {hasMeetings && <div style={{width: '5px', height: '5px', borderRadius: '50%', background: isToday ? '#fff' : '#2196F3'}}/>}
                 </div>
               </div>
             )
          })}
        </div>
      </div>

      {/* FULLSCREEN MODAL */}
      {showModal && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#fff', zIndex: 9999, display: 'flex', flexDirection: 'column'}}>
          {modalMode === 'timeline' ? renderTimeline() : renderActionScreens()}
        </div>
      )}

      {/* MEETING DETAIL POPUP */}
      {selectedMeeting && (
        <div 
          style={{
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0, 0, 0, 0.5)', 
            zIndex: 10000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '60px 16px'
          }}
          onClick={() => setSelectedMeeting(null)}
        >
          <div 
            style={{
              background: '#fff',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '400px',
              maxHeight: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0
            }}>
              <button 
                onClick={() => setSelectedMeeting(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#999',
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1
                }}
              >
                ✕
              </button>
              <span style={{fontWeight: '600', fontSize: '17px', color: '#333'}}>Встреча</span>
            </div>

            {/* Scrollable Content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {/* Topic */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Тема</div>
                <div style={{fontSize: '16px', fontWeight: '600', color: '#333'}}>{selectedMeeting.topic}</div>
              </div>

              {/* Time */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Время</div>
                <div style={{fontSize: '15px', color: '#333'}}>
                  {selectedMeeting.time && (
                    <>
                      {new Date(selectedMeeting.time).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                      <br />
                      {new Date(selectedMeeting.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      {' — '}
                      {getEndTime(selectedMeeting.time, selectedMeeting.duration || 60)}
                      <span style={{color: '#888', marginLeft: '8px'}}>
                        ({selectedMeeting.duration || 60} мин)
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Creator */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Создатель</div>
                <div style={{fontSize: '15px', color: '#333'}}>{selectedMeeting.creator_name || '—'}</div>
              </div>

              {/* Participants */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                  Участники ({selectedMeeting.participants?.length || 0})
                </div>
                <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                  {(selectedMeeting.participants || []).map((participant, idx) => (
                    <div 
                      key={idx}
                      style={{
                        padding: '10px 12px',
                        background: '#f5f5f5',
                        borderRadius: '8px',
                        fontSize: '14px',
                        color: '#333'
                      }}
                    >
                      {participant.fullname || participant.username}
                    </div>
                  ))}
                </div>
              </div>

              {/* Link */}
              {selectedMeeting.link && (
                <div>
                  <div style={{fontSize: '12px', color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Ссылка</div>
                  <a 
                    href={selectedMeeting.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      padding: '12px 16px',
                      background: '#E3F2FD',
                      borderRadius: '10px',
                      color: '#1976D2',
                      textDecoration: 'none',
                      fontWeight: '500',
                      textAlign: 'center'
                    }}
                  >
                    Перейти к звонку
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};