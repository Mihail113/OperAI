import React, { useState, useEffect, useRef } from "react";
import "../styles/formPage.css";

const API_URL = import.meta.env.VITE_API_URL as string;

// --- Типы ---
interface Employee {
  id: string;
  name: string;
  role: string;
}

interface Event {
  id: string;
  title: string;
  description?: string;
  time: string; // HH:MM string
  duration: number; // в минутах
  type: 'personal' | 'meeting' | 'work';
}

interface Meeting {
  id: string;
  topic: string;
  time: string; // ISO string
  duration: number;
  members: string[];
}

const CURRENT_USER_NAME = "Антон"; 

type ModalViewMode = 'timeline' | 'select-type' | 'create-task';

export const FormCalPage: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<ModalViewMode>('timeline');

  // --- Данные ---
  const [personalEvents, setPersonalEvents] = useState<Record<string, Event[]>>({});
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  
  // --- Поиск ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // --- Форма ---
  const [newTask, setNewTask] = useState({ title: "", description: "", time: "09:00", duration: 60 });

  // --- Линия времени (Current Time Line) ---
  const [nowMinutes, setNowMinutes] = useState(0);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // --- Загрузка данных ---
  useEffect(() => {
    // Заглушка личных
    fetch(`${API_URL}/events?year=${year}&month=${month + 1}`)  //#MARK: Убрать вот эту ссылку, не нужно получать данные сервера, просто берем текущую дату / время
      .then(res => res.json())
      .then(data => setPersonalEvents(data))
      .catch(() => {});

    // Заглушка встреч
    setMeetings([
      { id: 'm1', topic: 'Дейли', time: '2025-11-26T10:00:00', duration: 30, members: ['Антон', 'Иван'] },
      { id: 'm2', topic: 'Ревью кода', time: '2025-11-26T14:00:00', duration: 60, members: ['Антон'] },
    ]);

    // Заглушка сотрудников
    setEmployees([
      { id: 'e1', name: 'Иван Иванов', role: 'Backend' },
      { id: 'e2', name: 'Мария Петрова', role: 'Designer' },
      { id: 'e3', name: 'Антон', role: 'iOS Dev' },
    ]);
  }, [year, month]);

  const getEventsForDay = (date: Date) => {
    const dateKey = formatDateKey(date);
    const dayEvents: Event[] = [];

    // Личные
    if (!selectedEmployee || selectedEmployee.name === CURRENT_USER_NAME) {
      if (personalEvents[dateKey]) dayEvents.push(...personalEvents[dateKey]);
    }

    // Встречи
    const targetName = selectedEmployee ? selectedEmployee.name : CURRENT_USER_NAME;
    const daysMeetings = meetings.filter(m => {
      const mDate = new Date(m.time);
      return formatDateKey(mDate) === dateKey && m.members.includes(targetName);
    });

    daysMeetings.forEach(m => {
      dayEvents.push({
        id: m.id,
        title: `📅 ${m.topic}`,
        description: "Созвон",
        time: new Date(m.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
        duration: m.duration,
        type: 'meeting'
      });
    });

    // Смена (пример)
    if (selectedEmployee?.name === 'Иван Иванов' && date.getDate() % 2 === 0) {
       dayEvents.push({ id: `w-${dateKey}`, title: 'Смена', description: 'Офис', time: '09:00', duration: 540, type: 'work' });
    }

    return dayEvents;
  };

  // --- Actions ---
  const openDay = (day: number) => {
    setSelectedDate(new Date(year, month, day));
    setModalMode('timeline');
    setShowModal(true);
  };

  const handleSaveTask = () => {
    if (!selectedDate || !newTask.title) return;
    const dateKey = formatDateKey(selectedDate);
    const event: Event = {
      id: Date.now().toString(),
      title: newTask.title,
      description: newTask.description,
      time: newTask.time,
      duration: Number(newTask.duration),
      type: 'personal'
    };
    setPersonalEvents(prev => ({ ...prev, [dateKey]: [...(prev[dateKey] || []), event] }));
    setNewTask({ title: "", description: "", time: "09:00", duration: 60 });
    setModalMode('timeline');
  };

  const handleRedirectToMeetings = () => {
    window.location.hash = "#/meetings";
  };

  // --- Рендер Timeline ---
  const renderTimeline = () => {
    if (!selectedDate) return null;
    const events = getEventsForDay(selectedDate);
    const isMyCalendar = !selectedEmployee || selectedEmployee.name === CURRENT_USER_NAME;
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

          {/* Красная линия текущего времени (только если сегодня) */}
          {isToday && (
            <div style={{
              position: 'absolute',
              top: `${(nowMinutes / 60) * HOUR_HEIGHT + 10}px`, // +10 padding-top container
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

          {/* События */}
          {events.map((ev) => {
            const startMinutes = timeToMinutes(ev.time);
            const top = (startMinutes / 60) * HOUR_HEIGHT + 10; // +10 offset
            const height = (ev.duration / 60) * HOUR_HEIGHT;
            
            // Цвета
            const bg = ev.type === 'meeting' ? '#FFF8E1' : ev.type === 'work' ? '#E0F7FA' : '#F1F8E9';
            const border = ev.type === 'meeting' ? '#FF9F1C' : ev.type === 'work' ? '#00BCD4' : '#4CAF50';
            const text = ev.type === 'meeting' ? '#E65100' : ev.type === 'work' ? '#006064' : '#1B5E20';

            return (
              <div 
                key={ev.id}
                style={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: '60px', // отступ от времени
                  right: '10px',
                  height: `${Math.max(height, 25)}px`, // минимум 25px чтобы текст влез
                  background: bg,
                  borderLeft: `4px solid ${border}`,
                  borderRadius: '4px',
                  padding: '4px 8px',
                  overflow: 'hidden',
                  fontSize: '12px',
                  zIndex: 2,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
              >
                <div style={{fontWeight: '600', color: text}}>{ev.title}</div>
                {height > 40 && (
                  <div style={{color: text, opacity: 0.8, fontSize: '11px'}}>
                    {ev.time} • {ev.duration} мин {ev.description ? `• ${ev.description}` : ''}
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
  const filteredEmployees = employees.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h2 style={{marginBottom: '20px', fontSize: '22px', fontWeight: '700'}}>{selectedEmployee ? selectedEmployee.name : "Мой календарь"}</h2>
      
      {/* Поиск */}
      <div style={{display: 'flex', gap: '10px', marginBottom: '20px', position: 'relative'}}>
        <input type="text" placeholder="🔍 Сотрудник..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onFocus={() => setIsSearchFocused(true)} 
          style={{flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid #ddd', background: '#f5f5f5', outline: 'none'}} />
        <button onClick={() => {setSelectedEmployee(null); setSearchQuery("")}} style={{background: selectedEmployee ? '#ddd' : '#40d0b0', color: selectedEmployee ? '#333' : '#fff', border: 'none', borderRadius: '10px', padding: '0 15px', fontWeight: '600'}}>Моё</button>
        
        {isSearchFocused && searchQuery && (
          <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', zIndex: 10, border: '1px solid #eee', borderRadius: '10px', maxHeight: '200px', overflow: 'auto', boxShadow: '0 4px 10px rgba(0,0,0,0.1)'}}>
            {filteredEmployees.map(e => (
              <div key={e.id} onClick={() => {setSelectedEmployee(e); setSearchQuery(e.name); setIsSearchFocused(false)}} style={{padding: '10px', borderBottom: '1px solid #eee'}}>{e.name}</div>
            ))}
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
             const isToday = new Date().toDateString() === new Date(year, month, d).toDateString();
             const evs = getEventsForDay(new Date(year, month, d));
             return (
               <div key={d} onClick={() => openDay(d)} style={{aspectRatio: '1', borderRadius: '10px', background: isToday ? '#40d0b0' : '#f5f5f5', color: isToday?'#fff':'#333', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'}}>
                 <span style={{fontWeight: '600'}}>{d}</span>
                 <div style={{display: 'flex', gap: '2px', marginTop: '3px'}}>
                   {evs.slice(0,3).map((_,idx) => <div key={idx} style={{width: '4px', height: '4px', borderRadius: '50%', background: isToday?'#fff':'#40d0b0'}}/>)}
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
    </div>
  );
};
