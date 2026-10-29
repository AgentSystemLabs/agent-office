# Plan de implementación: Editorial JeyTid sobre Agent Office

## Resumen

Añadir a Agent Office un módulo editorial privado, persistente y verificable que pueda dirigir una
persona propietaria desde Telegram y observar en una vista web complementaria servida por el mismo
proceso. El módulo mantiene el estado operativo en SQLite, los documentos y binarios en un almacén
privado, y usa un orquestador durable para coordinar once perfiles de rol, proveedores configurables,
validaciones, derechos, auditoría, preparación de KDP y marketing. La integración no convierte un
mock en una conexión real: cada capacidad se etiqueta con su evidencia y dependencia.

## Evidencia y versión base

- Base: `AgentSystemLabs/agent-office` en `852e2ab28c4f3f31bffdf4b20353bd119c9d3270` (`main`, 2026-10-08).
- Licencia: MIT.
- Stack detectado: Node.js/TypeScript ESM, Node >=20 en el proyecto base, Vite, WebSocket/HTTP,
  workers CLI y persistencia existente en `.agent-office/`.
- Verificación inicial: `npm run typecheck` y `npm run build` pasan tras completar los enlaces de
  binarios locales; `npm test` arranca pero conserva fallos previos en escenarios de clonación y
  DeepSeek Harness que requieren servicios/fixtures externos. Se registrará el resultado exacto
  después de cada cambio.
- Fuentes oficiales consultadas el 2026-10-28: Agent Office (`README`, `docs/how-it-works.md`,
  `docs/agents.md`), Telegram Bot API, KDP Help, directrices de contenido KDP, preparación de
  cubiertas y calculador de plantillas. Las URLs y fechas se conservarán en la documentación del
  módulo.

## Decisiones de arquitectura

- **Módulo de servidor aislado:** `src/server/editorial/` contiene dominio, persistencia, orquestación,
  proveedores, documentos, Telegram, KDP, redes y rutas. Se integra con `Ctx` mediante una interfaz
  pequeña y no modifica los registries del cliente salvo la página complementaria.
- **Persistencia:** SQLite mediante `node:sqlite` cuando se activa Editorial; el archivo vive bajo
  `.agent-office/editorial/editorial.sqlite`. Las migraciones son numeradas, transaccionales y
  verifican invariantes. El modo editorial documentará Node 22.5+ como requisito operativo, mientras
  que Agent Office sin Editorial conserva su compatibilidad base.
- **Archivos:** `.agent-office/editorial/projects/<project_id>/<edition_id>/` separa originales,
  fuentes editables, derivados, renderizados y paquetes. Las rutas se generan a partir de UUIDs; no
  se aceptan segmentos de ruta del usuario. Cada artefacto guarda hash SHA-256 y revisión.
- **Contratos:** tipos explícitos y validadores en tiempo de ejecución para proyectos, tareas,
  resultados, aprobaciones, artefactos, procedencia y publicaciones. El resumen de acciones reemplaza
  cualquier almacenamiento de razonamiento privado.
- **Orquestación:** una cola durable reclama tareas con `BEGIN IMMEDIATE`, heartbeat y lease; solo
  tareas cuyos predecesores están completados se ejecutan. La reserva de presupuesto ocurre antes de
  lanzar trabajo y se libera/cierra al finalizar; respuestas tardías se descartan por generación.
- **Proveedores:** `mock` para pruebas reproducibles; `openai` por HTTP `fetch` para texto e imágenes,
  habilitado solo con credencial configurada. Las imágenes no colocan texto tipográfico; la
  composición de portada es un paso separado y trazable.
- **Agent Office:** el adaptador conserva `project_id`, `task_id`, `run_id`, rol y worker/floor cuando
  existe. Si `EDITORIAL_AGENT_OFFICE_FLOOR` identifica un floor real, puede enviar una tarea a su
  cola; si no, ejecuta el proveedor editorial configurado y deja la asociación en estado explícito.
- **Telegram:** long polling por defecto, token y propietario numérico fuera de la base y de los logs,
  chat permitido por ID, actualizaciones deduplicadas en SQLite, callbacks con acción/versión/owner/
  expiración almacenados, y mensajes divididos al límite vigente.
- **KDP y redes:** primero preparación y asistencia; no se publican libros reales durante las pruebas.
  La capacidad se expone como `implemented`, `tested_local`, `tested_real`, `requires_config`,
  `requires_owner`, `limited` o `unsupported`.
- **Vista:** `/editorial` comparte autenticación y proceso de Agent Office y muestra proyectos,
  tareas, dependencias, agentes, revisiones, hallazgos, archivos, aprobaciones, costos, conectores y
  calendario sin exponer secretos.

## Lista de tareas

### Fase 1: Contratos y persistencia — completada

- [x] T1. Crear tipos, validadores, estados, roles, perfiles y matriz de capacidades.
- [x] T2. Implementar migraciones SQLite, repositorios transaccionales, hashes, auditoría y
  almacenamiento seguro de artefactos.
