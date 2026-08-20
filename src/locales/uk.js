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

  "b2.where": `Обидва значення беруться зі сторінки
    <a href="https://secure.backblaze.com/app_keys.htm" class="ext">Application Keys</a>
    у вашому обліковому записі Backblaze: створіть ключ і скопіюйте дві
    величини, які він покаже один раз. Ключ, зроблений для одного відра,
    бачить лише його.`,
  "Key ID": "Ідентифікатор ключа",
  "Application key": "Ключ застосунку",
  "Key ID and Application key are required.":
    "Потрібні ідентифікатор ключа і ключ застосунку.",

  "jotta.token": `Створюється на сторінці безпеки вашого облікового запису —
    <a href="https://www.jottacloud.com/web/secure" class="ext">jottacloud.com → Security</a>
    → Generate personal login token. Він використовується один раз, щоб
    впустити цей комп'ютер; далі Jottacloud тримає Monti в системі сам.`,
  "Personal login token": "Персональний токен входу",
  "A personal login token is required.": "Потрібен персональний токен входу.",

  "storj.where": `Обидва беруться в
    <a href="https://storj.io/login" class="ext">консолі Storj</a>. Грант
    доступу — коротший шлях, бо вже містить парольну фразу шифрування: саме
    нею зашифровані файли, і лише вона здатна зробити їх читаними знову.`,
  "The console does not hand you this one — you chose it there yourself, and it is what the console asks for before it will show your files. Storj never receives it, because files are encrypted on this computer: nobody can look it up or reset it, so written down somewhere safe it is the only copy that matters. Nor is it checked when you connect — another phrase is accepted just as readily and opens an empty drive, because the file names are encrypted too.":
    "Цю фразу консоль не видає — ви самі її там придумали, і саме її консоль питає, перш ніж показати ваші файли. Storj її ніколи не отримує, бо файли шифруються на цьому комп'ютері: підглянути чи скинути її нікому, тож записана в надійному місці вона єдина, що має значення. І її ніхто не перевіряє під час входу — інша фраза підійде так само легко й відкриє порожній диск, бо імена файлів теж зашифровані.",
  "Sign-in method": "Спосіб входу",
  "Access grant": "Грант доступу",
  "Satellite, API key and passphrase": "Сателіт, ключ API і парольна фраза",
  Satellite: "Сателіт",
  "Encryption passphrase": "Парольна фраза шифрування",
  "An access grant is required.": "Потрібен грант доступу.",
  "An API key and an encryption passphrase are required.":
    "Потрібні ключ API і парольна фраза шифрування.",

  "koofr.password": `Не той пароль, яким ви входите: Koofr хоче пароль,
    зроблений для застосунків, — у
    <a href="https://app.koofr.net/app/admin/preferences/password" class="ext">Налаштуваннях → Пароль</a>.
    Облікові записи з двофакторною автентифікацією працюють саме так, а такий
    пароль можна відкликати окремо.`,
  "Other Koofr-compatible service": "Інший сервіс, сумісний з Koofr",
  "API endpoint": "Адреса API",
  "(only for other services)": "(тільки для інших сервісів)",
  "App password": "Пароль для застосунку",
  "E-mail and app password are required.": "Потрібні пошта і пароль для застосунку.",
  "An API endpoint is required for other Koofr-compatible services.":
    "Для інших сервісів, сумісних з Koofr, потрібна адреса API.",

  "mega.password": `Пароль від самого облікового запису, не ключ відновлення.
    Окремих паролів для застосунків MEGA не має: якщо на обліковому записі
    увімкнено двофакторну автентифікацію, rclone увійти не зможе.`,
  "E-mail": "Пошта",
  "E-mail and password are required.": "Потрібні пошта і пароль.",

  "proton.password": `Пароль від облікового запису. Двопарольний режим Proton,
    де поштова скринька має власний другий пароль, не підтримується.`,
  "proton.2fa": `Код використовується один раз, просто зараз, — натисніть
    «Підключити», доки він ще дійсний. Далі Proton впускає Monti самостійно.`,
  "Two-factor code": "Код двофакторної автентифікації",
  "(only if your account asks for one)": "(лише якщо ваш обліковий запис його просить)",

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
  unchanged: "без змін",
  "Sign-in": "Вхід",
  "Change…": "Змінити…",
  "Saved on this computer.": "Збережено на цьому комп'ютері.",
  "Signed in as {who}": "Вхід виконано як {who}",
  "{name} — sign in again": "{name} — увійти знову",
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

  // ---------- рядки, які малює JavaScript ----------

  // помилки входу
  "Google refused the sign-in (403 access_denied): the Google account you signed in with is not on your app's test-user list.\n\nFix: open console.cloud.google.com/auth/audience → Test users → Add users → add your own e-mail → Save, then try again.":
    "Google відмовив у вході (403 access_denied): обліковий запис, яким ви увійшли, не внесено до списку тестових користувачів вашого застосунку.\n\nЯк виправити: відкрийте console.cloud.google.com/auth/audience → Test users → Add users → додайте власну пошту → Save і спробуйте ще раз.",
  "Google rejected the API key (invalid_client): the Client ID or Client secret has a typo. Copy both values again from console.cloud.google.com/apis/credentials.":
    "Google не прийняв ключ API (invalid_client): у Client ID або Client secret є помилка. Скопіюйте обидва значення заново з console.cloud.google.com/apis/credentials.",
  "Another authorization is still waiting in some browser tab (port 53682 is busy). Close old rclone/Google tabs, wait a few seconds and try again.":
    "У якійсь вкладці браузера ще чекає попередній вхід (порт 53682 зайнято). Закрийте старі вкладки rclone/Google, зачекайте кілька секунд і спробуйте знову.",

  // вибір тек
  "1 folder left out: {folder}": "одну теку виключено: {folder}",
  "{n} folders left out": { one: "{n} теку виключено", few: "{n} теки виключено", many: "{n} тек виключено", other: "{n} тек виключено" },
  "Reading the cloud…": "Читаємо хмару…",
  "This folder has no subfolders.": "У цій теці немає підтек.",
  "Folders of \"{name}\"": "Теки диска «{name}»",
  "Unticked folders are left out of the mounted drive: they stay in the cloud, they just do not appear on this computer.":
    "Зняті позначки виключають теки з підключеного диска: у хмарі вони лишаються, просто не з'являються на цьому комп'ютері.",
  "Folders to sync": "Теки для синхронізації",
  "Unticked folders are not synced: they stay as they are on both sides, and Monti stops comparing them.":
    "Зняті позначки виключають теки із синхронізації: з обох боків вони лишаються як є, Monti просто перестає їх звіряти.",
  "Pick the cloud first — its folders are what you choose from.":
    "Спершу оберіть хмару — теки беруться саме з неї.",

  // рушій
  "engine not installed": "рушій не встановлено",
  "engine running": "рушій працює",
  "engine failed": "рушій не запустився",
  "engine stopped": "рушій зупинився",
  "restarting…": "перезапускається…",
  "{which} is no longer mounted — something unmounted it outside Monti. Press Mount on the drive to bring the folder back.":
    "{which} більше не підключено — щось від'єднало диск поза Monti. Натисніть «Підключити» на диску, щоб повернути теку.",
  "Monti: a drive disconnected": "Monti: диск від'єднано",
  "{which} is no longer mounted. Open Monti and press Mount.":
    "{which} більше не підключено. Відкрийте Monti й натисніть «Підключити».",
  "The rclone engine stopped unexpectedly — your drives are disconnected. Press “Restart engine” to bring them back.":
    "Рушій rclone несподівано зупинився — диски від'єднано. Натисніть «Перезапустити рушій», щоб повернути їх.",
  "Monti: your drives are disconnected": "Monti: диски від'єднано",
  "The rclone engine stopped. Open Monti and press “Restart engine”.":
    "Рушій rclone зупинився. Відкрийте Monti й натисніть «Перезапустити рушій».",
  "The engine isn't running.": "Рушій не працює.",

  // квота й активність
  "{used} of {total} used in the cloud": "{used} з {total} зайнято в хмарі",
  "{used} used in the cloud": "{used} зайнято в хмарі",
  "{n} files · {speed}": { one: "{n} файл · {speed}", few: "{n} файли · {speed}", many: "{n} файлів · {speed}", other: "{n} файлів · {speed}" },

  // чипи на картці диска
  mounted: "підключено",
  "Uploading changes to the cloud": "Вивантажуємо зміни до хмари",
  syncing: "синхронізація",
  "Mounted outside Monti (e.g. a systemd service).":
    "Підключено поза Monti (наприклад, службою systemd).",
  "mounted · system": "підключено · система",
  "not mounted": "не підключено",
  "The encrypted copy is stored here": "Тут зберігається зашифрована копія",
  "Connected through your own API key": "Підключено через власний ключ API",
  "own key": "власний ключ",
  "Read-only: files cannot be changed": "Лише читання: файли не можна змінювати",
  "read-only": "лише читання",
  "in {name}": "у {name}",
  encrypted: "зашифрований",
  "{size} cached on this computer": "{size} у кеші на цьому комп'ютері",

  // дії з диском
  "Open folder": "Відкрити теку",
  Unmount: "Від'єднати",
  Mount: "Підключити",
  Remove: "Видалити",
  "Uploads are still running": "Вивантаження ще триває",
  "{n} file(s) from \"{name}\" have not reached the cloud yet.":
    { one: "{n} файл з диска «{name}» ще не дістався хмари.", few: "{n} файли з диска «{name}» ще не дісталися хмари.", many: "{n} файлів з диска «{name}» ще не дісталися хмари.", other: "{n} файлів з диска «{name}» ще не дісталися хмари." },
  "Unmounting pauses the upload; it resumes the next time you mount the drive.":
    "Від'єднання призупиняє вивантаження; воно продовжиться, коли ви підключите диск знову.",
  "Until then those changes exist only on this computer.":
    "До того часу ці зміни існують лише на цьому комп'ютері.",
  "Shutting the computer down before the next mount can lose them.":
    "Якщо вимкнути комп'ютер до наступного підключення, їх можна втратити.",
  "Unmount anyway": "Все одно від'єднати",
  "Unmount \"{name}\"?": "Від'єднати «{name}»?",
  "This drive was mounted outside Monti — by a systemd service or a manual rclone mount.":
    "Цей диск підключено поза Monti — службою systemd або запуском rclone вручну.",
  "Close any app still using files there first.":
    "Спершу закрийте програми, які ще працюють із файлами звідти.",
  "A service that manages this mount may bring it back, or may need to be disabled separately.":
    "Служба, яка керує цим підключенням, може повернути його назад — тоді її треба вимкнути окремо.",
  "Unsaved changes in files that are still open would be lost.":
    "Незбережені зміни у відкритих файлах буде втрачено.",
  "Files in the cloud are not touched.": "Файли в хмарі лишаються недоторканими.",
  "The saved sign-in for this drive is removed from the rclone config on this machine.":
    "Збережений вхід для цього диска буде прибрано з налаштувань rclone на цій машині.",
  "The empty mount folder {folder} is removed.": "Порожню теку підключення {folder} буде видалено.",
  "Disconnect \"{name}\" from this computer?": "Від'єднати «{name}» від цього комп'ютера?",
  "The drive disappears from Monti. You can add it back later by signing in again.":
    "Диск зникне з Monti. Пізніше його можна додати знову, увійшовши ще раз.",
  Disconnect: "Від'єднати",
  "Also delete {size} of cached file copies": "Також видалити {size} кешованих копій файлів",
  "Share a file": "Поділитися файлом",
  "Get a link to a file in this drive": "Отримати посилання на файл із цього диска",
  Copied: "Скопійовано",
  "Press Ctrl+C": "Натисніть Ctrl+C",
  "Auto-mount of “{name}” failed: {error}":
    "Автопідключення «{name}» не вдалося: {error}",
  "“{name}” is not mounted yet — trying again in {wait}s. Right after login this usually means the network is still coming up.":
    "«{name}» ще не підключено — спробуємо знову через {wait} с. Одразу після входу це зазвичай означає, що мережа ще піднімається.",

  // розклад синхронізації
  manual: "вручну",
  "when Monti starts": "під час запуску Monti",
  "every 15 minutes": "кожні 15 хвилин",
  "every hour": "щогодини",

  // картка синхронізації
  ready: "готово",
  "not synced yet": "ще не синхронізовано",
  "last sync {when} UTC": "остання синхронізація {when} UTC",
  "last sync failed: {error}": "остання синхронізація не вдалася: {error}",
  "never synced": "жодного разу не синхронізовано",
  Stop: "Зупинити",
  "Sync now": "Синхронізувати",
  "Settings for this pair": "Налаштування цієї пари",
  "\"{name}\" has not been synced yet. Monti will compare {local} and {remote} and make them match.":
    "«{name}» ще не синхронізовано. Monti звірить {local} і {remote} та зробить їх однаковими.",
  "Measuring the cloud folder…": "Вимірюємо теку в хмарі…",
  "{n} files": { one: "{n} файлі", few: "{n} файлах", many: "{n} файлах", other: "{n} файлах" },
  "The cloud side holds {size} in {files}.": "У хмарі — {size} у {files}.",
  "The cloud side holds {size} in {files}; this computer has {free} free.":
    "У хмарі — {size} у {files}; на цьому комп'ютері вільно {free}.",
  "It will not all fit — leave some folders out first.":
    "Усе це не вміститься — спершу виключіть частину тек.",
  "Sync of \"{name}\" could not start: {error}":
    "Синхронізація «{name}» не почалася: {error}",
  "Files were deleted": "Файли було видалено",
  "{n} of {total} file(s) are gone from one side of \"{name}\". Syncing will remove them from the other side too.":
    { one: "{n} з {total} файлів зник з одного боку пари «{name}». Синхронізація видалить його і з другого боку.", few: "{n} з {total} файлів зникли з одного боку пари «{name}». Синхронізація видалить їх і з другого боку.", many: "{n} з {total} файлів зникли з одного боку пари «{name}». Синхронізація видалить їх і з другого боку.", other: "{n} з {total} файлів зникли з одного боку пари «{name}». Синхронізація видалить їх і з другого боку." },
  "Files are gone from one side of \"{name}\". Syncing will remove them from the other side too.":
    "З одного боку пари «{name}» зникли файли. Синхронізація видалить їх і з другого боку.",
  "on this computer: {path}": "на цьому комп'ютері: {path}",
  "in the cloud: {path}": "у хмарі: {path}",
  "if this is not what you expected, cancel and check both folders first":
    "якщо ви такого не очікували — скасуйте й спершу перевірте обидві теки",
  "Delete them": "Видалити їх",
  "Stop asking for this pair": "Більше не питати для цієї пари",
  "syncing — {n} file(s), {size}": { one: "синхронізація — {n} файл, {size}", few: "синхронізація — {n} файли, {size}", many: "синхронізація — {n} файлів, {size}", other: "синхронізація — {n} файлів, {size}" },
  "syncing — checking {n} file(s)": { one: "синхронізація — перевіряємо {n} файл", few: "синхронізація — перевіряємо {n} файли", many: "синхронізація — перевіряємо {n} файлів", other: "синхронізація — перевіряємо {n} файлів" },
  "Sync of \"{name}\" failed: {error}": "Синхронізація «{name}» не вдалася: {error}",
  "Monti: sync failed": "Monti: синхронізація не вдалася",
  "\"{name}\" did not finish: {error}": "«{name}» не завершилася: {error}",

  // конфлікти
  "{n} file(s) changed on both sides": { one: "{n} файл змінено з обох боків", few: "{n} файли змінено з обох боків", many: "{n} файлів змінено з обох боків", other: "{n} файлів змінено з обох боків" },
  "no current version — both sides were renamed":
    "поточної версії немає — перейменовано обидві сторони",
  "keep current": "лишити поточний",
  "Delete this older copy": "Видалити цю старішу копію",
  "keep this": "лишити цей",
  "Put this copy back under the original name": "Повернути цю копію під первісною назвою",
  "keep both": "лишити обидва",
  "Rename it to “(copy)” and stop calling it a conflict":
    "Перейменувати на «(copy)» і більше не вважати конфліктом",

  // вікно пари
  "{name} — sync settings": "{name} — налаштування синхронізації",
  "Connect a cloud first — there is nothing to sync with.":
    "Спершу підключіть хмару — синхронізувати поки нема з чим.",
  "\"{name}\" will sync from scratch once": "«{name}» один раз синхронізується з нуля",
  "You changed which folders this pair carries.": "Ви змінили набір тек цієї пари.",
  "The next sync compares both sides fully and merges them, keeping the newer copy of anything that differs.":
    "Наступна синхронізація повністю звірить обидва боки й об'єднає їх, лишаючи новішу копію всього, що відрізняється.",
  "Nothing is deleted by that run, and folders you left out are simply not touched again.":
    "Той запуск нічого не видаляє, а виключені теки просто більше не чіпаються.",
  "Stop syncing \"{name}\"?": "Припинити синхронізацію «{name}»?",
  "Monti forgets this pair. Nothing is deleted:": "Monti забуде цю пару. Нічого не видаляється:",
  "{path} stays exactly as it is": "{path} лишається як є",
  "the two simply stop being kept the same": "їх просто перестають тримати однаковими",
  "Stop syncing": "Припинити синхронізацію",

  // вікно налаштувань диска
  "{name} — settings": "{name} — налаштування",
  "unchanged — enter a new one to replace": "без змін — введіть новий, щоб замінити",
  "Using your own API key.": "Використовується власний ключ API.",
  "Using rclone's shared key — it is being retired during 2026, switching to your own key is recommended.":
    "Використовується спільний ключ rclone — його згортають протягом 2026 року, тож радимо перейти на власний.",
  "{limit} · e.g. 10G": "{limit} · напр. 10G",
  "counting…": "рахуємо…",
  "nothing cached": "кеш порожній",
  "Unmount the drive first — rclone is using these files right now":
    "Спершу від'єднайте диск — зараз rclone працює з цими файлами",
  "Delete the downloaded copies kept on this computer":
    "Видалити завантажені копії, що лежать на цьому комп'ютері",
  "Clear the local cache?": "Очистити локальний кеш?",
  "{size} of downloaded copies of \"{name}\" will be deleted from this computer.":
    "{size} завантажених копій диска «{name}» буде видалено з цього комп'ютера.",
  "They download again the next time you open them.":
    "Наступного разу, коли ви їх відкриєте, вони завантажаться знову.",
  "\"{value}\" is not a size — try something like 500M or 10G.":
    "«{value}» — не розмір, спробуйте щось на кшталт 500M або 10G.",
  "\"{value}\" is not a duration — try something like 30m, 24h or 7d.":
    "«{value}» — не тривалість, спробуйте щось на кшталт 30m, 24h або 7d.",
  "Enter the Client secret that pairs with the new Client ID.":
    "Введіть Client secret, який відповідає новому Client ID.",
  "Enter the Client ID that pairs with this Client secret.":
    "Введіть Client ID, який відповідає цьому Client secret.",
  "Remount \"{name}\" now?": "Перепідключити «{name}» зараз?",
  "The folders you chose apply from the next mount on.":
    "Обраний набір тек діє з наступного підключення.",
  "Monti unmounts the drive and mounts it again — a few seconds.":
    "Monti від'єднає диск і підключить його знову — кілька секунд.",
  "Files open from that folder right now would lose their connection.":
    "Файли, відкриті зараз із тієї теки, втратять зв'язок.",
  Remount: "Перепідключити",

  // сховище й передавання
  "Only {left} left on this disk. Clear a drive's cache in its settings, or lower its cache size limit.":
    "На цьому диску лишилося {left}. Очистіть кеш диска в його налаштуваннях або зменшіть обмеження кешу.",
  "Monti: this disk is nearly full": "Monti: цей диск майже заповнений",
  "Only {left} left. Clear a drive's cache or lower its limit.":
    "Лишилося {left}. Очистіть кеш диска або зменшіть його обмеження.",
  "Nothing transferred since the engine started.": "Від запуску рушія нічого не передано.",
  "(unnamed)": "(без назви)",
  failed: "не вдалося",
  checked: "перевірено",
  "not installed": "не встановлено",

  // встановлення рушія
  "Downloading rclone… (10–40 MB)": "Завантажуємо rclone… (10–40 МБ)",
  "Downloading rclone… {percent}% of {size}": "Завантажуємо rclone… {percent}% з {size}",
  "Downloading rclone… {size}": "Завантажуємо rclone… {size}",
  "Done — installed to {path}. Takes effect on the next engine restart.":
    "Готово — встановлено у {path}. Подіє після наступного перезапуску рушія.",
  "Done!": "Готово!",
  "Tray isn't available on this desktop — closing the window quits Monti. (On Arch/Manjaro: install libayatana-appindicator.)":
    "На цьому робочому столі лотка немає — закриття вікна завершує Monti. (На Arch/Manjaro: встановіть libayatana-appindicator.)",

  // трей
  "{n} drive(s) are still uploading": { one: "{n} диск ще вивантажує файли", few: "{n} диски ще вивантажують файли", many: "{n} дисків ще вивантажують файли", other: "{n} дисків ще вивантажують файли" },
  "{drives} — open Monti to unmount anyway.":
    "{drives} — відкрийте Monti, щоб від'єднати попри це.",
  "“{name}” is still uploading": "«{name}» ще вивантажує файли",
  "{n} file(s) have not reached the cloud yet. Open Monti to unmount anyway.":
    { one: "{n} файл ще не дістався хмари. Відкрийте Monti, щоб від'єднати попри це.", few: "{n} файли ще не дісталися хмари. Відкрийте Monti, щоб від'єднати попри це.", many: "{n} файлів ще не дісталися хмари. Відкрийте Monti, щоб від'єднати попри це.", other: "{n} файлів ще не дісталися хмари. Відкрийте Monti, щоб від'єднати попри це." },
  "Could not mount “{name}”": "Не вдалося підключити «{name}»",
  "Could not unmount “{name}”": "Не вдалося від'єднати «{name}»",

  // додавання хмари
  "⏳ Connecting…": "⏳ Підключаємося…",
  "Server URL is required.": "Потрібна адреса сервера.",
  "Access key ID and Secret access key are required.":
    "Потрібні Access key ID і Secret access key.",
  "Endpoint is required for non-Amazon S3 services.":
    "Для сервісів S3, відмінних від Amazon, потрібна точка доступу.",
  "Add a drive first — an encrypted drive lives inside one.":
    "Спершу додайте диск — зашифрований диск живе всередині звичайного.",
  "A password is required — that is the whole point.":
    "Потрібен пароль — у ньому вся суть.",
  "The two passwords are not the same.": "Паролі не збігаються.",
  "Please confirm the password is written down: it cannot be recovered.":
    "Підтвердьте, що пароль записано: відновити його неможливо.",

  // трей
  "Open Monti": "Відкрити Monti",
  Quit: "Вийти",
  "Engine stopped": "Рушій зупинено",
  "Engine running": "Рушій працює",
  "Engine running · {mounted} of {total} mounted":
    "Рушій працює · підключено {mounted} з {total}",
  "Mount “{name}”": "Підключити «{name}»",
  "Unmount “{name}”": "Від'єднати «{name}»",
  "All {n} drives in Monti…": { one: "Усі {n} диск у Monti…", few: "Усі {n} диски у Monti…", many: "Усі {n} дисків у Monti…", other: "Усі {n} дисків у Monti…" },
  "Unmount all {n} drives": { one: "Від'єднати {n} диск", few: "Від'єднати всі {n} диски", many: "Від'єднати всі {n} дисків", other: "Від'єднати всі {n} дисків" },
  "Monti — engine stopped": "Monti — рушій зупинено",
  "Monti — no drives mounted": "Monti — жодного диска не підключено",
  "Monti — {n} drives mounted": { one: "Monti — підключено {n} диск", few: "Monti — підключено {n} диски", many: "Monti — підключено {n} дисків", other: "Monti — підключено {n} дисків" },

    // ---------- зашифрована конфігурація ----------
  "Your rclone config is locked": "Конфігурацію rclone захищено паролем",
  "unlock.what":
    "Той пароль, який rclone питає в терміналі, а не пароль від якогось із " +
    "дисків усередині. Зберігається в пам\'яті, на диск не записується.",
  "Config password": "Пароль конфігурації",
  Unlock: "Відкрити",
  "The saved password no longer opens this config.":
    "Збережений пароль більше не відкриває цю конфігурацію.",
  "That is not the password for this config file. It is the one rclone asks for when you run it in a terminal — not a password for any of the drives inside.":
    "Це не пароль від цього файлу конфігурації. Потрібен той, який rclone " +
    "питає під час запуску в терміналі, а не пароль котрогось із дисків усередині.",
  "drives.locked.hint":
    "Диски на місці — rclone не віддасть їх, доки не отримає пароль, яким " +
    "захищено конфігурацію на цьому комп\'ютері.",
  "Enter the password": "Ввести пароль",
  "The rclone config is still locked.": "Конфігурацію rclone так і не відкрито.",
  "The rclone config is locked.": "Конфігурацію rclone замкнено паролем.",
  "Open Monti and enter the password first.":
    "Відкрийте Monti і спершу введіть пароль.",

  // ---------- одиниці ----------
  GB: "ГБ",
  MB: "МБ",
  kB: "кБ",
  "MB/s": "МБ/с",
  "kB/s": "кБ/с",
  "B/s": "Б/с",
};
