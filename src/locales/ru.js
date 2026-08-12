// Русский. Ключ — английский оригинал; нет перевода — виден оригинал.
// Названия сервисов (Google Drive, Nextcloud, MinIO), протоколы и образцы
// путей не переводятся намеренно: человек ищет их ровно в том виде, в каком
// они написаны у провайдера.
export default {
  // ---------- блоки с разметкой внутри ----------
  "install.intro": `Monti работает через свободный движок
    <a href="https://rclone.org" target="_blank" rel="noreferrer">rclone</a>,
    он и разговаривает с облачными сервисами. Пока он не установлен — нажмите
    кнопку ниже, и Monti загрузит его сам (права администратора не нужны).`,
  "drives.empty.hint": `Нажмите <b>Добавить облако</b>, войдите в браузере — и
    ваши файлы появятся обычной папкой на этом компьютере.`,
  "about.license": `Свободная программа, лицензия MIT. Работает на
    <a href="https://rclone.org" target="_blank" rel="noreferrer">rclone</a>.`,
  "key.step.project": `<a href="https://console.cloud.google.com/projectcreate" class="ext">Создайте проект</a> в Google Cloud (название любое).`,
  "key.step.api": `<a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" class="ext">Включите для него Google Drive API</a>.`,
  "key.step.consent": `<a href="https://console.cloud.google.com/auth/branding" class="ext">Настройте экран согласия</a>: выберите External.`,
  "key.step.tester": `<b><a href="https://console.cloud.google.com/auth/audience" class="ext">Добавьте себя в тестовые пользователи</a></b> (Audience → Test users → ваша почта). <b>Пропустить этот шаг — ошибка №1</b>: Google откажет во входе с «403 access_denied».`,
  "key.step.credentials": `<a href="https://console.cloud.google.com/apis/credentials" class="ext">Создайте учётные данные</a> → OAuth client ID → тип «Desktop app».`,
  "key.unverified": `При входе Google предупредит «Google hasn’t verified this
    app» — для собственного ключа это нормально: нажмите
    <b>Advanced&nbsp;→ Go&nbsp;to&nbsp;… (unsafe)</b> и продолжите.`,
  "sync.conflict.kept": `Вторая версия никогда не удаляется: она остаётся рядом
    с победившей, с <code>.conflict</code> в имени, и Monti спросит, что с ней
    делать.`,

  // ---------- шапка ----------
  "Mount your clouds": "Облака как обычные папки",
  Drives: "Диски",
  Sync: "Синхронизация",
  Settings: "Настройки",
  "Restart engine": "Перезапустить движок",
  "starting…": "запускается…",
  "The engine stopped — restart it and remount your drives":
    "Движок остановился — перезапустите его и подключите диски заново",
  "Transferring data to/from the cloud": "Обмен данными с облаком",
  "Engine status": "Состояние движка",

  // ---------- диски ----------
  "One more step": "Остался один шаг",
  "Download engine": "Загрузить движок",
  "Your drives": "Ваши диски",
  "＋ Add cloud": "＋ Добавить облако",
  "No clouds connected yet": "Ни одного облака ещё не подключено",

  // ---------- синхронизация ----------
  "Synced folders": "Синхронизируемые папки",
  "+ New sync": "+ Новая синхронизация",
  "Nothing is being synced": "Ничего не синхронизируется",
  "A synced folder is a real copy on this computer, kept the same as a folder in the cloud in both directions. Unlike a mounted drive it works with no network — and catches up afterwards. Syncing happens while Monti is running.":
    "Синхронизируемая папка — это настоящая копия на этом компьютере, которую Monti держит одинаковой с папкой в облаке в обе стороны. В отличие от подключённого диска она работает без сети, а изменения догоняют потом. Синхронизация идёт, пока запущен Monti.",

  // ---------- настройки: общие ----------
  General: "Общие",
  Appearance: "Внешний вид",
  "Follows your desktop unless you pick one here.":
    "Наследуется от системы, пока вы не выберете что-то здесь.",
  "Match system": "Как в системе",
  Light: "Светлая",
  Dark: "Тёмная",
  Language: "Язык",
  "Follows your desktop unless you pick one here. Messages coming from the engine stay in English.":
    "Наследуется от системы, пока вы не выберете что-то здесь. Сообщения от движка остаются английскими.",
  "Start Monti on login": "Запускать Monti при входе в систему",
  "Starts in the background: your drives are ready as soon as you sign in, without a window in the way.":
    "Запускается в фоне: диски готовы сразу после входа, и окно не мешает.",
  "Keep drives mounted after quitting": "Оставлять диски подключёнными после выхода",
  "The engine stays in the background so your folders keep working; Monti picks it up again on next start.":
    "Движок остаётся в фоне, и папки продолжают работать; при следующем запуске Monti снова его подхватит.",
  "Keep running in the tray": "Оставаться в трее",
  "Closing the window keeps drives mounted; quit from the tray icon.":
    "Закрытие окна не отключает диски; выйти можно через значок в трее.",
  "Desktop notifications": "Уведомления",
  "Only when something needs you: the engine stops, or the disk is nearly full.":
    "Только когда нужно ваше внимание: движок остановился или диск почти заполнен.",

  // ---------- настройки: передача ----------
  Transfers: "Передача",
  "Speed limit": "Ограничение скорости",
  "Caps how fast Monti uploads and downloads, so a big transfer doesn't take the whole connection. Applies immediately.":
    "Ограничивает скорость отправки и загрузки, чтобы большая передача не забирала весь канал. Действует сразу.",
  "No limit": "Без ограничений",
  "256 kB/s": "256 кБ/с",
  "1 MB/s": "1 МБ/с",
  "5 MB/s": "5 МБ/с",
  "10 MB/s": "10 МБ/с",
  "25 MB/s": "25 МБ/с",
  "Recent transfers": "Недавние передачи",
  "What the engine has moved since it started. The list is kept by the engine, so it empties whenever the engine restarts.":
    "Что движок передал с момента запуска. Список ведёт сам движок, поэтому после его перезапуска список пуст.",

  // ---------- настройки: хранилище ----------
  Storage: "Хранилище",
  "Cached by your drives": "В кэше дисков",
  "Free on this disk": "Свободно на этом диске",
  "Limit per drive by default": "Ограничение на диск по умолчанию",
  "Opening a file downloads a copy here so apps can work with it. Each drive drops its oldest copies once it reaches the limit, which you can change per drive in its settings.":
    "Когда вы открываете файл, его копия загружается сюда, чтобы программы могли с ним работать. Дойдя до предела, диск удаляет самые старые копии; для каждого диска предел меняется в его настройках.",

  // ---------- настройки: о программе ----------
  About: "О программе",
  Engine: "Движок",
  "Engine path": "Путь к движку",
  "Connections file": "Файл подключений",
  "Open config folder": "Открыть папку настроек",
  "Reinstall engine": "Переустановить движок",
  "Re-download the rclone engine — fixes a corrupted or outdated download":
    "Загрузить rclone заново — лечит повреждённый или устаревший файл",

  // ---------- добавление облака ----------
  "Add a cloud": "Добавить облако",
  Provider: "Сервис",
  "OneDrive (experimental)": "OneDrive (экспериментально)",
  "WebDAV / Nextcloud": "WebDAV / Nextcloud",
  "S3-compatible storage": "Хранилище, совместимое с S3",
  "Encrypted folder": "Зашифрованная папка",
  Name: "Название",
  "(the folder will be called this)": "(так будет называться папка)",
  "e.g. gdrive": "напр. gdrive",
  "Server URL": "Адрес сервера",
  "Server type": "Тип сервера",
  "Other WebDAV server": "Другой сервер WebDAV",
  Username: "Пользователь",
  Password: "Пароль",
  Service: "Служба",
  "Other S3-compatible": "Другое, совместимое с S3",
  "Access key ID": "Идентификатор ключа доступа",
  "Secret access key": "Секретный ключ доступа",
  Endpoint: "Точка доступа",
  "(not needed for Amazon)": "(для Amazon не нужно)",
  Region: "Регион",
  "e.g. eu-central-1": "напр. eu-central-1",
  "(optional)": "(необязательно)",
  Host: "Сервер",
  Port: "Порт",
  "SSH key file": "Файл ключа SSH",
  "(instead of password)": "(вместо пароля)",
  "Files are encrypted on this computer before they leave it, so the provider stores gibberish — file contents and names alike. You use the encrypted drive like any other: mount it, or sync a folder with it.":
    "Файлы шифруются на этом компьютере, прежде чем его покинуть, поэтому сервис хранит нечитаемое — и содержимое, и имена. Пользоваться зашифрованным диском можно как любым другим: подключить или синхронизировать с ним папку.",
  "Drive to store it on": "Диск, на котором хранить",
  "Folder there": "Папка на нём",
  "Repeat password": "Повторите пароль",
  "There is no way to recover this password. Lose it and the files stay encrypted forever — nobody, including you, can read them.":
    "Восстановить этот пароль невозможно. Потеряете — файлы останутся зашифрованными навсегда, и никто, включая вас, их не прочитает.",
  "The password is kept in rclone's config file on this computer, scrambled but not protected: anyone who can read that file can recover it. What encryption protects is the copy in the cloud.":
    "Пароль хранится в файле настроек rclone на этом компьютере — запутанным, но не защищённым: кто прочитает этот файл, тот его восстановит. Шифрование защищает копию, которая лежит в облаке.",
  "I have written the password down somewhere safe":
    "Я записал пароль в надёжном месте",
  "Use my own API key": "Использовать свой ключ API",
  "recommended for Google Drive": "рекомендуется для Google Drive",
  "Google is retiring the shared key all rclone apps use — your own free key avoids that and removes speed limits. Takes ~5 minutes, one time:":
    "Google сворачивает общий ключ, которым пользуются все программы на rclone; свой бесплатный ключ избавляет от этого и снимает ограничения скорости. Около 5 минут, один раз:",
  "Copy the Client ID and Client secret below.":
    "Скопируйте Client ID и Client secret в поля ниже.",
  "Your browser will open — sign in and allow access. Monti never sees your password; the access token is stored locally by rclone.":
    "Откроется браузер — войдите и разрешите доступ. Monti не видит вашего пароля; токен доступа rclone хранит локально.",
  "⏳ Waiting for you to authorize in the browser… Press Cancel to abort.":
    "⏳ Ждём подтверждения в браузере… Нажмите «Отмена», чтобы прервать.",
  Cancel: "Отмена",
  Connect: "Подключить",

  // ---------- настройки диска ----------
  "Drive settings": "Настройки диска",
  "Mount folder": "Папка подключения",
  "Browse…": "Обзор…",
  "~/CloudDrives/…": "~/CloudDrives/…",
  "Leave empty for the default. Applies on next mount.":
    "Пустое поле — папка по умолчанию. Подействует при следующем подключении.",
  "Mount automatically when Monti starts":
    "Подключать автоматически при запуске Monti",
  "Read-only": "Только чтение",
  "(protect files from changes)": "(защитить файлы от изменений)",
  "Cache size limit": "Ограничение кэша",
  "Keep cache for": "Хранить кэш",
  "Opening a file downloads a copy to this computer, so apps can work with it normally. Older copies are dropped once the limit is reached. Applies on next mount.":
    "Когда вы открываете файл, его копия загружается на этот компьютер, чтобы программы работали с ним привычно. Дойдя до предела, Monti удаляет самые старые копии. Подействует при следующем подключении.",
  Folders: "Папки",
  "All folders": "Все папки",
  "Choose…": "Выбрать…",
  "Cached on this computer": "В кэше на этом компьютере",
  "Clear cache": "Очистить кэш",
  "API key": "Ключ API",
  "Changing the key re-opens the browser to authorize. How to get a key: see “Use my own API key” in the Add cloud dialog.":
    "Смена ключа снова откроет браузер для входа. Как получить ключ — см. «Использовать свой ключ API» в окне добавления облака.",
  "⏳ Waiting for you to authorize in the browser…":
    "⏳ Ждём подтверждения в браузере…",
  "Re-authorize": "Войти заново",
  "Re-run the browser sign-in for this drive":
    "Пройти вход в браузере для этого диска ещё раз",
  Save: "Сохранить",

  // ---------- синхронизация: окно ----------
  "New sync": "Новая синхронизация",
  "Folder on this computer": "Папка на этом компьютере",
  Cloud: "Облако",
  "Folder in the cloud": "Папка в облаке",
  "Leave the cloud folder empty to sync the whole drive — that is rarely what you want.":
    "Пустое поле папки в облаке означает синхронизацию всего диска — так нужно редко.",
  "Only when I press Sync": "Только когда я нажму «Синхронизировать»",
  "When Monti starts": "При запуске Monti",
  "Every 15 minutes": "Каждые 15 минут",
  "Every hour": "Каждый час",
  "If both sides changed": "Если изменились обе стороны",
  "Keep the newer file": "Оставить более новый файл",
  "Keep the one on this computer": "Оставить тот, что на этом компьютере",
  "Keep the one in the cloud": "Оставить тот, что в облаке",
  "First sync": "Первая синхронизация",
  "When the same file exists on both sides":
    "Когда один и тот же файл есть с обеих сторон",
  "Keep whichever is newer": "Оставлять более новый",
  "This first run is the only one that can overwrite a file with the other side's version. Every run after it compares both sides and keeps conflicts.":
    "Только этот первый запуск может перезаписать файл версией с другой стороны. Каждый следующий сравнивает обе стороны и сохраняет конфликты.",
  Start: "Начать",

  // ---------- небольшие окна ----------
  "Link to this file": "Ссылка на этот файл",
  "Anyone with the link can open the file. Remove the link again in the provider's own web interface.":
    "Файл откроет любой, у кого есть ссылка. Убрать ссылку можно в веб-интерфейсе самого сервиса.",
  Copy: "Копировать",
  Done: "Готово",
  "Choose folders": "Выбрать папки",
  "Select all": "Выбрать все",
  Encrypted: "Зашифровано",
  OK: "ОК",

  // ---------- единицы ----------
  GB: "ГБ",
  MB: "МБ",
  kB: "кБ",
  "GB/s": "ГБ/с",
  "MB/s": "МБ/с",
  "kB/s": "кБ/с",
  "B/s": "Б/с",
};
