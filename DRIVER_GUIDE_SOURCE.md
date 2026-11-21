# IS Driver — source material for the driver user guide

Snapshot: **is-driver `origin/master` @ `464a6c7`**, **is-fleet-backend `origin/main` @ `4c40c85`** (fetched 2026-11-18).
App version in code: `1.0.1`, Android `versionCode` 5 (`app.json`).
Everything below comes from the code. Anything the code can't settle is marked **UNKNOWN — check manually**.
UI labels are quoted from `locales/uk.json` / `locales/ru.json` as `key` → «UA» / «RU». Server-side texts (push titles, error messages) come from the backend's `src/i18n/i18n.ts` and are marked *(server)*.

---

## 1. INSTALL & FIRST SIGN-IN

### 1.1 How the driver gets the app today
- Android, Google Play, package `com.isfleet.isdriver`, name **IS Driver**.
- Track: the code doesn't decide this. Per `PLAY_RELEASE_PLAN.md` (a plan file, not code): Internal testing worked since 2026-10-27, **Closed testing (12 testers × 14 days) running since ~2 Nov**, Production application planned ~16 Nov. **UNKNOWN — check manually** in Play Console which track is live today and whether it's public.
- If it's still closed or internal testing, the driver needs: (1) a Gmail account added to the tester list, (2) to open the opt-in link and tap "Become a tester", (3) to install from Play with that same Google account. **UNKNOWN — check manually**: the exact opt-in link and tester list.
- iOS: a bundle id (`com.isfleet.isdriver`, iPhone only) and iOS permission texts are in the code, but nothing shows an App Store / TestFlight release. **UNKNOWN — check manually**. Don't promise iPhone.
- Updates: small updates arrive over the air (`expo-updates`, runtime = app version). When one has downloaded, the driver sees `update.title` «Доступне оновлення» / «Доступно обновление», body `update.body` «Нову версію застосунку завантажено. Перезапустити зараз, щоб застосувати?» / «Новая версия приложения загружена. Перезапустить сейчас, чтобы применить?», buttons `update.later` «Пізніше» / «Позже» and `update.restart` «Перезапустити» / «Перезапустить».
- The account must already exist: the manager creates the driver, with their phone number, in the web or manager app. The app has **no self-registration**.

### 1.2 Sign-in, step by step
**Screen 1 — phone** (`app/(auth)/phone.tsx`)
- Title `auth.phone.title` «Вхід» / «Вход». Subtitle `auth.phone.subtitle` «Введіть номер телефону — ми надішлемо одноразовий код у SMS.» / «Введите номер телефона — мы отправим одноразовый код по SMS.»
- The field is pre-filled with **`+48`**. Placeholder `+48 500 000 000`. The driver must replace it with **their own** country code. The number must be the one the manager saved, in international format: the server normalises it to `+` plus 8–16 digits.
- The button `auth.phone.sendCode` «Надіслати код» / «Отправить код» is enabled once there are ≥ 9 digits.
- **Unknown number:** the server still answers "ok" and sends nothing (it never reveals which numbers exist). The driver just won't get a code. Tell them: check the number with the manager.

**Screen 2 — code** (`app/(auth)/otp.tsx`)
- Title `auth.otp.title` «Введіть код» / «Введите код». Subtitle `auth.otp.subtitle` «Ми надіслали 6-значний код на {{phone}}.» / «Мы отправили 6-значный код на {{phone}}.»
- Code: **6 digits**. Button `auth.otp.verify` «Підтвердити» / «Подтвердить». Link `auth.otp.changePhone` «Змінити номер телефону» / «Изменить номер телефона».
- **SMS code lifetime: 5 minutes.** One code allows **5 wrong attempts**, then it's locked. A code is single-use. A successful login burns every pending code for that phone.
- **Resend cooldown: 60 seconds per method.** The server also throttles: 3 code requests per minute per phone, and 10 verify attempts per minute per phone.
- **The 30-second countdown:** under the button the driver sees `auth.otp.fallback.countdown` «Не прийшов код? Інші способи — через {{seconds}} с» / «Не пришёл код? Другие способы — через {{seconds}} с». After 30 s a box appears, titled `auth.otp.fallback.title` «Не отримали код?» / «Не получили код?», listing the methods that are on **both** in the app (`app.json → extra`) **and** on the server (`POST /auth/driver/otp-channels`).
- After a successful sign-in: with a truck assigned → the **Trip** screen. Without a truck → the **Chat** screen.
- If the account is not a driver (manager, admin): `auth.errors.driverOnly` «Цей застосунок лише для водіїв. Увійдіть під акаунтом водія.» / «Это приложение только для водителей. Войдите под аккаунтом водителя.»

**Sign-in methods, ON / OFF**

| Method | Button label (UA / RU) | App flag (`app.json`) | Server default (code) | Effective in production |
|---|---|---|---|---|
| SMS | first SMS goes out automatically; re-send = `auth.otp.fallback.sms` «Надіслати SMS ще раз» / «Отправить SMS ещё раз» | `LOGIN_SMS_ENABLED=true` | on | **ON** (unless the Render env says otherwise) |
| Email the code to the truck's manager | `auth.otp.fallback.manager` «Надіслати код менеджеру на пошту» / «Отправить код менеджеру на почту» | `LOGIN_MANAGER_EMAIL_ENABLED=true` | on | **ON** (unless the Render env says otherwise) |
| Manager generates a code on the driver card | `auth.otp.fallback.manager_code` «Попросити менеджера згенерувати код» / «Попросить менеджера сгенерировать код» | `MANAGER_LOGIN_CODE_ENABLED=true` | **off** | **OFF by default.** Shows only if Render has `MANAGER_LOGIN_CODE_ENABLED=true` |
| WhatsApp | `auth.otp.fallback.whatsapp` «Надіслати у WhatsApp» | `false` | off | **OFF** |
| Telegram | `auth.otp.fallback.telegram` «Надіслати у Telegram» | `false` | off (also needs gateway credentials) | **OFF** |