- [x] T3. Implementar permisos, invalidación de derivados, aprobaciones con tokens de un solo uso y
  candidatos inmutables.

### Fase 2: Orquestación y generación — completada

- [x] T4. Implementar cola durable, leases, checkpoints, límites, pausa/cancelación y recuperación.
- [x] T5. Implementar adaptador Agent Office y perfiles configurables de los once agentes.
- [x] T6. Implementar proveedores mock y OpenAI para texto e imágenes con procedencia y costos.
- [x] T7. Implementar servicio de documentos: manuscrito editable, EPUB, PDF básico verificable,
  renderizados, manifiestos y ZIP de candidato.
- [x] Checkpoint A: migración, permisos, cola y demo local de artefactos pasan pruebas focalizadas.

### Fase 3: Telegram y observabilidad — completada

- [x] T8. Integrar el runtime editorial al ciclo de Agent Office, configuración, CLI, salud,
  apagado ordenado y respaldos/restauración.
- [x] T9. Implementar Bot API de Telegram, comandos, selector de proyecto, adjuntos limitados,
  botones de aprobación, notificaciones de hitos y deduplicación.
- [x] T10. Implementar API y página `/editorial` para observar el estado real y descargar solo
  artefactos autorizados.

### Fase 4: Flujo editorial e integraciones externas — completada en modo local/asistido

- [x] T11. Implementar creación de proyectos, ideas/brief, investigación con fuentes, escritura por
  unidades, edición, corrección, continuidad y memoria/canon aislados por libro.
- [x] T12. Implementar derechos/procedencia, hallazgos, auditoría final independiente y pipeline de
  release con invalidación.
- [x] T13. Implementar preparación KDP y flujo asistido con checklist, especificaciones y evidencia
  oficial; no asumir API pública ni afirmar publicación automática.
- [x] T14. Implementar calendario social y un conector real opcional, más exportación asistida y
  estados de capacidad por cuenta.

### Fase 5: Verificación y entrega — completada con límite heredado documentado

- [x] T15. Añadir demo reproducible de una obra breve hasta candidato KDP sin publicar ni gastar en
  publicidad.
- [x] T16. Añadir pruebas focalizadas de los invariantes críticos, restauración separada y ausencia de
  credenciales reales. La suite amplia base conserva fallos heredados y no se presenta como verde.
- [x] T17. Documentar instalación, configuración, operación, recuperación, límites, matriz de
  capacidades, fuentes y resultados; actualizar README y docs relacionados.
- [ ] Checkpoint B: `npm run typecheck`, `npm test`, `npm run build`, demo y diagnóstico reproducible.
  Typecheck, build, demo y tests editoriales pasan; `npm test` completo no termina limpio por
  escenarios base de clonación/DSH que ya fallaban antes de Editorial.

### Fase 6: Operación autónoma con propietario observador

- [x] T18. Añadir una bandera de modo autónomo, con supervisado como valor seguro por defecto, y
  reflejarla en la configuración y el snapshot sin exponer credenciales.
- [x] T19. Permitir que el orquestador se ejecute automáticamente solo en modo autónomo y ofrecer
  ejecución manual filtrada por proyecto en modo supervisado.
- [x] T20. Exponer `/modo` y `/ejecutar [project_id]` en Telegram, actualizar la ayuda y documentar
  el flujo de propietario único; conservar aprobaciones para publicación, gastos y acciones externas.
- [x] Checkpoint C: pruebas de modo supervisado/autónomo, typecheck, build y revisión de secretos.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| `node:sqlite` no existe en Node antiguo | Alto | Activar Editorial solo con Node 22.5+ y fallar con diagnóstico claro; mantener Agent Office base separado. |
| Telegram/KDP/red no tienen credenciales o API suficiente | Alto | Completar código, dobles, exportación y asistencia; marcar la capacidad real y no simular éxito. |
| Integrar workers de Agent Office exige un floor | Medio | Adaptador opcional con asociación persistente; ejecución directa del proveedor cuando no hay floor. |
| Derivados obsoletos tras una edición | Alto | Revisiones, hashes, generación y reglas de invalidación antes de aprobar. |
| Dos tareas superan presupuesto por carrera | Alto | Reserva atómica dentro de transacción inmediata y tests de concurrencia. |
| PDFs/EPUB válidos pero visualmente pobres | Medio | Validación estructural, renderizados y checklist explícito; declarar límites del PDF básico. |
| Secretos en logs o archivos exportados | Alto | Redacción centralizada, `.gitignore`, pruebas de escaneo y archivos de ejemplo sin valores. |

## Preguntas abiertas no bloqueantes

- Credenciales y cuentas concretas de Telegram, proveedor de texto/imagen, KDP y red social se
  conectarán después; el sistema debe funcionar en modo mock/local mientras no existan.
- El propietario podrá escoger más adelante jurisdicción, mercado, seudónimo, red social y proveedor;
  no se inferirá ninguno.
