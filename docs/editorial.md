# Editorial JeyTid

Editorial es un subsistema opcional de Agent Office para dirigir una biblioteca personal desde un
solo propietario. El código vive en `src/server/editorial/` y no cambia el comportamiento del
oficio base mientras `EDITORIAL_ENABLED` no sea `1`.

## Requisitos y activación

El oficio base admite Node 20+. Editorial usa `node:sqlite`, por lo que requiere Node 22.5 o una
versión posterior con ese módulo disponible. La base y los archivos privados quedan bajo:

```text
<agent-office-data>/.agent-office/editorial/
  editorial.sqlite
  files/projects/<project_id>/...
```

Ejemplo de configuración (no contiene credenciales):

```powershell
$env:EDITORIAL_ENABLED = "1"
$env:TELEGRAM_BOT_TOKEN = "<token entregado por BotFather>"
$env:TELEGRAM_OWNER_ID = "<id numérico del propietario>"
$env:TELEGRAM_ALLOWED_CHAT_IDS = "<id numérico del chat>"
$env:EDITORIAL_PROVIDER = "mock" # cambia a openai solo con OPENAI_API_KEY
$env:EDITORIAL_AUTONOMOUS_MODE = "0" # 1 ejecuta tareas elegibles sin pedir confirmación por tarea
$env:EDITORIAL_BUDGET_USD = "5"
$env:EDITORIAL_MAX_CONCURRENT = "3"
```

También se puede comprobar la instalación sin levantar el servidor:

```bash
agent-office editorial doctor --data-dir .agent-office
agent-office editorial demo --data-dir .agent-office
agent-office editorial snapshot --data-dir .agent-office
agent-office editorial backup --data-dir .agent-office --destination ./editorial-backup
agent-office editorial restore ./editorial-backup --data-dir ./restored-office
```

`demo` usa un proveedor mock determinista y nunca publica en KDP ni en una red social.

## Modelo operativo

La entrada de una obra crea un proyecto aislado, una revisión inicial del brief y un flujo durable
con once perfiles: dirección editorial, investigación, derechos/procedencia, escritura, edición de
desarrollo, corrección, arte, maquetación/KDP, auditoría independiente, publicación KDP y marketing.
Cada tarea guarda contrato, dependencias, intentos, generación, lease, heartbeat, checkpoints,
resumen, proveedor, modelo, versión de perfil, evidencias, costos y artefactos. No se almacena
razonamiento privado.

La cola reserva presupuesto dentro de una transacción SQLite, limita la concurrencia, recupera
leases vencidos y descarta respuestas tardías cuando la generación ya no coincide o la tarea fue
cancelada. Una revisión nueva revoca aprobaciones y marca releases preparados como `needs_changes`.
Los artefactos guardan SHA-256, revisión y procedencia; las rutas nunca vienen directamente del
usuario.

## Telegram

El bot usa long polling de `getUpdates`, conserva el offset y deduplica `update_id` en SQLite. Solo
acepta el `TELEGRAM_OWNER_ID` y los chats numéricos incluidos en
`TELEGRAM_ALLOWED_CHAT_IDS`. No se concede autoridad por nombre de usuario.

Comandos principales:

```text
/nuevo_libro <título>
/ideas [contexto]
/proyectos
/estado <project_id>
/tareas [project_id]
/modo
/ejecutar [project_id]
/agentes
/costos
/aprobaciones
/publicar <release_id>
/pausar <project_id>   /continuar <project_id>
/cancelar <task_id>
```

En modo `supervisado` (`EDITORIAL_AUTONOMOUS_MODE=0`, valor predeterminado), crear un libro o una
tarea deja la cola pendiente; el propietario inicia el trabajo con `/ejecutar project_id` o
`/ejecutar` para toda la cola. En modo `autónomo` (`EDITORIAL_AUTONOMOUS_MODE=1`), el orquestador
revisa la cola periódicamente y ejecuta las tareas elegibles sin confirmación individual. La vista
`/editorial`, `/modo`, `/estado` y `/tareas` permiten observar el avance. El propietario puede cambiar
el modo del proceso actual con `/modo autonomo` o `/modo supervisado`; para conservar la elección
después de reiniciar, actualiza `EDITORIAL_AUTONOMOUS_MODE`. Este modo no autoriza por
sí mismo publicación externa, gasto publicitario, login en KDP ni publicación social: esas acciones
siguen sujetas a la política de aprobación del propietario.

