# dsh-openviking-status: Доменная модель и концепция

## Контекст
Плагин статусной строки и визуализации состояния OpenViking в интерфейсе DeepSeek Harness (DSH Desktop / Web).

## Глоссарий (Ubiquitous Language)

### Session Status (Состояние сессии)
- **Active Session**: Текущая сессия чата DSH, идентифицируемая UUID (в OpenViking транслируется в `dsh-session-<uuid>`).
- **Peer ID**: Идентификатор рабочего контекста (репозитория или рабочей папки), определяющий скоуп памяти в OpenViking.
- **Pending Tokens**: Количество токенов диалога, накопленных в текущей сессии с момента последнего коммита. При достижении порога (`commitTokenThreshold`, по умолчанию 20 000) инициируется автокоммит.
- **Commit**: Процесс фиксации сырых сообщений сессии в VikingFS (`messages.jsonl`) и запуск асинхронного извлечения сущностей, предпочтений и событий.

### Memory Recall (Подмешивание памяти)
- **Profile Block**: Долговременный профиль пользователя и сущностей (`<openviking-context source="profile">`), инжектируемый при старте диалога.
- **Recall Block**: Релевантные воспоминания (`<openviking-context>`), найденные поиском по тексту первого сообщения пользователя.
- **Recalled Count**: Число документов/чанков памяти, подгруженных в текущую сессию.

### UI Presentation (Интерфейс)
- **Status Chip**: Компактный бейдж в строке ввода (`conversation.input.right` / `conversation.input.left`), отображающий `🟢 OV: <recalled> rec · <pending>k pend`.
- **Status Popover**: Всплывающая информационная карточка по клику на Status Chip, содержащая статус сервера, текущий Peer ID, шкалу заполнения Pending Tokens, список подмешанных файлов `viking://` и действие `Commit Now`.
