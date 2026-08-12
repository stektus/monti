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

  "b2.where": `Оба значения берутся со страницы
    <a href="https://secure.backblaze.com/app_keys.htm" class="ext">Application Keys</a>
    в вашей учётной записи Backblaze: создайте ключ и скопируйте две величины,
    которые он покажет один раз. Ключ, созданный для одного ведра, видит
    только его.`,
  "Key ID": "Идентификатор ключа",
  "Application key": "Ключ приложения",
  "Key ID and Application key are required.":
    "Нужны идентификатор ключа и ключ приложения.",

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

  // ---------- строки, которые рисует JavaScript ----------

  // ошибки входа
  "Google refused the sign-in (403 access_denied): the Google account you signed in with is not on your app's test-user list.\n\nFix: open console.cloud.google.com/auth/audience → Test users → Add users → add your own e-mail → Save, then try again.":
    "Google отказал во входе (403 access_denied): учётная запись, которой вы вошли, не внесена в список тестовых пользователей вашего приложения.\n\nКак исправить: откройте console.cloud.google.com/auth/audience → Test users → Add users → добавьте свою почту → Save и попробуйте снова.",
  "Google rejected the API key (invalid_client): the Client ID or Client secret has a typo. Copy both values again from console.cloud.google.com/apis/credentials.":
    "Google не принял ключ API (invalid_client): в Client ID или Client secret опечатка. Скопируйте оба значения заново с console.cloud.google.com/apis/credentials.",
  "Another authorization is still waiting in some browser tab (port 53682 is busy). Close old rclone/Google tabs, wait a few seconds and try again.":
    "В какой-то вкладке браузера ещё ждёт предыдущий вход (порт 53682 занят). Закройте старые вкладки rclone/Google, подождите несколько секунд и попробуйте снова.",

  // выбор папок
  "1 folder left out: {folder}": "одна папка исключена: {folder}",
  "{n} folders left out": { one: "{n} папка исключена", few: "{n} папки исключены", many: "{n} папок исключено", other: "{n} папок исключено" },
  "Reading the cloud…": "Читаем облако…",
  "This folder has no subfolders.": "В этой папке нет подпапок.",
  "Folders of \"{name}\"": "Папки диска «{name}»",
  "Unticked folders are left out of the mounted drive: they stay in the cloud, they just do not appear on this computer.":
    "Снятые галочки исключают папки из подключённого диска: в облаке они остаются, просто не появляются на этом компьютере.",
  "Folders to sync": "Папки для синхронизации",
  "Unticked folders are not synced: they stay as they are on both sides, and Monti stops comparing them.":
    "Снятые галочки исключают папки из синхронизации: с обеих сторон они остаются как есть, Monti просто перестаёт их сверять.",
  "Pick the cloud first — its folders are what you choose from.":
    "Сначала выберите облако — папки берутся именно из него.",

  // движок
  "engine not installed": "движок не установлен",
  "engine running": "движок работает",
  "engine failed": "движок не запустился",
  "engine stopped": "движок остановился",
  "restarting…": "перезапускается…",
  "{which} is no longer mounted — something unmounted it outside Monti. Press Mount on the drive to bring the folder back.":
    "{which} больше не подключён — что-то отключило диск вне Monti. Нажмите «Подключить» на диске, чтобы вернуть папку.",
  "Monti: a drive disconnected": "Monti: диск отключён",
  "{which} is no longer mounted. Open Monti and press Mount.":
    "{which} больше не подключён. Откройте Monti и нажмите «Подключить».",
  "The rclone engine stopped unexpectedly — your drives are disconnected. Press “Restart engine” to bring them back.":
    "Движок rclone неожиданно остановился — диски отключены. Нажмите «Перезапустить движок», чтобы вернуть их.",
  "Monti: your drives are disconnected": "Monti: диски отключены",
  "The rclone engine stopped. Open Monti and press “Restart engine”.":
    "Движок rclone остановился. Откройте Monti и нажмите «Перезапустить движок».",
  "The engine isn't running.": "Движок не работает.",

  // квота и активность
  "{used} of {total} used in the cloud": "{used} из {total} занято в облаке",
  "{used} used in the cloud": "{used} занято в облаке",
  "{n} files · {speed}": { one: "{n} файл · {speed}", few: "{n} файла · {speed}", many: "{n} файлов · {speed}", other: "{n} файлов · {speed}" },

  // чипы на карточке диска
  mounted: "подключён",
  "Uploading changes to the cloud": "Отправляем изменения в облако",
  syncing: "синхронизация",
  "Mounted outside Monti (e.g. a systemd service).":
    "Подключён вне Monti (например, службой systemd).",
  "mounted · system": "подключён · система",
  "not mounted": "не подключён",
  "The encrypted copy is stored here": "Здесь хранится зашифрованная копия",
  "Connected through your own API key": "Подключён через свой ключ API",
  "own key": "свой ключ",
  "Read-only: files cannot be changed": "Только чтение: файлы нельзя изменять",
  "read-only": "только чтение",
  "in {name}": "в {name}",
  encrypted: "зашифрованный",
  "{size} cached on this computer": "{size} в кэше на этом компьютере",

  // действия с диском
  "Open folder": "Открыть папку",
  Unmount: "Отключить",
  Mount: "Подключить",
  Remove: "Удалить",
  "Uploads are still running": "Отправка ещё идёт",
  "{n} file(s) from \"{name}\" have not reached the cloud yet.":
    { one: "{n} файл с диска «{name}» ещё не добрался до облака.", few: "{n} файла с диска «{name}» ещё не добрались до облака.", many: "{n} файлов с диска «{name}» ещё не добрались до облака.", other: "{n} файлов с диска «{name}» ещё не добрались до облака." },
  "Unmounting pauses the upload; it resumes the next time you mount the drive.":
    "Отключение приостанавливает отправку; она продолжится, когда вы подключите диск снова.",
  "Until then those changes exist only on this computer.":
    "До тех пор эти изменения существуют только на этом компьютере.",
  "Shutting the computer down before the next mount can lose them.":
    "Если выключить компьютер до следующего подключения, их можно потерять.",
  "Unmount anyway": "Всё равно отключить",
  "Unmount \"{name}\"?": "Отключить «{name}»?",
  "This drive was mounted outside Monti — by a systemd service or a manual rclone mount.":
    "Этот диск подключён вне Monti — службой systemd или запуском rclone вручную.",
  "Close any app still using files there first.":
    "Сначала закройте программы, которые ещё работают с файлами оттуда.",
  "A service that manages this mount may bring it back, or may need to be disabled separately.":
    "Служба, которая управляет этим подключением, может вернуть его обратно — тогда её нужно отключить отдельно.",
  "Unsaved changes in files that are still open would be lost.":
    "Несохранённые изменения в открытых файлах будут потеряны.",
  "Files in the cloud are not touched.": "Файлы в облаке остаются нетронутыми.",
  "The saved sign-in for this drive is removed from the rclone config on this machine.":
    "Сохранённый вход для этого диска будет убран из настроек rclone на этой машине.",
  "The empty mount folder {folder} is removed.": "Пустая папка подключения {folder} будет удалена.",
  "Disconnect \"{name}\" from this computer?": "Отключить «{name}» от этого компьютера?",
  "The drive disappears from Monti. You can add it back later by signing in again.":
    "Диск исчезнет из Monti. Позже его можно добавить снова, войдя ещё раз.",
  Disconnect: "Отключить",
  "Also delete {size} of cached file copies": "Также удалить {size} кэшированных копий файлов",
  "Share a file": "Поделиться файлом",
  "Get a link to a file in this drive": "Получить ссылку на файл с этого диска",
  Copied: "Скопировано",
  "Press Ctrl+C": "Нажмите Ctrl+C",
  "Auto-mount of “{name}” failed: {error}":
    "Автоподключение «{name}» не удалось: {error}",
  "“{name}” is not mounted yet — trying again in {wait}s. Right after login this usually means the network is still coming up.":
    "«{name}» ещё не подключён — попробуем снова через {wait} с. Сразу после входа это обычно значит, что сеть ещё поднимается.",

  // расписание синхронизации
  manual: "вручную",
  "when Monti starts": "при запуске Monti",
  "every 15 minutes": "каждые 15 минут",
  "every hour": "каждый час",

  // карточка синхронизации
  ready: "готово",
  "not synced yet": "ещё не синхронизировано",
  "last sync {when} UTC": "последняя синхронизация {when} UTC",
  "last sync failed: {error}": "последняя синхронизация не удалась: {error}",
  "never synced": "ни разу не синхронизировано",
  Stop: "Остановить",
  "Sync now": "Синхронизировать",
  "Settings for this pair": "Настройки этой пары",
  "\"{name}\" has not been synced yet. Monti will compare {local} and {remote} and make them match.":
    "«{name}» ещё не синхронизировалась. Monti сверит {local} и {remote} и сделает их одинаковыми.",
  "Measuring the cloud folder…": "Измеряем папку в облаке…",
  "{n} files": { one: "{n} файле", few: "{n} файлах", many: "{n} файлах", other: "{n} файлах" },
  "The cloud side holds {size} in {files}.": "В облаке — {size} в {files}.",
  "The cloud side holds {size} in {files}; this computer has {free} free.":
    "В облаке — {size} в {files}; на этом компьютере свободно {free}.",
  "It will not all fit — leave some folders out first.":
    "Всё это не поместится — сначала исключите часть папок.",
  "Sync of \"{name}\" could not start: {error}":
    "Синхронизация «{name}» не началась: {error}",
  "Files were deleted": "Файлы были удалены",
  "{n} of {total} file(s) are gone from one side of \"{name}\". Syncing will remove them from the other side too.":
    { one: "{n} из {total} файлов исчез с одной стороны пары «{name}». Синхронизация удалит его и с другой стороны.", few: "{n} из {total} файлов исчезли с одной стороны пары «{name}». Синхронизация удалит их и с другой стороны.", many: "{n} из {total} файлов исчезли с одной стороны пары «{name}». Синхронизация удалит их и с другой стороны.", other: "{n} из {total} файлов исчезли с одной стороны пары «{name}». Синхронизация удалит их и с другой стороны." },
  "Files are gone from one side of \"{name}\". Syncing will remove them from the other side too.":
    "С одной стороны пары «{name}» исчезли файлы. Синхронизация удалит их и с другой стороны.",
  "on this computer: {path}": "на этом компьютере: {path}",
  "in the cloud: {path}": "в облаке: {path}",
  "if this is not what you expected, cancel and check both folders first":
    "если вы такого не ожидали — отмените и сначала проверьте обе папки",
  "Delete them": "Удалить их",
  "Stop asking for this pair": "Больше не спрашивать для этой пары",
  "syncing — {n} file(s), {size}": { one: "синхронизация — {n} файл, {size}", few: "синхронизация — {n} файла, {size}", many: "синхронизация — {n} файлов, {size}", other: "синхронизация — {n} файлов, {size}" },
  "syncing — checking {n} file(s)": { one: "синхронизация — проверяем {n} файл", few: "синхронизация — проверяем {n} файла", many: "синхронизация — проверяем {n} файлов", other: "синхронизация — проверяем {n} файлов" },
  "Sync of \"{name}\" failed: {error}": "Синхронизация «{name}» не удалась: {error}",
  "Monti: sync failed": "Monti: синхронизация не удалась",
  "\"{name}\" did not finish: {error}": "«{name}» не завершилась: {error}",

  // конфликты
  "{n} file(s) changed on both sides": { one: "{n} файл изменён с обеих сторон", few: "{n} файла изменены с обеих сторон", many: "{n} файлов изменены с обеих сторон", other: "{n} файлов изменены с обеих сторон" },
  "keep current": "оставить текущий",
  "Delete this older copy": "Удалить эту более старую копию",
  "keep this": "оставить этот",
  "Put this copy back under the original name": "Вернуть эту копию под исходным именем",
  "keep both": "оставить оба",
  "Rename it to “(copy)” and stop calling it a conflict":
    "Переименовать в «(copy)» и больше не считать конфликтом",

  // окно пары
  "{name} — sync settings": "{name} — настройки синхронизации",
  "Connect a cloud first — there is nothing to sync with.":
    "Сначала подключите облако — синхронизировать пока не с чем.",
  "\"{name}\" will sync from scratch once": "«{name}» один раз синхронизируется с нуля",
  "You changed which folders this pair carries.": "Вы изменили набор папок этой пары.",
  "The next sync compares both sides fully and merges them, keeping the newer copy of anything that differs.":
    "Следующая синхронизация полностью сверит обе стороны и объединит их, оставляя более новую копию всего, что различается.",
  "Nothing is deleted by that run, and folders you left out are simply not touched again.":
    "Тот запуск ничего не удаляет, а исключённые папки просто больше не трогаются.",
  "Stop syncing \"{name}\"?": "Прекратить синхронизацию «{name}»?",
  "Monti forgets this pair. Nothing is deleted:": "Monti забудет эту пару. Ничего не удаляется:",
  "{path} stays exactly as it is": "{path} остаётся как есть",
  "the two simply stop being kept the same": "их просто перестают держать одинаковыми",
  "Stop syncing": "Прекратить синхронизацию",

  // окно настроек диска
  "{name} — settings": "{name} — настройки",
  "unchanged — enter a new one to replace": "без изменений — введите новый, чтобы заменить",
  "Using your own API key.": "Используется свой ключ API.",
  "Using rclone's shared key — it is being retired during 2026, switching to your own key is recommended.":
    "Используется общий ключ rclone — его сворачивают в течение 2026 года, поэтому советуем перейти на свой.",
  "{limit} · e.g. 10G": "{limit} · напр. 10G",
  "counting…": "считаем…",
  "nothing cached": "кэш пуст",
  "Unmount the drive first — rclone is using these files right now":
    "Сначала отключите диск — сейчас rclone работает с этими файлами",
  "Delete the downloaded copies kept on this computer":
    "Удалить загруженные копии, лежащие на этом компьютере",
  "Clear the local cache?": "Очистить локальный кэш?",
  "{size} of downloaded copies of \"{name}\" will be deleted from this computer.":
    "{size} загруженных копий диска «{name}» будет удалено с этого компьютера.",
  "They download again the next time you open them.":
    "В следующий раз, когда вы их откроете, они загрузятся снова.",
  "\"{value}\" is not a size — try something like 500M or 10G.":
    "«{value}» — не размер, попробуйте что-то вроде 500M или 10G.",
  "\"{value}\" is not a duration — try something like 30m, 24h or 7d.":
    "«{value}» — не длительность, попробуйте что-то вроде 30m, 24h или 7d.",
  "Enter the Client secret that pairs with the new Client ID.":
    "Введите Client secret, который соответствует новому Client ID.",
  "Enter the Client ID that pairs with this Client secret.":
    "Введите Client ID, который соответствует этому Client secret.",
  "Remount \"{name}\" now?": "Переподключить «{name}» сейчас?",
  "The folders you chose apply from the next mount on.":
    "Выбранный набор папок действует со следующего подключения.",
  "Monti unmounts the drive and mounts it again — a few seconds.":
    "Monti отключит диск и подключит его снова — несколько секунд.",
  "Files open from that folder right now would lose their connection.":
    "Файлы, открытые сейчас из этой папки, потеряют связь.",
  Remount: "Переподключить",

  // хранилище и передачи
  "Only {left} left on this disk. Clear a drive's cache in its settings, or lower its cache size limit.":
    "На этом диске осталось {left}. Очистите кэш диска в его настройках или уменьшите ограничение кэша.",
  "Monti: this disk is nearly full": "Monti: этот диск почти заполнен",
  "Only {left} left. Clear a drive's cache or lower its limit.":
    "Осталось {left}. Очистите кэш диска или уменьшите его ограничение.",
  "Nothing transferred since the engine started.": "С запуска движка ничего не передано.",
  "(unnamed)": "(без имени)",
  failed: "не удалось",
  checked: "проверено",
  "not installed": "не установлен",

  // установка движка
  "Downloading rclone… (10–40 MB)": "Загружаем rclone… (10–40 МБ)",
  "Downloading rclone… {percent}% of {size}": "Загружаем rclone… {percent}% из {size}",
  "Downloading rclone… {size}": "Загружаем rclone… {size}",
  "Done — installed to {path}. Takes effect on the next engine restart.":
    "Готово — установлено в {path}. Подействует после следующего перезапуска движка.",
  "Done!": "Готово!",
  "Tray isn't available on this desktop — closing the window quits Monti. (On Arch/Manjaro: install libayatana-appindicator.)":
    "На этом рабочем столе трея нет — закрытие окна завершает Monti. (На Arch/Manjaro: установите libayatana-appindicator.)",

  // трей
  "{n} drive(s) are still uploading": { one: "{n} диск ещё отправляет файлы", few: "{n} диска ещё отправляют файлы", many: "{n} дисков ещё отправляют файлы", other: "{n} дисков ещё отправляют файлы" },
  "{drives} — open Monti to unmount anyway.":
    "{drives} — откройте Monti, чтобы отключить всё равно.",
  "“{name}” is still uploading": "«{name}» ещё отправляет файлы",
  "{n} file(s) have not reached the cloud yet. Open Monti to unmount anyway.":
    { one: "{n} файл ещё не добрался до облака. Откройте Monti, чтобы отключить всё равно.", few: "{n} файла ещё не добрались до облака. Откройте Monti, чтобы отключить всё равно.", many: "{n} файлов ещё не добрались до облака. Откройте Monti, чтобы отключить всё равно.", other: "{n} файлов ещё не добрались до облака. Откройте Monti, чтобы отключить всё равно." },
  "Could not mount “{name}”": "Не удалось подключить «{name}»",
  "Could not unmount “{name}”": "Не удалось отключить «{name}»",

  // добавление облака
  "⏳ Connecting…": "⏳ Подключаемся…",
  "Server URL is required.": "Нужен адрес сервера.",
  "Access key ID and Secret access key are required.":
    "Нужны Access key ID и Secret access key.",
  "Endpoint is required for non-Amazon S3 services.":
    "Для сервисов S3, отличных от Amazon, нужна точка доступа.",
  "Add a drive first — an encrypted drive lives inside one.":
    "Сначала добавьте диск — зашифрованный диск живёт внутри обычного.",
  "A password is required — that is the whole point.":
    "Нужен пароль — в нём весь смысл.",
  "The two passwords are not the same.": "Пароли не совпадают.",
  "Please confirm the password is written down: it cannot be recovered.":
    "Подтвердите, что пароль записан: восстановить его невозможно.",

  // трей
  "Open Monti": "Открыть Monti",
  Quit: "Выйти",
  "Engine stopped": "Движок остановлен",
  "Engine running": "Движок работает",
  "Engine running · {mounted} of {total} mounted":
    "Движок работает · подключено {mounted} из {total}",
  "Mount “{name}”": "Подключить «{name}»",
  "Unmount “{name}”": "Отключить «{name}»",
  "All {n} drives in Monti…": { one: "Все {n} диск в Monti…", few: "Все {n} диска в Monti…", many: "Все {n} дисков в Monti…", other: "Все {n} дисков в Monti…" },
  "Unmount all {n} drives": { one: "Отключить {n} диск", few: "Отключить все {n} диска", many: "Отключить все {n} дисков", other: "Отключить все {n} дисков" },
  "Monti — engine stopped": "Monti — движок остановлен",
  "Monti — no drives mounted": "Monti — ни один диск не подключён",
  "Monti — {n} drives mounted": { one: "Monti — подключён {n} диск", few: "Monti — подключено {n} диска", many: "Monti — подключено {n} дисков", other: "Monti — подключено {n} дисков" },

  // ---------- единицы ----------
  GB: "ГБ",
  MB: "МБ",
  kB: "кБ",
  "MB/s": "МБ/с",
  "kB/s": "кБ/с",
  "B/s": "Б/с",
};
