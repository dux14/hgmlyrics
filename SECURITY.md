# Seguridad — Estado de remediacion (auditoria 2026-06-15)

Resumen de hallazgos SEC-01 a SEC-19: remediados en codigo fuente y/o migraciones.
Ver `git log --oneline --grep="fix(security)"` para detalle por commit.
Migraciones SEC-06/12/13 aplicadas en produccion (supabase/migrations/).
Suite de tests verde (1 022+ tests).

---

## Pendientes de configuracion (accion manual en dashboards — Samu)

### SEC-11 — Limite real de tamano de archivo en bucket `stems-jobs`

- **Situacion actual:** la validacion de 25 MB ocurre sobre el campo `size`
  declarado por el cliente en `api/stems/jobs.js`. Es una guardia de UX: no
  impide que un cliente malicioso envie un archivo mas grande directamente
  contra el storage.
- **Accion:** en el dashboard de Supabase Storage, configurar el max file size
  del bucket `stems-jobs` a **25 MB** para que el limite sea aplicado por el
  servidor independientemente del cliente.
- **Estado:** PENDIENTE — dashboard Supabase Storage → Buckets → stems-jobs →
  Settings.

---

### SEC-22 — TTL del access_token (JWT)

- **Situacion actual:** el TTL por defecto de Supabase Auth es 3 600 s (1 h).
  Si ya esta en 1 h, no es urgente; si esta en un valor mayor, conviene
  reducirlo.
- **Riesgo:** un access_token exfiltrado tiene una ventana de validez proporcional
  al TTL. El refresh_token de larga duracion es el riesgo central, pero ya esta
  mitigado al cerrar los vectores XSS (SEC-01/03/04/05/09/14, completados en
  codigo).
- **Accion:** verificar (y ajustar si es necesario) el JWT expiry en Supabase
  Auth Settings a un valor maximo de **1 h (3 600 s)**.
- **Estado:** PENDIENTE DE VERIFICACION — dashboard Supabase Authentication →
  Settings → JWT expiry.

---

### SEC-23 — Magic link coexiste con Google para el mismo email

- **Situacion actual:** un usuario puede autenticarse con Google OAuth o con un
  magic link enviado a su email. Esto implica que quien controle la bandeja de
  entrada del email puede acceder a la cuenta, incluso si el usuario usa Google
  como metodo principal.
- **Decision de producto requerida:**
  - Opcion A: mantener ambos metodos (comportamiento actual; riesgo asumido).
  - Opcion B: deshabilitar magic link y conservar solo Google OAuth.
  - Opcion C: permitir magic link solo para emails no vinculados a un proveedor
    OAuth (requiere logica adicional).
- **Estado:** PENDIENTE / DECISION DE PRODUCTO — dashboard Supabase Authentication
  → Providers.

---

### SEC-24 — Proteccion contra enumeracion de cuentas

- **Situacion actual:** no se ha verificado si las respuestas de los endpoints
  de OTP/login de Supabase revelan si un email existe o no (p.ej., mensajes
  distintos para "email no registrado" vs. "email registrado").
- **Accion:** confirmar en Supabase Auth Settings que las respuestas de
  OTP/magic-link usan mensajes genericos ("Revisa tu email") sin revelar
  existencia del email. Supabase ofrece la opcion "Secure email change" y
  mensajes genericos en versiones recientes.
- **Estado:** PENDIENTE DE VERIFICACION — dashboard Supabase Authentication →
  Settings → "Enable secure email change".

---

## Decisiones conscientes (no se cambia el codigo en esta ronda)

### SEC-20 — `api/songs/search.js` carga toda la tabla por busqueda

- **Clasificacion:** escalabilidad, no seguridad. La auditoria lo registra como
  observacion de rendimiento.
- **Situacion actual:** `SELECT * FROM songs` sin filtro, luego `Array.filter()`
  en Node. Funciona correctamente para el tamano actual del catalogo.
- **Decision:** no se modifica en esta ronda de remediacion de seguridad.
  Optimizacion futura recomendada: filtrar en SQL con `ILIKE`/`unaccent`/
  `pg_trgm` mas `LIMIT`, o cachear el resultado completo (TTL corto).

---

## Remediaciones ya completadas (referencia)

| ID     | Descripcion breve                                              | Commit / migracion          |
|--------|----------------------------------------------------------------|-----------------------------|
| SEC-01 | XSS cross-user via avatarUrl                                   | b800d64                     |
| SEC-02 | Fail-closed en cron cleanup sin CRON_SECRET                   | 036e253                     |
| SEC-03 | Escape innerHTML en canciones/perfil/estudio/favoritos        | 27a6e22                     |
| SEC-04 | (incluido en SEC-03)                                          | 27a6e22                     |
| SEC-05 | XSS via avatarUrl (complemento SEC-01)                        | b800d64                     |
| SEC-06 | RLS auth-only en song_links                                    | 35144f0 / migracion 20260615120000 |
| SEC-07 | Firmar solo output keys del propio job                         | da76ecb                     |
| SEC-08 | Allowlist de content-type en upload de covers                 | 5e0ea43                     |
| SEC-09 | (incluido en SEC-03)                                          | 27a6e22                     |
| SEC-10 | Ocultar mensajes de error 5xx al cliente                      | 2f317d8                     |
| SEC-12 | search_path en SECURITY DEFINER (stem_jobs_broadcast)         | 35144f0 / migracion 20260615120100 |
| SEC-13 | Revocar grant muerto (key_value)                              | 35144f0 / migracion 20260615120200 |
| SEC-14 | (incluido en SEC-03)                                          | 27a6e22                     |
| SEC-15 | DTO explicito sin columnas internas en stems                   | 0649f73                     |
| SEC-16 | Open-redirect en AuthCallback                                  | 5aa1a9f                     |
| SEC-17 | Fail-safe pooler en song_links                                 | 5aa1a9f                     |
| SEC-18 | `api/version.js` devuelve hash opaco (no epoch unix)          | 5aa1a9f                     |
| SEC-19 | Eliminar endpoints muertos replicate/copyUrlToStems            | 5aa1a9f                     |
| SEC-21 | Escapar comodines LIKE en busqueda social (`%`, `_`, `\`)     | este commit                 |
