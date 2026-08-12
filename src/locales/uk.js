// Українська. Ключ — англійський оригінал; нема перекладу — видно оригінал.
// Назви сервісів (Google Drive, Nextcloud, MinIO), протоколи та зразки шляхів
// не перекладаються навмисно: людина шукає їх саме такими, як у провайдера.
export default {
  // ---------- блоки з розміткою всередині ----------
  "install.intro": `Monti користується вільним рушієм
    <a href="https://rclone.org" target="_blank" rel="noreferrer">rclone</a>,
    щоб спілкуватися з хмарними сервісами. Його ще не встановлено — натисніть
    кнопку нижче, і Monti завантажить рушій сам (права адміністратора не
    потрібні).`,
  "drives.empty.hint": `Натисніть <b>Додати хмару</b>, увійдіть у браузері — і
    ваші файли з'являться звичайною текою на цьому комп'ютері.`,
  "about.license": `Вільна програма, ліцензія MIT. Працює на
    <a href="https://rclone.org" target="_blank" rel="noreferrer">rclone</a>.`,
  "key.step.project": `<a href="https://console.cloud.google.com/projectcreate" class="ext">Створіть проєкт</a> у Google Cloud (назва будь-яка).`,
  "key.step.api": `<a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" class="ext">Увімкніть для нього Google Drive API</a>.`,
  "key.step.consent": `<a href="https://console.cloud.google.com/auth/branding" class="ext">Налаштуйте екран згоди</a>: оберіть External.`,
  "key.step.tester": `<b><a href="https://console.cloud.google.com/auth/audience" class="ext">Додайте себе як тестового користувача</a></b> (Audience → Test users → ваша пошта). <b>Пропустити цей крок — помилка №1</b>: Google відмовить у вході з «403 access_denied».`,
  "key.step.credentials": `<a href="https://console.cloud.google.com/apis/credentials" class="ext">Створіть облікові дані</a> → OAuth client ID → тип «Desktop app».`,
  "key.unverified": `Під час входу Google попередить «Google hasn’t verified
    this app» — для власного ключа це нормально: натисніть
    <b>Advanced&nbsp;→ Go&nbsp;to&nbsp;… (unsafe)</b> і продовжте.`,
  "sync.conflict.kept": `Друга версія ніколи не зникає: вона лишається поруч із
    переможцем, із <code>.conflict</code> у назві, і Monti запитає, що з нею
    робити.`,

  // ---------- шапка ----------
  "Mount your clouds": "Хмари як звичайні теки",
  Drives: "Диски",
  Sync: "Синхронізація",
  Settings: "Налаштування",
  "Restart engine": "Перезапустити рушій",
  "starting…": "запускається…",
  "The engine stopped — restart it and remount your drives":
    "Рушій зупинився — перезапустіть його й підключіть диски знову",
  "Transferring data to/from the cloud": "Обмін даними з хмарою",
  "Engine status": "Стан рушія",

  // ---------- диски ----------
  "One more step": "Лишився один крок",
  "Download engine": "Завантажити рушій",
  "Your drives": "Ваші диски",
  "＋ Add cloud": "＋ Додати хмару",
  "No clouds connected yet": "Жодної хмари ще не підключено",

  // ---------- синхронізація ----------
  "Synced folders": "Синхронізовані теки",
  "+ New sync": "+ Нова синхронізація",
  "Nothing is being synced": "Ніщо не синхронізується",
  "A synced folder is a real copy on this computer, kept the same as a folder in the cloud in both directions. Unlike a mounted drive it works with no network — and catches up afterwards. Syncing happens while Monti is running.":
    "Синхронізована тека — це справжня копія на цьому комп'ютері, яку Monti тримає однаковою з текою в хмарі в обидва боки. На відміну від підключеного диска вона працює без мережі, а зміни наздоганяють згодом. Синхронізація відбувається, поки Monti запущено.",

  // ---------- налаштування: загальні ----------
  General: "Загальні",
  Appearance: "Вигляд",
  "Follows your desktop unless you pick one here.":
    "Успадковується від системи, доки ви не оберете щось тут.",
  "Match system": "Як у системі",
  Light: "Світла",
  Dark: "Темна",
  Language: "Мова",
  "Follows your desktop unless you pick one here. Messages coming from the engine stay in English.":
    "Успадковується від системи, доки ви не оберете щось тут. Повідомлення від рушія лишаються англійськими.",
  "Start Monti on login": "Запускати Monti під час входу",
  "Starts in the background: your drives are ready as soon as you sign in, without a window in the way.":
    "Запускається у фоні: диски готові одразу після входу в систему, і вікно не заважає.",
  "Keep drives mounted after quitting": "Лишати диски підключеними після виходу",
  "The engine stays in the background so your folders keep working; Monti picks it up again on next start.":
    "Рушій лишається у фоні, тож теки працюють далі; наступного запуску Monti знову їх підхопить.",
  "Keep running in the tray": "Лишатися в лотку",
  "Closing the window keeps drives mounted; quit from the tray icon.":
    "Закриття вікна не від'єднує диски; вийти можна через піктограму в лотку.",
  "Desktop notifications": "Сповіщення",
  "Only when something needs you: the engine stops, or the disk is nearly full.":
    "Тільки коли потрібна ваша увага: рушій зупинився або диск майже заповнений.",

  // ---------- налаштування: передавання ----------
  Transfers: "Передавання",
  "Speed limit": "Обмеження швидкості",
  "Caps how fast Monti uploads and downloads, so a big transfer doesn't take the whole connection. Applies immediately.":
    "Обмежує швидкість вивантаження й завантаження, щоб велике передавання не з'їдало весь канал. Діє одразу.",
  "No limit": "Без обмежень",
  "256 kB/s": "256 кБ/с",
  "1 MB/s": "1 МБ/с",
  "5 MB/s": "5 МБ/с",
  "10 MB/s": "10 МБ/с",
  "25 MB/s": "25 МБ/с",
  "Recent transfers": "Недавні передавання",
  "What the engine has moved since it started. The list is kept by the engine, so it empties whenever the engine restarts.":
    "Що рушій передав від свого запуску. Список веде сам рушій, тож після його перезапуску список порожній.",

  // ---------- налаштування: сховище ----------
  Storage: "Сховище",
  "Cached by your drives": "У кеші дисків",
  "Free on this disk": "Вільно на цьому диску",
  "Limit per drive by default": "Обмеження на диск за замовчуванням",
  "Opening a file downloads a copy here so apps can work with it. Each drive drops its oldest copies once it reaches the limit, which you can change per drive in its settings.":
    "Коли ви відкриваєте файл, його копія завантажується сюди, щоб програми могли з ним працювати. Досягнувши межі, диск прибирає найдавніші копії; для кожного диска межу можна змінити в його налаштуваннях.",

  // ---------- налаштування: про програму ----------
  About: "Про програму",
  Engine: "Рушій",
  "Engine path": "Шлях до рушія",
  "Connections file": "Файл підключень",
  "Open config folder": "Відкрити теку налаштувань",
  "Reinstall engine": "Перевстановити рушій",
  "Re-download the rclone engine — fixes a corrupted or outdated download":
    "Завантажити rclone заново — лікує пошкоджений або застарілий файл",

  // ---------- додавання хмари ----------
  "Add a cloud": "Додати хмару",
  Provider: "Сервіс",
  "OneDrive (experimental)": "OneDrive (експериментально)",
  "WebDAV / Nextcloud": "WebDAV / Nextcloud",
  "S3-compatible storage": "Сховище, сумісне з S3",
  "Encrypted folder": "Зашифрована тека",
  Name: "Назва",
  "(the folder will be called this)": "(так називатиметься тека)",
  "e.g. gdrive": "напр. gdrive",
  "Server URL": "Адреса сервера",
  "Server type": "Тип сервера",
  "Other WebDAV server": "Інший сервер WebDAV",
  Username: "Користувач",
  Password: "Пароль",
  Service: "Служба",
  "Other S3-compatible": "Інше, сумісне з S3",
  "Access key ID": "Ідентифікатор ключа доступу",
  "Secret access key": "Секретний ключ доступу",
  Endpoint: "Точка доступу",
  "(not needed for Amazon)": "(для Amazon не потрібно)",
  Region: "Регіон",
  "e.g. eu-central-1": "напр. eu-central-1",
  "(optional)": "(необов'язково)",
  Host: "Сервер",
  Port: "Порт",
  "SSH key file": "Файл ключа SSH",
  "(instead of password)": "(замість пароля)",
  "Files are encrypted on this computer before they leave it, so the provider stores gibberish — file contents and names alike. You use the encrypted drive like any other: mount it, or sync a folder with it.":
    "Файли шифруються на цьому комп'ютері, перш ніж його покинути, тож сервіс зберігає нечитабельне — і вміст, і назви. Користуватися зашифрованим диском можна як будь-яким іншим: підключити або синхронізувати з ним теку.",
  "Drive to store it on": "Диск, на якому зберігати",
  "Folder there": "Тека на ньому",
  "Repeat password": "Повторіть пароль",
  "There is no way to recover this password. Lose it and the files stay encrypted forever — nobody, including you, can read them.":
    "Відновити цей пароль неможливо. Втратите — файли лишаться зашифрованими назавжди, і ніхто, зокрема й ви, їх не прочитає.",
  "The password is kept in rclone's config file on this computer, scrambled but not protected: anyone who can read that file can recover it. What encryption protects is the copy in the cloud.":
    "Пароль зберігається у файлі налаштувань rclone на цьому комп'ютері — заплутаним, але не захищеним: хто прочитає цей файл, той його відновить. Шифрування захищає копію, що лежить у хмарі.",
  "I have written the password down somewhere safe":
    "Я записав пароль у надійному місці",
  "Use my own API key": "Використати власний ключ API",
  "recommended for Google Drive": "рекомендовано для Google Drive",
  "Google is retiring the shared key all rclone apps use — your own free key avoids that and removes speed limits. Takes ~5 minutes, one time:":
    "Google згортає спільний ключ, яким користуються всі програми на rclone; власний безкоштовний ключ рятує від цього й прибирає обмеження швидкості. Приблизно 5 хвилин, один раз:",
  "Copy the Client ID and Client secret below.":
    "Скопіюйте Client ID і Client secret у поля нижче.",
  "Your browser will open — sign in and allow access. Monti never sees your password; the access token is stored locally by rclone.":
    "Відкриється браузер — увійдіть і надайте доступ. Monti не бачить вашого пароля; токен доступу зберігає локально rclone.",
  "⏳ Waiting for you to authorize in the browser… Press Cancel to abort.":
    "⏳ Чекаємо на підтвердження в браузері… Натисніть «Скасувати», щоб перервати.",
  Cancel: "Скасувати",
  Connect: "Підключити",

  // ---------- налаштування диска ----------
  "Drive settings": "Налаштування диска",
  "Mount folder": "Тека підключення",
  "Browse…": "Огляд…",
  "~/CloudDrives/…": "~/CloudDrives/…",
  "Leave empty for the default. Applies on next mount.":
    "Порожнє поле — стандартна тека. Подіє під час наступного підключення.",
  "Mount automatically when Monti starts":
    "Підключати автоматично під час запуску Monti",
  "Read-only": "Лише читання",
  "(protect files from changes)": "(захистити файли від змін)",
  "Cache size limit": "Обмеження кешу",
  "Keep cache for": "Зберігати кеш",
  "Opening a file downloads a copy to this computer, so apps can work with it normally. Older copies are dropped once the limit is reached. Applies on next mount.":
    "Коли ви відкриваєте файл, його копія завантажується на цей комп'ютер, щоб програми працювали з ним звично. Досягнувши межі, Monti прибирає найдавніші копії. Подіє під час наступного підключення.",
  Folders: "Теки",
  "All folders": "Усі теки",
  "Choose…": "Обрати…",
  "Cached on this computer": "У кеші на цьому комп'ютері",
  "Clear cache": "Очистити кеш",
  "API key": "Ключ API",
  "Changing the key re-opens the browser to authorize. How to get a key: see “Use my own API key” in the Add cloud dialog.":
    "Зміна ключа знову відкриє браузер для входу. Як отримати ключ — див. «Використати власний ключ API» у вікні додавання хмари.",
  "⏳ Waiting for you to authorize in the browser…":
    "⏳ Чекаємо на підтвердження в браузері…",
  "Re-authorize": "Увійти заново",
  "Re-run the browser sign-in for this drive":
    "Пройти вхід у браузері для цього диска ще раз",
  Save: "Зберегти",

  // ---------- синхронізація: вікно ----------
  "New sync": "Нова синхронізація",
  "Folder on this computer": "Тека на цьому комп'ютері",
  Cloud: "Хмара",
  "Folder in the cloud": "Тека в хмарі",
  "Leave the cloud folder empty to sync the whole drive — that is rarely what you want.":
    "Порожнє поле теки в хмарі означає синхронізацію всього диска — таке потрібно рідко.",
  "Only when I press Sync": "Лише коли я натисну «Синхронізувати»",
  "When Monti starts": "Під час запуску Monti",
  "Every 15 minutes": "Кожні 15 хвилин",
  "Every hour": "Щогодини",
  "If both sides changed": "Якщо змінилися обидві сторони",
  "Keep the newer file": "Лишити новіший файл",
  "Keep the one on this computer": "Лишити той, що на цьому комп'ютері",
  "Keep the one in the cloud": "Лишити той, що в хмарі",
  "First sync": "Перша синхронізація",
  "When the same file exists on both sides":
    "Коли той самий файл є з обох боків",
  "Keep whichever is newer": "Лишати новіший",
  "This first run is the only one that can overwrite a file with the other side's version. Every run after it compares both sides and keeps conflicts.":
    "Тільки цей перший запуск може перезаписати файл версією з іншого боку. Кожен наступний порівнює обидві сторони й зберігає конфлікти.",
  Start: "Почати",

  // ---------- дрібні вікна ----------
  "Link to this file": "Посилання на цей файл",
  "Anyone with the link can open the file. Remove the link again in the provider's own web interface.":
    "Файл відкриє будь-хто, хто має посилання. Прибрати посилання можна у вебінтерфейсі самого сервісу.",
  Copy: "Копіювати",
  Done: "Готово",
  "Choose folders": "Обрати теки",
  "Select all": "Обрати всі",
  Encrypted: "Зашифровано",
  OK: "Гаразд",

  // ---------- одиниці ----------
  GB: "ГБ",
  MB: "МБ",
  kB: "кБ",
  "GB/s": "ГБ/с",
  "MB/s": "МБ/с",
  "kB/s": "кБ/с",
  "B/s": "Б/с",
};