**UNKNOWN — check manually**: the real values of `LOGIN_SMS_ENABLED`, `LOGIN_MANAGER_EMAIL_ENABLED` and `MANAGER_LOGIN_CODE_ENABLED` on Render. `GET /auth/features` only reports `managerLoginCode`. Quick check: open the code screen, wait 30 s, and see which buttons appear.

Manager-method details:
- Under the manager options the driver sees `auth.otp.fallback.managerNote` «Код отримає менеджер вашої вантажівки — зателефонуйте йому, він передасть вам код. Про вхід за кодом менеджера вам напише IS Fleet contact у чаті.» / «Код получит менеджер вашего грузовика — позвоните ему, он передаст вам код. О входе по коду менеджера вам напишет IS Fleet contact в чате.»
- After tapping: `auth.otp.fallback.sent.manager` «Код надіслано вашому менеджеру на пошту. Зателефонуйте йому — він продиктує код (діє 15 хв).» / «Код отправлен вашему менеджеру на почту. Позвоните ему — он продиктует код (действует 15 мин).»
- A manager code lives **15 minutes**. It goes **only** to the manager of the driver's **current truck**. If there's no truck, no manager, or the manager has no email → **nothing is sent, and the app still says "sent"**. A guide must say: this works only when you already have a truck with a manager.
- After a sign-in by manager code, the driver gets a message in the chat from "IS Fleet contact" (the server sends notices when the code is issued and when it's used). **UNKNOWN — check manually**: the exact wording of those notices.
- Re-send SMS: `auth.otp.fallback.sent.sms` «Нове SMS надіслано.» / «Новое SMS отправлено.»
- Generic failure: `auth.otp.fallback.failed` «Не вдалося надіслати код. Спробуйте ще раз.» / «Не удалось отправить код. Попробуйте ещё раз.»
- If "Send code" is pressed again within 60 s, the app silently goes straight to the code screen. The previous code is still valid.

### 1.3 How long the driver stays signed in
- Access token: 15 min. It refreshes silently in the background.
- **Driver refresh session: 90 days, sliding.** Every refresh restarts the 90 days, so a driver who opens the app at least once every 90 days stays signed in indefinitely.
- **Never signed out by:** no internet, tunnels, roaming, border crossings, a captive portal / Cloudflare page, or the server being down. The app keeps the session and retries (`lib/session-errors.ts`, `store/auth.ts`).
- **Signed out when:** (a) they tap «Вийти з акаунту»; (b) they delete the account; (c) the server rejects the session — 90 days without opening the app, a revoked token, or the user is no longer a driver (role changed). Deactivating or removing the driver also ends the session. **UNKNOWN — check manually** that deactivation rejects the refresh right away.
- **Company deactivated:** the driver stays signed in, but any write action shows `chat.companyDeactivatedNotice` «На жаль, зараз ви не можете використовувати застосунок у повному обсязі.» / «К сожалению, сейчас вы не можете использовать приложение в полном объёме.»

### 1.4 Permissions

| Permission | When asked | If denied |
|---|---|---|
| Notifications | when the app registers for push after sign-in (`lib/push.ts`) | no pushes at all, no message shown. Fix only in phone settings |
| Camera | first time «Камера» is chosen in an upload / attach sheet | **nothing happens**: the sheet closes silently |
| Photos / gallery (pick) | first time «Галерея» is chosen | silently nothing (chat / documents). For the profile photo: alert `settings.errors.photoPermTitle` «Доступ до фото» / «Доступ к фото» + `settings.errors.photoPermBody` «Дозволь доступ до галереї щоб обрати фото профілю.» / «Разрешите доступ к галерее, чтобы выбрать фото профиля.» Bug-report screenshot: `bugReport.permissionTitle` «Немає доступу» / «Нет доступа» |
| Photos (save) | first «Зберегти» in the photo viewer (write-only access) | `gallery.permissionTitle` «Немає доступу до галереї» / «Нет доступа к галерее» + `gallery.permissionBody` «Дозвольте збереження фото в налаштуваннях телефона.» / «Разрешите сохранение фото в настройках телефона.» |
| Microphone | first hold of the mic button (voice message) | `voice.micDenied` «Немає доступу до мікрофона. Дозвольте його в налаштуваннях телефону.» / «Нет доступа к микрофону. Разрешите его в настройках телефона.» |
| Files | system file picker, no permission needed | — |
| "Do not disturb" access (Android) | not asked automatically. Settings → «Надійні сповіщення» opens the system screen | the alarm may stay silent in DND |

Android blocks the broad READ_MEDIA_IMAGES/VIDEO permissions (the system photo picker is used instead). Location is never requested.

---

## 2. EVERY SCREEN THE DRIVER CAN REACH

### 2.0 Navigation shell — side drawer (`app/(driver)/_layout.tsx`)
- Drawer items (`nav.items.*`): `trip` «Рейс» / «Рейс», `trips` «Мої рейси» / «Мои рейсы», `truck` «Моя вантажівка» / «Мой грузовик», `documents` «Документи» / «Документы», `chat` «Чат» / «Чат», `alarm` «Будильник» / «Будильник».
- Drawer top bar: bug-report button, a bell with an unread badge (preview panel; empty = `nav.noUnread` «Немає непрочитаних» / «Нет непрочитанных»), and a theme toggle.
- Footer: driver name + phone, the presence status (tap opens the status picker), a gear icon → Settings. Below it, the manager row (name, status): tap → Manager screen, phone icon = `nav.callManager` «Зателефонувати менеджеру» / «Позвонить менеджеру», chat icon = `nav.messageManager` «Написати менеджеру» / «Написать менеджеру».
- Calling: Android opens the dialer chooser. iPhone asks `call.phone` «Телефон» / «Телефон» or "Viber". If Viber is missing: `call.viberMissing` «Viber не встановлено на цьому телефоні.» / «Viber не установлен на этом телефоне.»
- **Report a problem** (header bug icon, `components/header-actions.tsx`): `bugReport.title` «Повідомити про проблему» / «Сообщить о проблеме», `bugReport.subtitle` «Опишіть, що пішло не так. Можна додати скріншот.» / «Опишите, что пошло не так. Можно приложить скриншот.», placeholder `bugReport.placeholder` «Що сталося?» / «Что случилось?», `bugReport.attach` «Додати скрін» / «Добавить скрин» (up to 5 screenshots, 10 MB each, server limit), `bugReport.send` «Надіслати» / «Отправить». Success: `bugReport.sentTitle` «Готово» + `bugReport.sent` «Дякуємо! Репорт надіслано.» / «Спасибо! Отчёт отправлен.»

### 2.1 Trip — the current trip and its chat (`app/(driver)/trip.tsx`)
Opens on the **active** trip. "Active" = a not-yet-delivered trip on the driver's current truck, where in-progress statuses beat ASSIGNED and the oldest comes first. Opening it from «Мої рейси» shows that particular trip.
- **Header:** menu, truck plate, notification bell, **status picker** (coloured badge + ▼).
- **No trip:** `trip.noActiveTrip.title` «Немає активного рейсу» / «Нет активного рейса», `trip.noActiveTrip.subtitle` «Коли менеджер призначить рейс, він з'явиться тут. Потягни вниз, щоб оновити.» / «Когда менеджер назначит рейс, он появится здесь. Потяни вниз, чтобы обновить.» Pull down to refresh.
- **Trip card** (folded by default; tap to unfold): trip title, `#orderNumber`, a folder icon with the file count (opens the trip documents), a ▼/▲ toggle.
  - Unfolded — **stops**, numbered when there are several, colour-coded:
    `trip.stops.loading` «Завантаження» / «Погрузка», `trip.stops.unloading` «Розвантаження» / «Разгрузка», `trip.stops.waypoint` «Додаткова зупинка» / «Дополнительная остановка» (or the waypoint's own name).
  - **Address**, always shown in full: tap it or its copy icon → copied to the clipboard. No visual confirmation of the copy.
  - **Reference number** chip `# …`: tap → copied.
  - **Coordinates** chip: copy icon → copied. "Open" icon → opens `https://www.google.com/maps?q=<coords>` (Google Maps or the browser). There is **no** "open address in maps" button — only coordinates open in maps.
  - **Time window** chip ⏱: date + from–to (stored as text, shown as the manager typed it).
  - **Trip notes** from the manager, in red, below the stops.
- **Next trip strip** (when another undelivered trip is queued): `trip.nextTripLabel` «Наступний: {{title}}» / «Следующий: {{title}}», hint `trip.nextTripHint` «Стане активним після завершення поточного» / «Станет активным после завершения текущего».
- **Trip chat:** label `trip.chatLabel` «Чат рейсу» / «Чат рейса», connection `trip.online` «онлайн» / `trip.connecting` «під'єднання…» / «подключение…». Empty: `chat.emptyChat` «Повідомлень ще немає. Почніть розмову.» / «Сообщений пока нет. Начните разговор.» Input placeholder `chat.messagePlaceholder` «Повідомлення…» / «Сообщение…». The attach button opens `trip.attachSheet.title` «Прикріпити» / «Прикрепить» with «Камера» / «Галерея» / «Файл». Voice: hold the mic (`voice.holdHint` «Утримуйте мікрофон, щоб записати» / «Удерживайте микрофон для записи»), release (`voice.release` «Відпустіть, щоб зупинити» / «Отпустите, чтобы остановить»), then listen and `voice.send` «Надіслати голосове» / «Отправить голосовое» or `voice.cancel` «Скасувати запис» / «Отменить запись». "N new" jump button: `trip.newCount` «{{count}} нове/нові/нових».
  - Long-press a message → sheet with `common.reply` «Відповісти» / «Ответить», `common.copy` «Копіювати» / «Копировать», `common.edit` «Редагувати» / «Изменить» (own messages, **within 24 h**), `common.delete` «Видалити» / «Удалить» (own). Plus emoji reactions.
  - Read-only banners: queued trip → `trip.queuedChatNotice` «Писати в цей чат можна буде, коли рейс стане поточним.» / «Писать в этот чат можно будет, когда рейс станет текущим.». No longer a participant → `trip.readOnlyNotice` «Ви більше не учасник цього чату — перегляд тільки для читання.» / «Вы больше не участник этого чата — только для чтения.»
- **Trip documents modal:** `trip.docsTitle` «Документи рейсу» / «Документы рейса», tabs `documents.tabs.all` «Усі» / «Все», `documents.tabs.photos` «Фото», `documents.tabs.documents` «Документи» / «Документы», button `common.upload` «Завантажити» / «Загрузить». Empty: `documents.nothingHere` «Тут поки порожньо.» / «Здесь пока пусто.»

**Status change**
- Statuses in order (`constants/trip-status.ts`, `tripStatus.*`):
  1. `ASSIGNED` «Призначено» / «Назначен»
  2. `ACCEPTED` «Прийнято» / «Принят»
  3. `ON_WAY` «В дорозі» / «В пути»
  4. `ON_SITE` «На місці» / «На месте»
  5. `LOADED` «Завантажено» / «Загружен»
  6. `DELIVERED` «Доставлено» / «Доставлен»
- **Who can set what:** the driver's picker offers **all six, in any order, with no confirmation**. The server (`PATCH /trips/:id/driver-status`) also accepts any status on the driver's own trip. Managers can set any status from their side. Some changes happen automatically: OK on "new trip" → ACCEPTED; Yes on "heading to loading?" → ON_WAY; moving a trip to another truck resets it to ASSIGNED.
- **What the manager sees:** after each driver change, the trip's manager gets a push *(server)* `push.tripStatusTitle` «Статус рейсу» / «Статус рейса» with body «{{plate}} · {{title}}: {{status}}», plus a live coloured banner on web/desktop. Lists update live.
- There's **no "Unloaded / Unloading" status**: «Доставлено» is the final one. Once DELIVERED, the next queued trip becomes the active one.

**"Heading to loading?" prompt** (`components/push-notice-overlay.tsx`, backend `trips.service.ts`)
- Sent when a trip becomes ACCEPTED and nothing else is in progress, or when the current load is DELIVERED and an accepted trip is next.
- Title `push.departTitle` «Вирушаємо на завантаження?» / «Выезжаем на погрузку?». Body: the trip title + the loading address. Buttons `push.yes` «Так» / «Да» and `push.no` «Ні» / «Нет». The same buttons appear on the lock-screen banner.
- «Так» → status ON_WAY. «Ні», or no answer → asked again **in 20 minutes**. After the **3rd** ask without a Yes, the manager is told *(server)* «Водій ще не виїхав» / «Водитель ещё не выехал»: «{{plate}} · {{title}}: виїзд не підтверджено після 3 нагадувань». Then the app stops asking.

**New trip prompt**
- A new trip assigned (or moved to the driver's truck) → push / in-app window titled `push.newTripTitle` «Нове завантаження» / «Новая погрузка» (push title *(server)* `push.newLoading`, same text). Body: order no · title, `trip.nextAssigned.loadingAt` «Завантаження: {{address}}» / «Загрузка: {{address}}» + time window, plate. One button `push.ok` «OK» → trip becomes **ACCEPTED** (even while another trip is in progress).
- When the current trip turns DELIVERED and a queued one is waiting, the app asks about it the same way. OK accepts it and opens it.

### 2.2 My trips (`app/(driver)/trips.tsx`)
- Search `trips.searchPlaceholder` «Пошук за маршрутом, № замовлення, адресою…» / «Поиск по маршруту, № заказа, адресу…» (matches title, order no, plate, stop address).
- Sections: `trips.active` «Активний» / «Активный», `trips.next` «Наступні» / «Следующие» (tag `trips.nextTag` «Наступний» / «Следующий»), `trips.done` «Завершені» / «Завершённые». Trips with unread chat come first inside each section. Tap → opens that trip on the Trip screen.
- Empty: `trips.empty.title` «Рейсів ще немає» / «Рейсов пока нет», `trips.empty.subtitle` «Призначені тобі рейси з'являться тут.» / «Назначенные тебе рейсы появятся здесь.», button `trips.writeManager` «Написати менеджеру» / «Написать менеджеру». No results: `trips.noMatches.title` «Нічого не знайдено», `trips.noMatches.subtitle` «Спробуй інший запит.» / «Попробуй другой запрос.»
- Only trips where the driver is the **current** driver are listed. A trip moved to another driver disappears from the list.

### 2.3 Documents (`app/(driver)/documents.tsx`)
- One **folder per trip** of the driver's **current truck**, including earlier drivers' trips on that truck. The active trip comes first, marked `documents.active` «Активний» / «Активный». Voice messages are excluded.
- Search `documents.searchPlaceholder` «№ рейсу, дата або індекс…» / «№ рейса, дата или индекс…» (trip no, date, postcode).
- No truck: `truck.noTruck.title` «Вантажівку не призначено» / «Грузовик не назначен» + `documents.noTruck.subtitle` «Документи прив'язані до вантажівки. Щойно менеджер її призначить, вони з'являться тут.» / «Документы привязаны к грузовику. Как только менеджер его назначит, они появятся здесь.»
- Empty: `documents.empty.title` «Документів ще немає» / «Документов пока нет»; `documents.empty.subtitleActive` «Натисни «Завантажити», щоб додати фото чи файли для поточного рейсу.»; `documents.empty.subtitleInactive` «Коли з'явиться рейс із завантаженими файлами, вони будуть тут.» (RU: «Нажми «Загрузить»…», «Когда появится рейс…»).
- Inside a folder: tabs «Усі / Фото / Документи». **«Завантажити» appears only in the active trip's folder.** The sheet: `documents.uploadSheet.title` «Завантаження» / «Загрузка», `documents.uploadSheet.subtitle` «Оберіть джерело» / «Выберите источник», «Камера» / «Галерея» / «Файл».
  - Camera: one photo per shot. Gallery: several images at once. File: several files at once. Photos are compressed to JPEG on the phone.
  - **Limits (server):** up to **20 MB per file**, **10 files per upload**, 60 MB per upload in total. Profile photo: 10 MB.
  - **Allowed types:** JPG, PNG, WEBP, HEIC/HEIF (iPhone, converted to JPEG), GIF, PDF, Word/Excel (DOCX/XLSX and old DOC/XLS), TXT, CSV (+ voice audio in chat). Refused: SVG, HTML, archives, video, executables.
- Open a file: photos → in-app photo viewer (swipe, `gallery.save` «Зберегти» / «Сохранить» → `gallery.saved` «Збережено» / «Сохранено», `gallery.share` «Поділитися» / «Поделиться»). Other files → open externally. Failure: `documents.cannotOpen` «Не вдалось відкрити» / «Не удалось открыть».
- Delete: a trash icon is shown on **every** file. Confirm `documents.deleteConfirm.title` «Видалити?» / «Удалить?» + `documents.deleteConfirm.body` «{{name}} буде видалено назавжди.» / «{{name}} будет удалён навсегда.» The **server allows drivers to delete only their own uploads**. Others → *(server)* `errors.cannotDeleteDocument` «Ви не можете видалити цей документ» / «Вы не можете удалить этот документ». In chat the deleted file shows `common.fileDeleted` «Файл видалено» / «Файл удалён».

### 2.4 Chat directory — DMs and groups (`app/(driver)/chat.tsx`)
- Two tabs: «Чат» and `nav.groups` «Групи» / «Группы».
- **Chat tab:** search `chatDir.searchPlaceholder` «Пошук за іменем, телефоном чи авто…» / «Поиск по имени, телефону или авто…». Existing conversations come first (managers / team leads above drivers), then `chatDir.otherContacts` «Інші контакти» / «Другие контакты» = the company's managers, team leads (`chatDir.teamlead` «Тімлід» / «Тимлид») and drivers. Empty: `chatDir.noConversations` «Розмов ще немає.» / «Разговоров пока нет.»
- Hide a conversation (long-press): `chat.hideConfirm` «Видалити чат?» / «Удалить чат?» + `chat.hideConfirmBody` «Чат зникне з вашого списку. Співрозмовник цього не побачить, а листування повернеться після нового повідомлення.» / «Чат исчезнет из вашего списка. Собеседник этого не увидит, а переписка вернётся после нового сообщения.»
- **DM screen** (`dm/[userId].tsx`): same composer as the trip chat (text, camera / gallery / file, voice, reply / copy / edit / delete, reactions), typing indicator `chat.typingOne` «набирає» / «печатает», presence / last seen `common.lastSeen.label` «останній вхід {{when}}» / «последний вход {{when}}».
- **Groups tab:** the company-wide driver group, created automatically by the server under the name **"All Drivers"** (English, from the database; it is not translated). Member count `groups.memberCount` «{{count}} водій/водії/водіїв» / «водитель/водителя/водителей». Empty: `groups.empty.title` «Груп ще немає» / «Групп пока нет». Every active driver of the company is in it and can write there. Group screen `group/[groupId].tsx`: `chat.groupChat` «Груповий чат» / «Групповой чат», `chat.groupDocsTitle` «Документи групи» / «Документы группы».
- Drivers **cannot create groups** (`groups.tsx` is a placeholder hidden from the menu).
- Offline sending: text messages written without a connection are kept on the phone and sent later (for up to 7 days). If the server refuses one: `chat.outboxFailedTitle` «Не вдалося надіслати» / «Не удалось отправить» with `chat.outboxRetry` «Повторити» / «Повторить» and `chat.outboxDiscard` «Видалити» / «Удалить». **Files and voice messages are not queued offline.**

### 2.5 My truck (`app/(driver)/truck.tsx`)
- Plate + truck status badge `truck.status.AVAILABLE` «Вільна» / «Свободен», `ON_TRIP` «В рейсі» / «В рейсе», `REPAIR` «Ремонт» / «Ремонт».
- Manager row `truck.dispatcher` «Менеджер» / «Менеджер»: name · phone. Tap → call.
- **Notes** `truck.notes.title` «Нотатки ({{count}})» / «Заметки ({{count}})». Input `truck.notes.placeholder` «Додати нотатку (видно менеджеру)…» / «Добавить заметку (видна менеджеру)…». Empty: `truck.notes.empty` «Нотаток ще немає. Додай вище.» / «Заметок пока нет. Добавь выше.» Delete: `truck.notes.deleteTitle` «Видалити нотатку» / «Удалить заметку», `truck.notes.deleteBody` «Видалити цю нотатку?» / «Удалить эту заметку?». Error: `truck.notes.saveError` «Не вдалось зберегти нотатку. Спробуй ще раз.» / «Не удалось сохранить заметку. Попробуй ещё раз.»
- No truck: `truck.noTruck.title` + `truck.noTruck.subtitle` «Коли менеджер призначить тобі вантажівку, вона з'явиться тут.» / «Когда менеджер назначит тебе грузовик, он появится здесь.»

### 2.6 Manager card + rating (`app/(driver)/manager.tsx`)
- Opened from the drawer manager row (or the Truck screen). Shows avatar, name, average stars + `manager.ratingCount` «({{count}} оцінка/оцінки/оцінок)» or `manager.noRatings` «Ще немає оцінок» / «Пока нет оценок», `manager.info.email` «Email», `manager.info.phone` «Телефон».
- No manager: `manager.noManager` «Менеджера ще не призначено.» / «Менеджер ещё не назначен.»
- Rate: `manager.rate` «Оцінити менеджера» / «Оценить менеджера» (or `manager.updateRating` «Змінити мою оцінку» / «Изменить мою оценку»). The sheet: `manager.modal.title` «Оцініть менеджера» / «Оцените менеджера», 1–5 stars, `manager.modal.commentPlaceholder` «Коментар (необов'язково)» / «Комментарий (необязательно)», toggle `manager.modal.anonymous` «Залишити анонімно» / «Оставить анонимно», `manager.modal.submit` «Надіслати» / «Отправить». The driver's own rating is shown under `manager.yourRating` «Ваша поточна оцінка» / «Ваша текущая оценка». Others: `manager.reviews` «Відгуки ({{count}})» / «Отзывы ({{count}})».

### 2.7 Alarm (`app/(driver)/alarm.tsx`)
- **Who sets alarms:** the driver for themselves, **and** managers / team leads / admins of the company for the driver. Drivers can't set alarms for others.
- List `alarm.myAlarms` «Мої будильники ({{count}})» / «Мои будильники ({{count}})». An alarm set by someone else shows `alarm.from` «від {{name}}» / «от {{name}}». Recurrence `alarm.recurrence.NONE` «Один раз», `DAILY` «Щодня» / «Ежедневно», `WEEKLY` «Щотижня» / «Еженедельно».
- New: `alarm.new` «+ Новий» / «+ Новый» → `alarm.form.title` «Тема *», placeholder «напр. Зателефонувати клієнту» / «напр. Позвонить клиенту», `alarm.form.note` «Коментар» / «Комментарий», `alarm.form.when` «Коли» / «Когда» (date / time picker, quick +5 хв / +15 хв / +30 хв / +1 год / +2 год), `alarm.form.recurrence` «Повтор», `alarm.form.submit` «Створити» / «Создать». Errors: `alarm.errors.titleRequired` «Тема обов'язкова» / «Тема обязательна», `alarm.errors.createFailed` «Не вдалось створити будильник» / «Не удалось создать будильник».
- Row actions: **restart** `alarm.reuseTitle` «Перезапустити через…» / «Перезапустить через…» (quick offsets) and delete `alarm.deleteConfirm.title` «Видалити будильник?» / «Удалить будильник?». Empty: `alarm.empty.title` «Немає будильників», `alarm.empty.subtitle` «Натисни «+ Новий», щоб встановити нагадування.»
- **What the driver sees when it fires:** the server checks every minute. The push uses the alarm title as its title and the note as its body. Android: channel «Будильник» (`push.channels.alarm`) with the alarm sound **on the alarm stream**, so it rings in silent / vibrate mode, and through "Do not disturb" if access was granted. iOS: time-sensitive. It rings **even if the driver's status is Сплю / Відпочиваю** and even while the app is open (the system notification stays).

### 2.8 Notifications
- Android channels (system settings): `push.channels.chat` «Повідомлення та рейси» / «Сообщения и рейсы», `push.channels.alarm` «Будильник», `push.channels.other` «Інші сповіщення» / «Другие уведомления», `push.channels.fallback` «Повідомлення (резервний)» / «Сообщения (резервный)».
- While the app is on screen, chat pushes don't pop up as system banners: the in-app bell / badges / windows show them instead. Alarms always ring.
- **Pushes are suppressed when the driver's status is «Сплю» or «Відпочиваю»** (alarms excepted). They are also suppressed while the same account is actively in use on web/desktop (not relevant for drivers in practice).
- In-app generic notice: title `push.noticeTitle` «Сповіщення» / «Уведомление», button «OK».
- Tapping a push opens the related trip / chat (`lib/push-route.ts`).

### 2.9 Presence status (drawer footer / Settings → «Статус»)
- `presence.pickStatus` «Виберіть статус» / «Выберите статус»: `status.ONLINE` «Online» / «В сети», `status.BUSY` «Зайнятий» / «Занят», `status.AWAY` «Не на місці» / «Отошёл», `status.SLEEP` «Сплю» (30 хв / 2 години / 9 годин (короткий відпочинок) / 11 годин (регулярний відпочинок) / `presence.noLimit` «Без обмеження»), `status.VACATION` «Відпочиваю» / «Отдыхаю» (1 день / 3 дні / Тиждень / 2 тижні / без обмеження). The question is `presence.howLong` «На скільки?» / «На сколько?». Others see `status.OFFLINE` «Не в додатку» / «Не в приложении» when the app is closed.

### 2.10 Settings (`app/(driver)/settings.tsx`)
- `settings.title` «Налаштування» / «Настройки». Sections:
  - `settings.avatar.title` «Фото профілю» / «Фото профиля»: «Завантажити» / `settings.avatar.change` «Змінити» / «Изменить», `settings.avatar.remove` «Прибрати» / «Убрать».
  - `settings.status.title` «Статус».
  - `settings.name.title` «Імʼя та прізвище» / «Имя и фамилия», `settings.saveChanges` «Зберегти зміни» / «Сохранить изменения» → `settings.saved` «Зміни збережено ✓» / «Изменения сохранены ✓». **The phone number is shown but can't be edited.**
  - `settings.language.title` «Мова» / «Язык»: **English, Українська, Polski, Lietuvių, Русский** (5 languages). This also sets the language of server messages and pushes.
  - `settings.theme.title` «Тема»: «Система» / «Світла» / «Темна» («Система» / «Светлая» / «Тёмная»).
  - `settings.notifications.title` «Сповіщення» / «Уведомления»: `sound` «Звук», `vibration` «Вібрація» / «Вибрация» (in-app sound / vibration toggles).
  - Android only: `settings.reliable.title` «Надійні сповіщення» / «Надёжные уведомления» → `settings.reliable.notifications` «Сповіщення на заблокованому екрані», `settings.reliable.dnd` «Будильник у режимі «Не турбувати»», `settings.reliable.battery` «Батарея: без обмежень», plus the hint `settings.reliable.hint` (mentions Xiaomi / Redmi «Автозапуск»).
  - `settings.logout` «Вийти з акаунту» / «Выйти из аккаунта» → confirm `settings.logoutConfirm.title` «Вихід з акаунту», `body` «Точно вийти?», `confirm` «Вийти» / «Выйти».
  - `settings.deleteAccount` «Видалити акаунт» / «Удалить аккаунт» → `settings.deleteAccountConfirm.title` «Видалити акаунт?», body «Цю дію не можна скасувати. Ваші особисті дані буде стерто, а вхід стане неможливим назавжди. Рейси та листування залишаться в історії компанії знеособленими.» (RU: «Это действие нельзя отменить…»), `confirm` «Видалити назавжди» / «Удалить навсегда». Error: `settings.deleteAccountConfirm.error` «Не вдалося видалити акаунт».
  - Links: `settings.privacyPolicy` «Політика конфіденційності» / «Политика конфиденциальности», `settings.terms` «Умови використання» / «Условия использования» (open app.isfleet.eu/privacy and /terms in the selected language).

---

## 3. TYPICAL DAY

**a) New trip → departure → loading → statuses → CMR → delivery**
1. A push «Нове завантаження» arrives: title, «Завантаження: <address>», time window, plate. Tap **«OK»** → status «Прийнято».
2. If nothing else is in progress, «Вирушаємо на завантаження?» follows. Tap **«Так»** → status «В дорозі». («Ні» → asked again in 20 min, up to 3 times; then the manager is told.)
3. Open **Рейс** (drawer), tap the trip card ▼ to see the stops. Tap the address to copy it, or the ↗ icon next to the coordinates to open Google Maps. Check the `#` reference and the ⏱ time window.
4. At the loading point: tap the status badge in the header → **«На місці»**. After loading → **«Завантажено»**.
5. Photo of the CMR: in the trip chat tap 📎 → «Прикріпити» → **«Камера»**, take the photo, it is sent to the chat and saved in the trip documents. (Or: **Документи** → active folder → «Завантажити» → «Камера».)
6. Drive to unloading (the stop marked «Розвантаження»). On arrival you can set «На місці» again. After unloading → **«Доставлено»**.
7. If a next trip is queued, the app now asks about it (OK) and then asks «Вирушаємо на завантаження?» for it.
   The manager gets a push «Статус рейсу» after every status change you make.

**b) Sending a document photo to the manager**
- Trip-related: **Рейс** → 📎 → «Камера» / «Галерея» / «Файл». Or **Документи** → active trip folder → «Завантажити».
- Not trip-related: **Чат** → the manager's name → 📎 → choose the source.
- Up to 10 files at once, 20 MB each. Photos, PDF, Word, Excel, TXT, CSV.

**c) Receiving an alarm**
- At the set time the phone rings with the alarm sound, even in silent mode (Android: in "Do not disturb" only after granting access in Settings → «Надійні сповіщення» → «Будильник у режимі «Не турбувати»»). The notification shows the subject and comment. If the manager set it, the Alarm screen shows «від <manager name>».
- One-time alarms then drop out of the active state. Daily / weekly alarms ring again at the next time. To repeat a one-time alarm later: Alarm screen → row → «Перезапустити через…» (works only for alarms you created yourself; see Known gaps).

**d) Trip moved to another truck / driver changed**
- **New driver** (the trip was moved to their truck or reassigned to them): gets «Нове завантаження» → «OK» → «Прийнято», exactly like a new trip. A moved trip's status is reset to «Призначено». The chat starts fresh with a system line (e.g. `sys.driverAssigned` «До вантажівки {{plate}} призначений водій {{name}}» / «Водитель {{name}} назначен на грузовик {{plate}}»).
- **Previous driver:** the trip **disappears from «Мої рейси» without a push**. If they had it open: `trip.readOnlyNotice` «Ви більше не учасник цього чату — перегляд тільки для читання.»
- **Driver taken off the truck:** push *(server)* «Вантажівку {{plate}} відкріплено» / «Грузовик {{plate}} откреплён» — «Вас більше не призначено на цю вантажівку» / «Вы больше не закреплены за этой машиной». Truck, Documents and Trip go empty.
- **Given a truck:** push «Вам призначено вантажівку {{plate}}» / «Вам назначен грузовик {{plate}}» (or «Вас призначено на {{plate}}» / «Вас назначили на {{plate}}»).
- **Manager changed:** push «Менеджер змінений» / «Менеджер изменён» — «Ваш новий менеджер: {{name}}» / «Ваш новый менеджер: {{name}}». System line `sys.managerAssigned` «До вантажівки {{plate}} призначений менеджер {{name}}».

