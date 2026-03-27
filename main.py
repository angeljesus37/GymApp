from flask import Flask, request, jsonify, send_from_directory, session
from flask_compress import Compress
import os
import json
import uuid
import requests as http_requests
from datetime import datetime, timedelta

try:
    import psycopg
except ImportError:
    psycopg = None

try:
    from psycopg_pool import ConnectionPool as _ConnectionPool
except ImportError:
    _ConnectionPool = None


# ---------------------------------------------------------------------------
# Helpers de entorno
# ---------------------------------------------------------------------------

def env_flag(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() not in {'', '0', 'false', 'no', 'off'}


def normalize_database_url(raw_url):
    normalized = str(raw_url or '').strip()
    if normalized.startswith('postgres://'):
        return f"postgresql://{normalized[len('postgres://'):]}"
    return normalized


# ---------------------------------------------------------------------------
# Configuración de la app
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'app-entrenamiento-dev-secret')
app.permanent_session_lifetime = timedelta(days=30)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = env_flag('SESSION_COOKIE_SECURE', env_flag('RENDER', False))
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Gzip compression for API responses and static assets
app.config['COMPRESS_MIMETYPES'] = [
    'text/html', 'text/css', 'text/javascript', 'application/javascript',
    'application/json', 'application/xml', 'text/xml',
]
app.config['COMPRESS_LEVEL'] = 6
app.config['COMPRESS_MIN_SIZE'] = 500
Compress(app)

DATABASE_URL      = normalize_database_url(os.environ.get('DATABASE_URL'))
SUPABASE_URL      = os.environ.get('SUPABASE_URL', 'https://sylngstouzbutzzaxcna.supabase.co')
SUPABASE_ANON_KEY = os.environ.get(
    'SUPABASE_ANON_KEY',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsIn'
    'JlZiI6InN5bG5nc3RvdXpidXR6emF4Y25hIiwicm9sZSI6ImFub24iLCJpYXQiOj'
    'E3NzM5MzcyMTgsImV4cCI6MjA4OTUxMzIxOH0.L7is8tfOnTVxjqKYEQKlXVfS1NzUHwO4v8mNtTtpWsg'
)
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

DEFAULT_USERNAME = 'mario'

LEGACY_TYPE_MAP = {'Brazo': 'Triceps'}

FRONTEND_ASSET_EXTENSIONS = {'.html', '.css', '.js', '.mjs', '.json', '.map', '.ico'}
# Static assets (JS/CSS) that can be cached by the browser
_CACHEABLE_EXTENSIONS = {'.css', '.js', '.mjs', '.map', '.ico'}
_STATIC_CACHE_MAX_AGE = 300  # 5 minutes — short enough to pick up deploys quickly


def is_frontend_asset(path):
    _, extension = os.path.splitext(str(path or '').lower())
    return extension in FRONTEND_ASSET_EXTENSIONS


def _is_cacheable_static(path):
    _, extension = os.path.splitext(str(path or '').lower())
    return extension in _CACHEABLE_EXTENSIONS


def apply_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers['Surrogate-Control'] = 'no-store'
    return response


# ---------------------------------------------------------------------------
# Base de datos — connection pool (psycopg3)
# ---------------------------------------------------------------------------

_db_pool = None


def _get_pool():
    """Lazy-initialises and returns the shared connection pool."""
    global _db_pool
    if _db_pool is not None:
        return _db_pool
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL no configurada.')
    if _ConnectionPool is None:
        raise RuntimeError('psycopg[pool] es obligatorio cuando DATABASE_URL está configurada.')
    _db_pool = _ConnectionPool(
        DATABASE_URL,
        min_size=1,
        max_size=4,
        open=True,
        reconnect_timeout=5,
    )
    return _db_pool


def get_db_conn():
    """Returns a pooled connection context manager."""
    return _get_pool().connection()


# ---------------------------------------------------------------------------
# Supabase Auth — helpers HTTP
# ---------------------------------------------------------------------------