Un documento adjunto debe llevar `project_id` al inicio del caption y no puede superar 20 MB. Los
botones de aprobación llevan solo el id opaco de la aprobación; el token secreto nunca se envía en
el callback. Aprobar cambia el estado a `approved`; `/publicar` vuelve a comprobar el hash exacto,
consume la aprobación una sola vez y deja el release en `assisted`. La acción externa KDP no se
ejecuta automáticamente.

## Documentos, derechos y release

El módulo conserva fuente Markdown editable, EPUB, PDF interior básico, render HTML, metadatos,
checklist KDP y ZIP con `MANIFEST.json`. EPUB y PDF tienen validación estructural local; el PDF no
pretende ser una preflight tipográfica profesional. La auditoría comprueba archivos, hashes,
formatos, derechos y hallazgos bloqueantes antes de marcar un candidato como aprobado.

La preparación KDP distingue `prepared` y `assisted` de `published`. El propietario todavía debe
revisar identidad, territorios, precio, páginas y cubierta, y completar login, MFA, CAPTCHA y envío.
No se realizan pruebas de publicación real.

## Marketing y conectores

El calendario social es durable, exportable y requiere aprobación del propietario antes de publicar.
Existe un conector opcional real para Mastodon: solo usa `MASTODON_BASE_URL` y
`MASTODON_ACCESS_TOKEN` en memoria, llama `POST /api/v1/statuses` y solo registra `published` si la
respuesta remota contiene un id. Sin esas variables, el estado es exportación asistida y no se
simula una publicación.

## Vista, seguridad y recuperación

Con el usuario del oficio autenticado, `/editorial` muestra proyectos, tareas, runs, revisiones,
artefactos, aprobaciones, hallazgos, capacidades, costos y conectores. Los endpoints son de sesión,
los secretos no aparecen en el snapshot, y la ruta de artefactos valida el registro privado antes de
leerlo. El almacenamiento usa directorios privados, escritura temporal + rename y hashes.

El respaldo copia SQLite y `files/` después de checkpoint WAL y crea `BACKUP-MANIFEST.json`. Se puede
restaurar en un directorio separado para verificar sin tocar la instalación activa; `--force` es
obligatorio para reemplazar un destino que ya tenga base.

## Matriz de capacidades actual

| Capacidad | Estado sin credenciales | Evidencia o límite |
| --- | --- | --- |
| Estado, revisiones, canon aislado | Implementada | SQLite + invalidación por revisión |
| Cola durable, leases, checkpoints | Implementada | Reserva y recuperación transaccional |
| Once perfiles y adaptador Agent Office | Implementada / requiere floor para despachar | El proveedor editorial local sigue siendo la autoridad del resultado |
| Texto e imagen real | Requiere configuración | Adaptadores HTTP; no hay llamada real en pruebas |
| Mock reproducible | Probada localmente | Texto e imagen marcados como mock |
| EPUB | Implementada y validada localmente | Contenedor y archivos requeridos |
| PDF | Limitada y validada localmente | PDF de texto básico, no preflight de imprenta |
| KDP automatizado | No soportada | Se requiere ruta asistida con propietario |
| Calendario social | Implementada | SQLite + exportación |
| Mastodon | Requiere configuración | Solo se confirma publicación con respuesta remota |
| Telegram | Requiere token e id | Polling, deduplicación, callbacks y adjuntos |

## Fuentes oficiales consultadas

- Agent Office: [README](https://github.com/AgentSystemLabs/agent-office), [cómo funciona](https://github.com/AgentSystemLabs/agent-office/blob/main/docs/how-it-works.md), [agentes](https://github.com/AgentSystemLabs/agent-office/blob/main/docs/agents.md).
- [Node.js SQLite](https://nodejs.org/api/sqlite.html).
- [Telegram Bot API](https://core.telegram.org/bots/api), incluyendo `getUpdates`, callbacks y límites de archivos.
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses) y [Images API](https://developers.openai.com/api/reference/resources/images).
- [KDP Help](https://kdp.amazon.com/en_US/help), [preparación de cubierta](https://kdp.amazon.com/en_US/help/topic/G202187850) y [plantillas/calculador](https://kdp.amazon.com/es_ES/cover-templates).
- [Mastodon: publicar un status](https://docs.joinmastodon.org/methods/statuses/) y [guías de API](https://docs.joinmastodon.org/api/guidelines/).

Estas fuentes describen APIs y políticas externas; la matriz anterior es el estado verificable de
esta instalación, no una promesa de capacidades de las plataformas.