---

## 4. TROUBLESHOOTING

| Situation | Message (UA / RU) | Meaning | What the driver should do |
|---|---|---|---|
| Code not received | no error; after 30 s «Не отримали код?» | SMS didn't arrive, the number isn't registered, or it was typed in the wrong format | Check the country code (the field starts with +48!). Wait 30 s → «Надіслати SMS ще раз» or «Надіслати код менеджеру на пошту», then call the manager. Abroad / in roaming SMS often fails, so use the manager option |
| Wrong or expired code | *(server)* «Код невірний або прострочений.» / «Код неверный или просрочен.» | Typo, or older than 5 min (15 min for a manager code) | Retype it, or request a new code |
| Too many attempts | *(server)* «Забагато спроб. Запросіть новий код.» / «Слишком много попыток. Запросите новый код.» | 5 wrong entries locked the code | Request a new code (after 60 s) |
| Asked again too fast | *(server)* «Зачекайте перед запитом нового коду.» / «Подождите перед запросом нового кода.» | 60 s cooldown per method | Wait a minute; the previous code is still valid |
| Rate limited (>3 requests/min) | **UNKNOWN — check manually** (the throttler's default text, probably English "Too Many Requests") | Too many requests | Wait a minute |
| Not a driver account | «Цей застосунок лише для водіїв. Увійдіть під акаунтом водія.» / «Это приложение только для водителей…» | Signed in with a manager's phone | Use the driver's own number |
| Driver account inactive | *(server)* «Акаунт водія неактивний.» / «Аккаунт водителя неактивен.» | Deactivated by the company | Contact the manager |
| No internet at sign-in | «Не вдається підключитися. Перевірте інтернет і спробуйте ще раз за хвилину.» / «Не удаётся подключиться. Проверьте соединение и попробуйте снова через минуту.» | No connection to the server | Check data / Wi-Fi, try again in a minute |
| Server error | «Помилка сервера ({{status}})» / «Ошибка сервера ({{status}})» | Backend problem | Try later, report via «Повідомити про проблему» |
| Send failed (fallback) | «Не вдалося надіслати код. Спробуйте ще раз.» / «Не удалось отправить код. Попробуйте ещё раз.» | Request failed | Try again |
| File too large | «Файл завеликий: до 20 МБ на документ, 10 МБ на фото профілю, до 10 файлів за раз.» / «Файл слишком большой: до 20 МБ на документ, 10 МБ на фото профиля, до 10 файлов за раз.» (in an alert titled «Не вдалось завантажити» / «Не удалось загрузить») | Over the limits | Send fewer files at once; split big PDFs; send photos via camera / gallery (they get compressed) |
| File type not supported | «Цей тип файлу не підтримується. Можна: фото, PDF, Word, Excel, TXT, CSV.» / «Этот тип файла не поддерживается. Можно: фото, PDF, Word, Excel, TXT, CSV.» | e.g. video, ZIP, SVG | Convert to PDF or a photo |
| Can't open a file | «Не вдалось відкрити» / «Не удалось открыть» | No app to open it, or the file is gone | Install a PDF viewer; ask the manager |
| Can't delete a file | *(server)* «Ви не можете видалити цей документ» / «Вы не можете удалить этот документ» | Someone else uploaded it | Ask the manager |
| Message not sent (offline) | message stays "pending"; on refusal «Не вдалося надіслати» + «Повторити» / «Видалити» | Text waits on the phone and goes out when online (up to 7 days) | Leave the app; it sends itself. For files: retry when online |
| Connection to chat | «під'єднання…» / «подключение…» instead of «онлайн» | Socket reconnecting | Wait; pull down to refresh |
| Company deactivated | «На жаль, зараз ви не можете використовувати застосунок у повному обсязі.» / «К сожалению, сейчас вы не можете использовать приложение в полном объёме.» | The company account is off | Contact the manager / company |
| Signed out unexpectedly | phone screen «Вхід» | Session rejected: 90+ days unused, account removed / role changed, or signed out | Sign in again with the phone + code. No internet **never** signs you out |
| No pushes | — | Notifications denied, battery optimisation, or status «Сплю» / «Відпочиваю» | Settings → «Надійні сповіщення»; set status to Online |
| Voice: no mic | «Немає доступу до мікрофона. Дозвольте його в налаштуваннях телефону.» | Permission denied | Allow the microphone in phone settings |
| Camera / gallery does nothing | (no message) | Permission was denied | Allow camera / photos for IS Driver in phone settings |

---

## 5. SCREENSHOT LIST (in guide order)
1. Phone screen «Вхід» with a number typed in (show that +48 must be changed).
2. Code screen during the countdown «Не прийшов код? Інші способи — через 2x с».
3. Code screen after 30 s, showing the «Не отримали код?» box with «Надіслати SMS ще раз» + «Надіслати код менеджеру на пошту» + the manager note.
4. Side drawer open: menu items, bell, status, manager row.
5. The «Нове завантаження» window with the OK button (in-app or lock-screen push).
6. The «Вирушаємо на завантаження?» window with «Так» / «Ні».
7. Trip screen, card unfolded: 2 stops (Завантаження + Розвантаження) with address, `#` ref, coordinates chip and ⏱ window, status «В дорозі».
8. Status picker dropdown open, showing all 6 statuses.
9. Trip chat with a CMR photo just sent + the «Прикріпити» sheet (Камера / Галерея / Файл).
10. «Мої рейси» with all three sections: Активний / Наступні / Завершені.
11. Documents: folder list with the active folder marked «Активний», then inside it the «Фото» tab + «Завантажити».
12. Chat directory: the «Чат» tab with a manager conversation + «Інші контакти», and the «Групи» tab with "All Drivers".
13. Alarm screen with one alarm «від <manager>» and the «+ Новий» form open.
14. Settings: language section + «Надійні сповіщення» (Android) + «Вийти з акаунту».

---

## 6. KNOWN GAPS — the guide must NOT promise
- **WhatsApp and Telegram sign-in are OFF.** The labels exist in the app but the buttons are hidden.
- **"Manager generates a code" is OFF by default** on the server (`MANAGER_LOGIN_CODE_ENABLED` defaults to false). Treat it as off until Render is checked.
- The **manager-email sign-in only works when the driver already has a truck with a manager who has an email**. Otherwise nothing is sent, yet the app shows "sent".
- **Unknown or mistyped numbers get no error**, just no SMS.
- **iPhone / App Store availability: not established.** Play track (internal / closed / production): check before publishing.
- **Phone number can't be changed** in the app (manager only).
- **Drivers can't create groups.** Only the one company-wide group exists, and its name is **"All Drivers" in English**, not translated.
- **Status changes have no confirmation and no ordering rule.** A mis-tap is sent to the manager immediately.
- There is **no "unloading / unloaded" status**: «Доставлено» ends the trip.
- **Only coordinates open in maps.** An address can only be copied; there is no "navigate to address" button.
- **No "copied" feedback** when copying an address / ref / coordinates.
- **Uploads in Documents only go into the active trip's folder**; older trip folders are read-only.
- **The delete icon shows on every file**, but drivers can delete only their own uploads.
- **Alarm "Перезапустити через…" on an alarm set by the manager will fail.** The server lets only the creator edit (*(server)* «Лише той, хто створив, може редагувати цей будильник»). Deleting it works.
- **The edit-window error text is wrong:** the server says «Час на редагування минув (15 хв)» / «Время на редактирование истекло (15 мин)», but the real window is **24 hours** (client and server both). Say "you can edit your message for 24 hours", and don't quote that error.
- **Files and voice messages are not queued offline**; only text is.
- **Push silence in «Сплю» / «Відпочиваю»** is intended. Warn drivers who forget to switch back.
- **Languages:** UA, RU, EN, PL, LT are complete in the app (all 324 keys present in UA and RU). There's **no German** in the driver app. UZ/KZ/HI exist in the backend enum, but the app can't select them.
- **Small UA/RU wording mismatch:** the UA status «В дорозі» (app) vs «У дорозі» in the server push. Harmless, but don't quote one as the other.
- iOS permission dialogs: the main `Info.plist` texts are English, with localised overrides for uk/ru/pl/lt (`assets/ios-permissions/*`). Not relevant for Android.
- The exact "IS Fleet contact" chat notices after a manager-code sign-in: **UNKNOWN — check manually**.
- The throttler (too many requests) message language: **UNKNOWN — check manually**.