def supabase_sign_in(email: str, password: str):
    """Valida credenciales contra Supabase Auth. Devuelve user_id (str) o None."""
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    try:
        resp = http_requests.post(
            url,
            json={'email': email, 'password': password},
            headers={'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json'},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            return str(data.get('user', {}).get('id', '')) or None
    except Exception:
        pass
    return None


def supabase_admin_create_user(email: str, password: str):
    """Crea un usuario en Supabase Auth via Admin API. Devuelve user_id (str) o None."""
    if not SUPABASE_SERVICE_KEY:
        return None
    url = f"{SUPABASE_URL}/auth/v1/admin/users"
    try:
        resp = http_requests.post(
            url,
            json={'email': email, 'password': password, 'email_confirm': True},
            headers={
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
                'Content-Type': 'application/json'
            },
            timeout=10
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            return str(data.get('id', '')) or None
    except Exception:
        pass
    return None


def supabase_admin_update_password(user_id: str, new_password: str) -> bool:
    """Actualiza la contraseña de un usuario en Supabase Auth."""
    if not SUPABASE_SERVICE_KEY:
        return False
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"
    try:
        resp = http_requests.put(
            url,
            json={'password': new_password},
            headers={
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
                'Content-Type': 'application/json'
            },
            timeout=10
        )
        return resp.status_code == 200
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Operaciones de perfil
# ---------------------------------------------------------------------------

def get_profile_by_username(username: str):
    """Devuelve (user_id_str, email) o (None, None)."""
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.id::text, u.email
                FROM public.profiles p
                JOIN auth.users u ON p.id = u.id
                WHERE p.username = %s
                """,
                (username,)
            )
            row = cur.fetchone()
    if row:
        return str(row[0]), str(row[1])
    return None, None


def get_username_by_id(user_id: str):
    """Devuelve username dado un user_id UUID (str)."""
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username FROM public.profiles WHERE id = %s::uuid",
                (user_id,)
            )
            row = cur.fetchone()
    return str(row[0]) if row else None


def username_exists(username: str) -> bool:
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM public.profiles WHERE username = %s", (username,))
            return cur.fetchone() is not None


def create_profile(user_id: str, username: str):
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.profiles (id, username) VALUES (%s::uuid, %s)",
                (user_id, username)
            )
            cur.execute(
                "INSERT INTO public.nutrition_goals (user_id) VALUES (%s::uuid) ON CONFLICT DO NOTHING",
                (user_id,)
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Normalización (idéntica a la versión anterior, sin cambios de API)
# ---------------------------------------------------------------------------

def canonicalize_type(raw_type):
    normalized = str(raw_type or '').strip()
    if not normalized:
        return 'Sin Grupo'
    return LEGACY_TYPE_MAP.get(normalized, normalized)


def normalize_set(raw_set):
    if not isinstance(raw_set, dict):
        return {'reps': None, 'weight': None, 'durationSeconds': None, 'avgSpeed': None, 'completed': False}

    reps             = raw_set.get('reps')
    weight           = raw_set.get('weight')
    duration_seconds = raw_set.get('durationSeconds')
    avg_speed        = raw_set.get('avgSpeed')

    normalized_duration = None
    if isinstance(duration_seconds, (int, float)):
        normalized_duration = max(0, int(round(duration_seconds)))

    normalized_avg_speed = None
    if isinstance(avg_speed, (int, float)):
        normalized_avg_speed = round(float(avg_speed), 2)

    return {
        'reps':            reps if isinstance(reps, (int, float)) else None,
        'weight':          weight if isinstance(weight, (int, float)) else None,
        'durationSeconds': normalized_duration,
        'avgSpeed':        normalized_avg_speed,
        'completed':       bool(raw_set.get('completed', False))
    }


def normalize_exercise(raw_exercise, fallback_type='Sin Grupo'):
    if not isinstance(raw_exercise, dict):
        return None

    name = str(raw_exercise.get('name', '')).strip()
    if not name:
        return None

    exercise_type = canonicalize_type(raw_exercise.get('type', fallback_type))
    if exercise_type == 'Sin Grupo' and fallback_type != 'Sin Grupo':
        exercise_type = canonicalize_type(fallback_type)

    sets = raw_exercise.get('sets', [])
    normalized_sets = [normalize_set(item) for item in sets if isinstance(item, dict)]

    return {
        'name':      name,
        'type':      exercise_type,
        'sets':      normalized_sets,
        'collapsed': bool(raw_exercise.get('collapsed', False))
    }


def derive_types(payload, exercises):
    ordered_types = []
    if isinstance(payload.get('types'), list):
        for item in payload['types']:
            normalized = canonicalize_type(item)
            if normalized != 'Sin Grupo' and normalized not in ordered_types:
                ordered_types.append(normalized)
    elif payload.get('type'):
        normalized = canonicalize_type(payload.get('type'))
        if normalized != 'Sin Grupo':
            ordered_types.append(normalized)

    for exercise in exercises:
        exercise_type = canonicalize_type(exercise.get('type', 'Sin Grupo'))
        if exercise_type != 'Sin Grupo' and exercise_type not in ordered_types:
            ordered_types.append(exercise_type)

    return ordered_types


def normalize_workout_payload(payload):
    if not isinstance(payload, dict):
        return None

    date = str(payload.get('date', '')).strip()
    if not date:
        return None

    explicit_types = []
    if isinstance(payload.get('types'), list):
        explicit_types = [canonicalize_type(item) for item in payload.get('types', [])
                          if canonicalize_type(item) != 'Sin Grupo']
    elif payload.get('type'):
        normalized_type = canonicalize_type(payload.get('type'))
        if normalized_type != 'Sin Grupo':
            explicit_types = [normalized_type]

    fallback_type = explicit_types[0] if explicit_types else 'Sin Grupo'

    exercises = []
    for raw_exercise in payload.get('exercises', []):
        normalized = normalize_exercise(raw_exercise, fallback_type)
        if normalized:
            exercises.append(normalized)

    types = derive_types(payload, exercises)
    return {'date': date, 'types': types, 'exercises': exercises}


def get_workout_types(workout):
    if not isinstance(workout, dict):
        return []
    explicit_types = ([canonicalize_type(item) for item in workout.get('types', [])]
                      if isinstance(workout.get('types'), list) else [])
    if explicit_types:
        return explicit_types
    legacy_type = canonicalize_type(workout.get('type'))
    return [] if legacy_type == 'Sin Grupo' else [legacy_type]


def workout_matches_type(workout, target_type):
    if not target_type or target_type == 'Todos':
        return True
    return target_type in get_workout_types(workout)


def exercise_matches_type(exercise, target_type, fallback_type='Sin Grupo'):
    if not target_type or target_type == 'Todos':
        return True
    exercise_type = canonicalize_type((exercise or {}).get('type', fallback_type))
    return exercise_type == target_type


def filter_workout_by_type(workout, target_type):
    if not isinstance(workout, dict) or not target_type or target_type == 'Todos':
        return workout

    fallback_types  = get_workout_types(workout)
    fallback_type   = fallback_types[0] if fallback_types else 'Sin Grupo'
    filtered_exercises = [
        exercise for exercise in workout.get('exercises', [])
        if exercise_matches_type(exercise, target_type, fallback_type)
    ]

    if not filtered_exercises:
        return None

    filtered_workout             = dict(workout)
    filtered_workout['exercises'] = filtered_exercises
    filtered_workout['types']     = derive_types({'types': [target_type]}, filtered_exercises)
    return filtered_workout


def normalize_body_weight_entry(raw_entry):
    if not isinstance(raw_entry, dict):
        return None

    date = str(raw_entry.get('date', '')).strip()
    if not date:
        return None

    try:
        weight = float(raw_entry.get('weight'))
    except (TypeError, ValueError):
        return None

    if weight <= 0:
        return None

    return {'date': date, 'weight': round(weight, 2)}


def default_nutrition_goals():
    return {'calories': None, 'protein': None, 'carbs': None, 'fat': None}


def normalize_nutrition_metric(raw_value):
    if raw_value in (None, ''):
        return None
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    return round(value, 2)


def normalize_nutrition_goals(raw_goals):
    if not isinstance(raw_goals, dict):
        raw_goals = {}
    return {
        'calories': normalize_nutrition_metric(raw_goals.get('calories')),
        'protein':  normalize_nutrition_metric(raw_goals.get('protein')),
        'carbs':    normalize_nutrition_metric(raw_goals.get('carbs')),
        'fat':      normalize_nutrition_metric(raw_goals.get('fat'))
    }


def normalize_nutrition_entry(raw_entry):
    if not isinstance(raw_entry, dict):
        return None

    date  = str(raw_entry.get('date', '')).strip()
    name  = str(raw_entry.get('name', '')).strip()
    meal  = str(raw_entry.get('meal', '')).strip() or 'Comida'
    notes = str(raw_entry.get('notes', '')).strip()

    if not date or not name:
        return None

    grams    = normalize_nutrition_metric(raw_entry.get('grams'))
    calories = normalize_nutrition_metric(raw_entry.get('calories'))
    protein  = normalize_nutrition_metric(raw_entry.get('protein'))
    carbs    = normalize_nutrition_metric(raw_entry.get('carbs'))
    fat      = normalize_nutrition_metric(raw_entry.get('fat'))

    if all(value is None for value in (grams, calories, protein, carbs, fat)):
        return None

    entry_id = str(raw_entry.get('id', '')).strip() or str(uuid.uuid4())

    return {
        'id':       entry_id,
        'date':     date,
        'meal':     meal[:40],
        'name':     name[:120],
        'grams':    grams,
        'calories': calories,
        'protein':  protein,
        'carbs':    carbs,
        'fat':      fat,
        'notes':    notes[:280]
    }


# ---------------------------------------------------------------------------
# Operaciones de entrenamiento (tablas relacionales)
# ---------------------------------------------------------------------------

def _row_to_workout(row):
    """Convierte una fila (id, date, types, exercises_list) al dict de la API."""
    workout_id, date, types, exercises_raw = row
    exercises = []
    for ex in (exercises_raw or []):
        sets_raw = ex.get('sets') or []
        if isinstance(sets_raw, str):
            sets_raw = json.loads(sets_raw)
        exercises.append({
            'name':      ex.get('name', ''),
            'type':      ex.get('type', ''),
            'collapsed': bool(ex.get('collapsed', False)),
            'sets': [
                {
                    'reps':            s.get('reps'),
                    'weight':          s.get('weight'),
                    'durationSeconds': s.get('duration_seconds'),
                    'avgSpeed':        s.get('avg_speed'),
                    'completed':       bool(s.get('completed', False))
                }
                for s in sets_raw
            ]
        })
    return {
        'id':        str(workout_id),
        'date':      str(date),
        'types':     list(types or []),
        'exercises': exercises
    }


def load_data_for_user(user_id: str):
    if not user_id:
        return []

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  w.id,
                  w.date,
                  w.types,
                  COALESCE(
                    json_agg(
                      json_build_object(
                        'name',      e.name,
                        'type',      e.type,
                        'collapsed', e.collapsed,
                        'sets', (
                          SELECT COALESCE(json_agg(
                            json_build_object(
                              'reps',             s.reps,
                              'weight',           s.weight,
                              'duration_seconds', s.duration_seconds,
                              'avg_speed',        s.avg_speed,
                              'completed',        s.completed
                            ) ORDER BY s.position
                          ), '[]'::json)
                          FROM public.exercise_sets s
                          WHERE s.exercise_id = e.id
                        )
                      ) ORDER BY e.position
                    ) FILTER (WHERE e.id IS NOT NULL),
                    '[]'
                  ) AS exercises
                FROM public.workouts w
                LEFT JOIN public.workout_exercises e ON e.workout_id = w.id
                WHERE w.user_id = %s::uuid
                GROUP BY w.id, w.date, w.types
                ORDER BY w.date DESC
                """,
                (user_id,)
            )
            rows = cur.fetchall()

    workouts = []
    for row in rows:
        exercises_raw = row[3]
        if isinstance(exercises_raw, str):
            exercises_raw = json.loads(exercises_raw)
        workouts.append(_row_to_workout((row[0], row[1], row[2], exercises_raw)))

    return workouts


def save_single_workout(user_id: str, workout: dict):
    """Guarda (upsert por fecha) un entrenamiento con sus ejercicios y series."""
    if not user_id:
        return None

    w = normalize_workout_payload(workout)
    if not w:
        return None

    w_id = str(workout.get('id') or uuid.uuid4())

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.workouts (id, user_id, date, types, updated_at)
                VALUES (%s::uuid, %s::uuid, %s::date, %s, NOW())
                ON CONFLICT (user_id, date)
                DO UPDATE SET types = EXCLUDED.types, updated_at = NOW()
                RETURNING id
                """,
                (w_id, user_id, w['date'], w['types'])
            )
            w_id = str(cur.fetchone()[0])

            cur.execute("DELETE FROM public.workout_exercises WHERE workout_id = %s::uuid", (w_id,))

            for pos, ex in enumerate(w.get('exercises', [])):
                cur.execute(
                    "INSERT INTO public.workout_exercises "
                    "(workout_id, name, type, position, collapsed) "
                    "VALUES (%s::uuid, %s, %s, %s, %s) RETURNING id",
                    (w_id, ex['name'], ex['type'], pos, ex.get('collapsed', False))
                )
                ex_id = cur.fetchone()[0]
                for spos, s in enumerate(ex.get('sets', [])):
                    cur.execute(
                        "INSERT INTO public.exercise_sets "
                        "(exercise_id, position, reps, weight, duration_seconds, avg_speed, completed) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                        (ex_id, spos,
                         s.get('reps'), s.get('weight'),
                         s.get('durationSeconds'), s.get('avgSpeed'),
                         bool(s.get('completed', False)))
                    )
        conn.commit()

    return w_id


def delete_workout_by_id(user_id: str, workout_id: str):
    if not user_id:
        return
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.workouts WHERE id = %s::uuid AND user_id = %s::uuid",
                (workout_id, user_id)
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Operaciones de borrador
# ---------------------------------------------------------------------------

def load_draft_for_user(user_id: str):
    if not user_id:
        return None

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT date, types, exercises, saved_at "
                "FROM public.workout_drafts WHERE user_id = %s::uuid",
                (user_id,)
            )
            row = cur.fetchone()

    if not row:
        return None

    exercises = row[2]
    if isinstance(exercises, str):
        exercises = json.loads(exercises)

    return {
        'date':      str(row[0]) if row[0] else None,
        'types':     list(row[1] or []),
        'exercises': exercises or [],
        'isDraft':   True,
        'savedAt':   row[3].isoformat() if row[3] else None
    }


def save_draft_for_user(user_id: str, draft):
    if not user_id:
        return

    if draft is None:
        with get_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM public.workout_drafts WHERE user_id = %s::uuid", (user_id,))
            conn.commit()
        return

    exercises_json = json.dumps(draft.get('exercises', []), ensure_ascii=False)
    types    = draft.get('types', [])
    date_val = draft.get('date') or None
    saved_at = draft.get('savedAt') or datetime.now().isoformat()

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.workout_drafts (user_id, date, types, exercises, saved_at)
                VALUES (%s::uuid, %s::date, %s, %s::jsonb, %s)
                ON CONFLICT (user_id) DO UPDATE
                  SET date = EXCLUDED.date, types = EXCLUDED.types,
                      exercises = EXCLUDED.exercises, saved_at = EXCLUDED.saved_at
                """,
                (user_id, date_val, types, exercises_json, saved_at)
            )
        conn.commit()


