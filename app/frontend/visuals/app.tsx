import React, { useEffect, useState } from "react";
import { FormDirPage } from "./form/formDirPage";
import { FormEmpPage } from "./form/formEmpPage";
import { FormMeetPage } from "./form/formMeetPage";
import { FormCalPage } from "./form/formCalPage";

const App: React.FC = () => {
  // Всегда стартуем со стартовой страницы
  const [path, setPath] = useState("/");

  // Список допустимых маршрутов (включи сюда новые страницы)
  const allowedPaths = ["/", "/form1", "/form2", "/meetings", "/calendar"];

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
      const h = window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : "/";
      if (allowedPaths.includes(h)) setPath(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);


  if (path === "/form1") return <FormDirPage />;
  if (path === "/form2") return <FormEmpPage />;
  if (path === "/meetings") return <FormMeetPage />;
  if (path === "/calendar") return <FormCalPage/>;

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
