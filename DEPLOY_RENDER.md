# Despliegue en Render gratis sin perder datos

## Decisión tomada

La app queda preparada para:

1. Ejecutarse en Render como Web Service gratis.
2. Guardar datos en Postgres cuando exista `DATABASE_URL`.
3. Importar automáticamente tus JSON actuales en el primer arranque si la base está vacía.

## Por qué no uso Render Postgres gratis para tus datos definitivos

Render indica que su Postgres gratis expira a los 30 días. Para una webapp personal que no quieres perder, eso no sirve como almacenamiento definitivo.

Por eso la configuración que dejo preparada usa:

1. Render gratis para el hosting.
2. Un Postgres externo gratis con cadena `DATABASE_URL`.

Opciones válidas:

1. Neon.
2. Supabase.
3. Cualquier Postgres administrado que te dé una URL estándar.

## Lo que ya hace la app

Si `DATABASE_URL` no existe:

1. Sigue funcionando con tus JSON locales.

Si `DATABASE_URL` existe:

1. Crea la tabla `app_documents` si no existe.
2. Migra `users.json`, `training_data.json`, `draft.json`, `body_weight.json` y `nutrition_data.json` a Postgres si la base está vacía.
3. Desde ese momento lee y guarda en Postgres.

## Archivos añadidos

1. `requirements.txt`
2. `render.yaml`
3. `.env.example`

## Flujo recomendado

### 1. Sube esta carpeta a GitHub

Render despliega desde repositorio Git. Mantén los JSON dentro del repo para que el primer despliegue pueda importarlos.

### 2. Crea una base Postgres gratis externa

Necesitas una `DATABASE_URL` con formato parecido a este:

```text
postgresql://usuario:password@host:5432/database
```

### 3. Crea el servicio en Render

1. Entra en Render.
2. Elige `New +`.
3. Elige `Blueprint` si detecta `render.yaml`, o conecta el repo y crea el servicio web desde ese archivo.
4. Cuando Render pida variables, pega `DATABASE_URL`.

Variables relevantes:

1. `DATABASE_URL`: obligatoria para persistencia real.
2. `FLASK_SECRET_KEY`: se genera sola en el blueprint.
3. `BOOTSTRAP_FROM_JSON=true`: importa tus JSON si la base está vacía.

## Primer despliegue

En el primer deploy, la app hace bootstrap automático solo si no encuentra documentos en la base.

Eso evita sobrescribir datos si redepliegas más tarde.

## Verificación rápida

Cuando termine el deploy:

1. Abre `/api/health`.
2. Debe devolver `storage: postgres`.
3. Inicia sesión con tus usuarios actuales.
4. Comprueba historial, progreso, peso y nutrición.

## Si quieres usar Render Postgres gratis igualmente

Se puede para pruebas, pero no para conservar datos a largo plazo. Según la documentación de Render, expira a los 30 días.

## Mantenimiento

Mientras uses Postgres:

1. Tus JSON locales ya no son la fuente principal en producción.
2. Puedes mantenerlos en el repo como semilla o respaldo manual.
3. Si quieres evitar cualquier bootstrap accidental en el futuro, cambia `BOOTSTRAP_FROM_JSON` a `false` después del primer deploy.

No es obligatorio porque el bootstrap ya se detiene si la tabla contiene datos.