def delete_draft_for_user(user_id: str):
    save_draft_for_user(user_id, None)


# ---------------------------------------------------------------------------
# Operaciones de peso corporal
# ---------------------------------------------------------------------------

def load_body_weight_for_user(user_id: str):
    if not user_id:
        return []

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT date, weight FROM public.body_weight_entries "
                "WHERE user_id = %s::uuid ORDER BY date DESC",
                (user_id,)
            )
            rows = cur.fetchall()

    return [{'date': str(r[0]), 'weight': float(r[1])} for r in rows]


def save_body_weight_for_user(user_id: str, entry: dict):
    if not user_id:
        return

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.body_weight_entries (user_id, date, weight)
                VALUES (%s::uuid, %s::date, %s)
                ON CONFLICT (user_id, date) DO UPDATE SET weight = EXCLUDED.weight
                """,
                (user_id, entry['date'], entry['weight'])
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Operaciones de nutrición
# ---------------------------------------------------------------------------

def load_nutrition_for_user(user_id: str):
    if not user_id:
        return {'goals': default_nutrition_goals(), 'entries': []}

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT calories, protein, carbs, fat "
                "FROM public.nutrition_goals WHERE user_id = %s::uuid",
                (user_id,)
            )
            goals_row = cur.fetchone()

            cur.execute(
                """
                SELECT id, date, meal, name, grams, calories, protein, carbs, fat, notes
                FROM public.nutrition_entries
                WHERE user_id = %s::uuid
                ORDER BY date DESC, meal, name
                """,
                (user_id,)
            )
            entry_rows = cur.fetchall()

    goals = {'calories': None, 'protein': None, 'carbs': None, 'fat': None}
    if goals_row:
        goals = {
            'calories': float(goals_row[0]) if goals_row[0] is not None else None,
            'protein':  float(goals_row[1]) if goals_row[1] is not None else None,
            'carbs':    float(goals_row[2]) if goals_row[2] is not None else None,
            'fat':      float(goals_row[3]) if goals_row[3] is not None else None,
        }

    entries = []
    for r in entry_rows:
        entries.append({
            'id':       str(r[0]),
            'date':     str(r[1]),
            'meal':     r[2],
            'name':     r[3],
            'grams':    float(r[4]) if r[4] is not None else None,
            'calories': float(r[5]) if r[5] is not None else None,
            'protein':  float(r[6]) if r[6] is not None else None,
            'carbs':    float(r[7]) if r[7] is not None else None,
            'fat':      float(r[8]) if r[8] is not None else None,
            'notes':    r[9] or ''
        })

    return {'goals': goals, 'entries': entries}


def save_nutrition_goals_for_user(user_id: str, goals: dict):
    if not user_id:
        return default_nutrition_goals()

    g = normalize_nutrition_goals(goals)
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.nutrition_goals
                  (user_id, calories, protein, carbs, fat, updated_at)
                VALUES (%s::uuid, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_id) DO UPDATE
                  SET calories = EXCLUDED.calories, protein = EXCLUDED.protein,
                      carbs    = EXCLUDED.carbs,    fat      = EXCLUDED.fat,
                      updated_at = NOW()
                """,
                (user_id, g['calories'], g['protein'], g['carbs'], g['fat'])
            )
        conn.commit()
    return g


