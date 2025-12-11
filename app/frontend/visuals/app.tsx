import React, { useEffect, useState } from "react";
import { FormDirPage } from "./form/formDirPage";
import { FormEmpPage } from "./form/formEmpPage";
import { FormBossPage } from "./form/formBossPage";
import { FormMeetPage } from "./form/formMeetPage";
import { FormCalPage } from "./form/formCalPage";
import { ReportFormDirPage } from "./form/reportFormDirPage";
import { ReportSubmitPage } from "./form/reportSubmitPage";

const App: React.FC = () => {
  // Всегда стартуем со стартовой страницы
  const [path, setPath] = useState("/");

  // Список допустимых маршрутов (включи сюда новые страницы)
  const allowedPaths = ["/", "/form1", "/form2", "/form3", "/form4", "/meetings", "/calendar", "/report_form", "/report_submit"];

  useEffect(() => {
    const getInitialPath = () => {
      // 1) приоритет: ?route=...
      const qs = new URLSearchParams(window.location.search);
      const route = qs.get("route");
      if (route && allowedPaths.includes(`/${route}`)) return `/${route}`;

      // 2) fallback: стартовый параметр из Telegram (если запускали через startapp)
      const lp = new URLSearchParams(window.location.hash.slice(1));
      const startParam = lp.get("tgWebAppStartParam");
      if (startParam && allowedPaths.includes(`/${startParam}`)) return `/${startParam}`;

      // 3) по умолчанию
      return "/";
    };

    const initial = getInitialPath();
    setPath(initial);

    // Если хотите поддержать локальную навигацию по hash-кнопкам вне Telegram:
    const onHash = () => {
      // Не очищаем hash — там могут быть данные Telegram
      const rawHash = window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : "/";
      // Извлекаем путь без query параметров
      const h = rawHash.split("?")[0];
      if (allowedPaths.includes(h)) setPath(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);


  if (path === "/form1") return <FormDirPage />;
  if (path === "/form2") return <FormEmpPage />;
  if (path === "/form3") return <FormBossPage />;
  if (path === "/form4") return <FormEmpPage />;  // Редактирование профиля работника (та же форма, но без company_id в URL)
  if (path === "/meetings") return <FormMeetPage />;
  if (path === "/calendar") return <FormCalPage/>;
  if (path === "/report_form") return <ReportFormDirPage />;  // Форма отчетности для директора
  if (path === "/report_submit") return <ReportSubmitPage />;  // Отправка отчета для сотрудника

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}>
      <h1>Стартовая страница</h1>

      {/* Можно оставить кнопки — они работают. Как вариант, использовать <a href="#/meetings"> */}
      <button onClick={() => (window.location.hash = "/form1")}>Анкета 1</button>
      <button onClick={() => (window.location.hash = "/form2")}>Анкета 2</button>
      <button onClick={() => (window.location.hash = "/meetings")}>Встречи</button>
      <button onClick={() => (window.location.hash = "/calendar")}>Календарь</button>
    </div>
  );
};

export default App;