def save_nutrition_entry_for_user(user_id: str, entry: dict):
    if not user_id:
        return None

    e = normalize_nutrition_entry(entry)
    if not e:
        return None

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.nutrition_entries
                  (id, user_id, date, meal, name, grams, calories, protein, carbs, fat, notes)
                VALUES (%s::uuid, %s::uuid, %s::date, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                  SET date     = EXCLUDED.date,     meal   = EXCLUDED.meal,
                      name     = EXCLUDED.name,     grams  = EXCLUDED.grams,
                      calories = EXCLUDED.calories, protein = EXCLUDED.protein,
                      carbs    = EXCLUDED.carbs,    fat    = EXCLUDED.fat,
                      notes    = EXCLUDED.notes
                """,
                (e['id'], user_id, e['date'], e['meal'], e['name'],
                 e['grams'], e['calories'], e['protein'], e['carbs'], e['fat'], e['notes'])
            )
        conn.commit()

    return e


def delete_nutrition_entry_for_user(user_id: str, entry_id: str):
    if not user_id:
        return

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.nutrition_entries "
                "WHERE id = %s::uuid AND user_id = %s::uuid",
                (entry_id, user_id)
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Gestión de sesión Flask (internamente usa user_id, externamente username)
# ---------------------------------------------------------------------------

def set_logged_in_user(user_id: str, username: str):
    session.clear()
    session.permanent = True
    session['user_id']  = user_id
    session['username'] = username


def get_logged_in_username():
    # Flask sessions are HMAC-signed server-side cookies — data is trusted.
    user_id  = session.get('user_id')
    username = session.get('username')
    if not user_id or not username:
        session.clear()
        return None
    return username


def get_logged_in_user():
    """Returns (username, user_id) from the signed session, or (None, None)."""
    user_id  = session.get('user_id')
    username = session.get('username')
    if not user_id or not username:
        session.clear()
        return None, None
    return username, user_id


def require_auth():
    username, user_id = get_logged_in_user()
    if not username:
        return None, None, (jsonify({'status': 'error', 'message': 'Sesión no iniciada.'}), 401)
    return username, user_id, None


# ---------------------------------------------------------------------------
# Endpoints de autenticación
# ---------------------------------------------------------------------------

@app.route('/api/auth/session', methods=['GET'])
def get_auth_session():
    username = get_logged_in_username()
    if not username:
        return jsonify({'authenticated': False})
    return jsonify({'authenticated': True, 'username': username})


@app.route('/api/auth/login', methods=['POST'])
def login():
    payload  = request.get_json() or {}
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))

    if not username or not password:
        return jsonify({'status': 'error', 'message': 'Introduce usuario y contraseña.'}), 400

    user_id, email = get_profile_by_username(username)
    if not user_id or not email:
        return jsonify({'status': 'error', 'message': 'Credenciales incorrectas.'}), 401

    auth_user_id = supabase_sign_in(email, password)
    if not auth_user_id or auth_user_id != user_id:
        return jsonify({'status': 'error', 'message': 'Credenciales incorrectas.'}), 401

    set_logged_in_user(user_id, username)
    return jsonify({'status': 'success', 'username': username})


@app.route('/api/auth/register', methods=['POST'])
def register():
    payload  = request.get_json() or {}
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))
    email    = str(payload.get('email', '')).strip().lower()

    if len(username) < 3:
        return jsonify({'status': 'error', 'message': 'El usuario debe tener al menos 3 caracteres.'}), 400
    if len(password) < 3:
        return jsonify({'status': 'error', 'message': 'La contraseña debe tener al menos 3 caracteres.'}), 400
    if not email or '@' not in email:
        return jsonify({'status': 'error', 'message': 'Email requerido para el registro.'}), 400
    if username_exists(username):
        return jsonify({'status': 'error', 'message': 'Ese usuario ya existe.'}), 409

    new_user_id = supabase_admin_create_user(email, password)
    if not new_user_id:
        return jsonify({'status': 'error',
                        'message': 'Error creando el usuario. Verifica el email.'}), 500

    create_profile(new_user_id, username)
    set_logged_in_user(new_user_id, username)
    return jsonify({'status': 'success', 'username': username})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'status': 'success'})


# ---------------------------------------------------------------------------
# Endpoints de entrenamientos
# ---------------------------------------------------------------------------

def _get_workout_by_date(user_id: str, date: str):
    """Targeted single-row lookup — avoids loading all workouts just to check one date."""
    _WORKOUT_SQL = """
        SELECT w.id, w.date, w.types,
          COALESCE(
            json_agg(
              json_build_object(
                'name',      e.name,
                'type',      e.type,
                'collapsed', e.collapsed,
                'sets', (
                  SELECT COALESCE(json_agg(
                    json_build_object(
                      'reps',             s.reps,
                      'weight',           s.weight,
                      'duration_seconds', s.duration_seconds,
                      'avg_speed',        s.avg_speed,
                      'completed',        s.completed
                    ) ORDER BY s.position
                  ), '[]'::json)
                  FROM public.exercise_sets s
                  WHERE s.exercise_id = e.id
                )
              ) ORDER BY e.position
            ) FILTER (WHERE e.id IS NOT NULL),
            '[]'
          ) AS exercises
        FROM public.workouts w
        LEFT JOIN public.workout_exercises e ON e.workout_id = w.id
        WHERE w.user_id = %s::uuid AND w.date = %s::date
        GROUP BY w.id, w.date, w.types
    """
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_WORKOUT_SQL, (user_id, date))
            row = cur.fetchone()
    if row is None:
        return None
    exercises_raw = row[3]
    if isinstance(exercises_raw, str):
        exercises_raw = json.loads(exercises_raw)
    return _row_to_workout((row[0], row[1], row[2], exercises_raw))


@app.route('/api/save_workout', methods=['POST'])
def save_workout():
    username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    new_workout = normalize_workout_payload(request.get_json())
    if not new_workout:
        return jsonify({'status': 'error', 'message': 'Datos incompletos.'}), 400
    if not new_workout['types']:
        return jsonify({'status': 'error', 'message': 'Falta grupo muscular o tipos.'}), 400

    # Targeted lookup: avoid loading ALL workouts just to find one by date
    existing = _get_workout_by_date(user_id, new_workout['date'])
    new_workout['id'] = existing.get('id') if existing and existing.get('id') else str(uuid.uuid4())

    # Merge de ejercicios si ya había entrenamiento ese día
    if existing:
        merged_exercises = list(existing.get('exercises', [])) + list(new_workout.get('exercises', []))
        new_workout['exercises'] = merged_exercises
        merged_types = list(dict.fromkeys(existing.get('types', []) + new_workout.get('types', [])))
        new_workout['types'] = merged_types

    save_single_workout(user_id, new_workout)
    return jsonify({'status': 'success', 'message': 'Entrenamiento guardado.'})


@app.route('/api/delete_workout/<string:workout_id>', methods=['DELETE'])
def delete_workout(workout_id):
    username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    delete_workout_by_id(user_id, workout_id)
    return jsonify({'status': 'success', 'message': 'Entrenamiento eliminado.'})


@app.route('/api/history', methods=['GET'])
def get_all_history():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    all_workouts = load_data_for_user(user_id)

    w_type  = canonicalize_type(request.args.get('type')) if request.args.get('type') else None
    w_date  = request.args.get('date')
    w_month = str(request.args.get('month') or '').strip()

    filtered = all_workouts

    if w_type and w_type != 'Todos':
        filtered = [f for f in (filter_workout_by_type(w, w_type) for w in filtered) if f]

    if w_date:
        filtered = [w for w in filtered if w.get('date') == w_date]
    elif w_month:
        filtered = [w for w in filtered if str(w.get('date', '')).startswith(f'{w_month}-')]

    filtered.sort(key=lambda x: x.get('date', ''), reverse=True)
    return jsonify(filtered)


@app.route('/api/latest_exercises/<string:workout_type>', methods=['GET'])
def get_latest_exercises(workout_type):
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    all_workouts    = load_data_for_user(user_id)
    normalized_type = canonicalize_type(workout_type)
    workouts_by_type = [f for f in (filter_workout_by_type(w, normalized_type) for w in all_workouts) if f]
    workouts_by_type.sort(key=lambda x: x.get('date', ''), reverse=True)

    latest_exercises = {}
    for workout in workouts_by_type:
        for exercise in workout.get('exercises', []):
            name = exercise.get('name')
            if name and name not in latest_exercises:
                latest_exercises[name] = exercise

    return jsonify(list(latest_exercises.values()))


@app.route('/api/history/<string:workout_type>', methods=['GET'])
def get_workout_history(workout_type):
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    all_workouts    = load_data_for_user(user_id)
    normalized_type = canonicalize_type(workout_type)

    workouts_by_type = [f for f in (filter_workout_by_type(w, normalized_type) for w in all_workouts) if f]
    workouts_by_type.sort(key=lambda x: x.get('date', ''), reverse=True)

    return jsonify(workouts_by_type)


# ---------------------------------------------------------------------------
# Endpoints de borrador
# ---------------------------------------------------------------------------

@app.route('/api/save_draft', methods=['POST'])
def save_draft_workout():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    draft = normalize_workout_payload(request.get_json())
    if not draft:
        return jsonify({'status': 'error', 'message': 'Datos incompletos.'}), 400

    draft['isDraft'] = True
    draft['savedAt'] = datetime.now().isoformat()

    save_draft_for_user(user_id, draft)
    return jsonify({'status': 'success', 'message': 'Borrador guardado.'})


@app.route('/api/get_draft', methods=['GET'])
def get_draft():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    return jsonify(load_draft_for_user(user_id))


@app.route('/api/delete_draft', methods=['DELETE'])
def delete_draft():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    delete_draft_for_user(user_id)
    return jsonify({'status': 'success', 'message': 'Borrador eliminado.'})


# ---------------------------------------------------------------------------
# Endpoints de peso corporal
# ---------------------------------------------------------------------------

@app.route('/api/body_weight', methods=['GET'])
def get_body_weight():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    entries = load_body_weight_for_user(user_id)
    entries.sort(key=lambda item: item.get('date', ''), reverse=True)
    return jsonify(entries)


@app.route('/api/body_weight', methods=['POST'])
def save_body_weight():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    entry = normalize_body_weight_entry(request.get_json() or {})
    if not entry:
        return jsonify({'status': 'error', 'message': 'Fecha o peso corporal invalidos.'}), 400

    save_body_weight_for_user(user_id, entry)
    return jsonify({'status': 'success', 'entry': entry})


# ---------------------------------------------------------------------------
# Endpoints de nutrición
# ---------------------------------------------------------------------------

@app.route('/api/nutrition', methods=['GET'])
def get_nutrition():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    payload = load_nutrition_for_user(user_id)
    payload['entries'].sort(
        key=lambda item: (item.get('date', ''), item.get('meal', ''), item.get('name', '')),
        reverse=True
    )
    return jsonify(payload)


@app.route('/api/nutrition/goals', methods=['POST'])
def save_nutrition_goals():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    goals = save_nutrition_goals_for_user(user_id, request.get_json() or {})
    return jsonify({'status': 'success', 'goals': goals})


@app.route('/api/nutrition/entry', methods=['POST'])
def save_nutrition_entry():
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    entry = save_nutrition_entry_for_user(user_id, request.get_json() or {})
    if not entry:
        return jsonify({
            'status': 'error',
            'message': 'Introduce fecha, alimento y al menos un valor nutricional.'
        }), 400

    return jsonify({'status': 'success', 'entry': entry})


@app.route('/api/nutrition/entry/<string:entry_id>', methods=['DELETE'])
def delete_nutrition_entry(entry_id):
    _username, user_id, auth_error = require_auth()
    if auth_error:
        return auth_error

    delete_nutrition_entry_for_user(user_id, entry_id)
    return jsonify({'status': 'success', 'message': 'Entrada eliminada.'})


# ---------------------------------------------------------------------------
# Health check y archivos estáticos
# ---------------------------------------------------------------------------

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'storage': 'supabase-relational'})


@app.route('/')
def index():
    response = send_from_directory('.', 'index.html', max_age=0, conditional=False, etag=False)
    return apply_no_cache_headers(response)


@app.route('/<path:path>')
def static_files(path):
    if os.path.exists(path):
        if _is_cacheable_static(path):
            # JS/CSS can be cached; HTML stays no-cache (it bootstraps the app)
            return send_from_directory('.', path, max_age=_STATIC_CACHE_MAX_AGE)
        response = send_from_directory('.', path, max_age=0, conditional=False, etag=False)
        if is_frontend_asset(path):
            return apply_no_cache_headers(response)
        return response
    return ('File not found', 404)


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', '5000')),
        debug=env_flag('FLASK_DEBUG', False)
    )
