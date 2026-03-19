from flask import Flask, request, jsonify, send_from_directory, session
import os
import json
import uuid
import shutil
import copy
from datetime import datetime, timedelta

try:
    import psycopg
except ImportError:
    psycopg = None


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

app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'app-entrenamiento-dev-secret')
app.permanent_session_lifetime = timedelta(days=30)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = env_flag('SESSION_COOKIE_SECURE', env_flag('RENDER', False))
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

DATA_FILE = 'training_data.json'
DRAFT_FILE = 'draft.json'
USERS_FILE = 'users.json'
BODY_WEIGHT_FILE = 'body_weight.json'
NUTRITION_FILE = 'nutrition_data.json'
BACKUP_DIR = 'backups'
BACKUP_SNAPSHOT_LIMIT = 5
DEFAULT_USERNAME = 'mario'
DEFAULT_PASSWORD = 'mario'
DATABASE_URL = normalize_database_url(os.environ.get('DATABASE_URL'))
USE_POSTGRES = bool(DATABASE_URL)
BOOTSTRAP_FROM_JSON = env_flag('BOOTSTRAP_FROM_JSON', True)
CATEGORY_USERS = 'users'
CATEGORY_WORKOUTS = 'workouts'
CATEGORY_DRAFTS = 'drafts'
CATEGORY_BODY_WEIGHT = 'body_weight'
CATEGORY_NUTRITION = 'nutrition'
LEGACY_TYPE_MAP = {
    'Brazo': 'Triceps'
}

DOCUMENT_DEFAULTS = {
    CATEGORY_USERS: {},
    CATEGORY_WORKOUTS: {'users': {}},
    CATEGORY_DRAFTS: {'users': {}},
    CATEGORY_BODY_WEIGHT: {'users': {}},
    CATEGORY_NUTRITION: {'users': {}}
}

DOCUMENT_FILE_MAP = {
    CATEGORY_USERS: USERS_FILE,
    CATEGORY_WORKOUTS: DATA_FILE,
    CATEGORY_DRAFTS: DRAFT_FILE,
    CATEGORY_BODY_WEIGHT: BODY_WEIGHT_FILE,
    CATEGORY_NUTRITION: NUTRITION_FILE
}

FRONTEND_ASSET_EXTENSIONS = {
    '.html', '.css', '.js', '.mjs', '.json', '.map', '.ico'
}

def is_frontend_asset(path):
    _, extension = os.path.splitext(str(path or '').lower())
    return extension in FRONTEND_ASSET_EXTENSIONS

def apply_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers['Surrogate-Control'] = 'no-store'
    return response


def clone_data(value):
    return copy.deepcopy(value)


def get_document_default(category, fallback=None):
    default_value = DOCUMENT_DEFAULTS.get(category, fallback)
    return clone_data(default_value)


def get_postgres_connection():
    if not USE_POSTGRES:
        raise RuntimeError('DATABASE_URL no configurada.')
    if psycopg is None:
        raise RuntimeError('psycopg es obligatorio cuando DATABASE_URL está configurada.')
    return psycopg.connect(DATABASE_URL)


def ensure_postgres_schema():
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS app_documents (
                    category TEXT PRIMARY KEY,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                '''
            )
        connection.commit()


def postgres_has_documents():
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT EXISTS(SELECT 1 FROM app_documents LIMIT 1)')
            row = cursor.fetchone()
            return bool(row and row[0])


def load_postgres_document(category, fallback):
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT payload FROM app_documents WHERE category = %s', (category,))
            row = cursor.fetchone()

    if not row or row[0] is None:
        return clone_data(fallback)

    return row[0]


def save_postgres_document(category, data):
    payload = json.dumps(data, ensure_ascii=False)
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                INSERT INTO app_documents (category, payload, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (category)
                DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                ''',
                (category, payload)
            )
        connection.commit()


def bootstrap_postgres_from_json():
    if not USE_POSTGRES or not BOOTSTRAP_FROM_JSON or postgres_has_documents():
        return

    for category, file_path in DOCUMENT_FILE_MAP.items():
        fallback = get_document_default(category)
        data = load_json_file(file_path, fallback)
        save_postgres_document(category, data if data is not None else fallback)


def initialize_storage():
    if USE_POSTGRES:
        ensure_postgres_schema()
        bootstrap_postgres_from_json()


def load_backend_document(category, file_path, fallback):
    default_value = clone_data(fallback)
    if USE_POSTGRES:
        return load_postgres_document(category, default_value)
    return load_json_file(file_path, default_value)


def save_backend_document(category, file_path, data):
    if USE_POSTGRES:
        save_postgres_document(category, data)
        return
    save_json_file(file_path, data)

def ensure_backup_dir():
    os.makedirs(BACKUP_DIR, exist_ok=True)

def get_backup_file_path(file_path):
    return f'{file_path}.bak'

def get_snapshot_prefix(file_path):
    file_name = os.path.basename(file_path)
    return os.path.join(BACKUP_DIR, f'{file_name}.')

def list_snapshot_paths(file_path):
    ensure_backup_dir()
    prefix = f'{os.path.basename(file_path)}.'
    suffix = '.json'
    snapshot_paths = []

    for entry in os.listdir(BACKUP_DIR):
        if entry.startswith(prefix) and entry.endswith(suffix):
            snapshot_paths.append(os.path.join(BACKUP_DIR, entry))

    snapshot_paths.sort(key=os.path.getmtime, reverse=True)
    return snapshot_paths

def trim_snapshots(file_path):
    snapshot_paths = list_snapshot_paths(file_path)
    for snapshot_path in snapshot_paths[BACKUP_SNAPSHOT_LIMIT:]:
        try:
            os.remove(snapshot_path)
        except OSError:
            pass

def create_snapshot(file_path):
    if not os.path.exists(file_path):
        return

    ensure_backup_dir()
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    snapshot_path = f'{get_snapshot_prefix(file_path)}{timestamp}.json'
    shutil.copy2(file_path, snapshot_path)
    trim_snapshots(file_path)

def write_json_atomic(file_path, data):
    temp_path = f'{file_path}.tmp'

    with open(temp_path, 'w', encoding='utf-8') as file_handle:
        json.dump(data, file_handle, indent=4, ensure_ascii=False)
        file_handle.flush()
        os.fsync(file_handle.fileno())

    with open(temp_path, 'r', encoding='utf-8') as file_handle:
        json.load(file_handle)

    os.replace(temp_path, file_path)

def try_load_json(file_path):
    if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
        return None

    with open(file_path, 'r', encoding='utf-8') as file_handle:
        return json.load(file_handle)

def restore_primary_from_backup(primary_path, backup_path, data):
    try:
        write_json_atomic(primary_path, data)
        shutil.copy2(primary_path, get_backup_file_path(primary_path))
    except (OSError, json.JSONDecodeError):
        try:
            shutil.copy2(backup_path, primary_path)
        except OSError:
            pass

def load_json_file(file_path, fallback):
    try:
        loaded = try_load_json(file_path)
        if loaded is not None:
            return loaded
    except (json.JSONDecodeError, OSError):
        pass

    backup_path = get_backup_file_path(file_path)
    try:
        loaded_backup = try_load_json(backup_path)
        if loaded_backup is not None:
            restore_primary_from_backup(file_path, backup_path, loaded_backup)
            return loaded_backup
    except (json.JSONDecodeError, OSError):
        pass

    for snapshot_path in list_snapshot_paths(file_path):
        try:
            loaded_snapshot = try_load_json(snapshot_path)
            if loaded_snapshot is not None:
                restore_primary_from_backup(file_path, snapshot_path, loaded_snapshot)
                return loaded_snapshot
        except (json.JSONDecodeError, OSError):
            continue

    return fallback

def save_json_file(file_path, data):
    ensure_backup_dir()
    backup_path = get_backup_file_path(file_path)

    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        shutil.copy2(file_path, backup_path)
        create_snapshot(file_path)

    try:
        write_json_atomic(file_path, data)
    except Exception:
        if os.path.exists(backup_path):
            shutil.copy2(backup_path, file_path)
        raise

def canonicalize_type(raw_type):
    normalized = str(raw_type or '').strip()
    if not normalized:
        return 'Sin Grupo'
    return LEGACY_TYPE_MAP.get(normalized, normalized)

def get_workout_types(workout):
    if not isinstance(workout, dict):
        return []

    explicit_types = [canonicalize_type(item) for item in workout.get('types', [])] if isinstance(workout.get('types'), list) else []
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

    fallback_types = get_workout_types(workout)
    fallback_type = fallback_types[0] if fallback_types else 'Sin Grupo'
    filtered_exercises = [
        exercise for exercise in workout.get('exercises', [])
        if exercise_matches_type(exercise, target_type, fallback_type)
    ]

    if not filtered_exercises:
        return None

    filtered_workout = dict(workout)
    filtered_workout['exercises'] = filtered_exercises
    filtered_workout['types'] = derive_types({'types': [target_type]}, filtered_exercises)
    return filtered_workout

def normalize_set(raw_set):
    """Normaliza una serie recibida desde el cliente."""
    if not isinstance(raw_set, dict):
        return {'reps': None, 'weight': None, 'durationSeconds': None, 'avgSpeed': None, 'completed': False}

    reps = raw_set.get('reps')
    weight = raw_set.get('weight')
    duration_seconds = raw_set.get('durationSeconds')
    avg_speed = raw_set.get('avgSpeed')

    normalized_duration = None
    if isinstance(duration_seconds, (int, float)):
        normalized_duration = max(0, int(round(duration_seconds)))

    normalized_avg_speed = None
    if isinstance(avg_speed, (int, float)):
        normalized_avg_speed = round(float(avg_speed), 2)

    return {
        'reps': reps if isinstance(reps, (int, float)) else None,
        'weight': weight if isinstance(weight, (int, float)) else None,
        'durationSeconds': normalized_duration,
        'avgSpeed': normalized_avg_speed,
        'completed': bool(raw_set.get('completed', False))
    }

def normalize_exercise(raw_exercise, fallback_type='Sin Grupo'):
    """Limpia la estructura de cada ejercicio."""
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
        'name': name,
        'type': exercise_type,
        'sets': normalized_sets,
        'collapsed': bool(raw_exercise.get('collapsed', False))
    }

def derive_types(payload, exercises):
    """Obtiene la lista de grupos musculares del payload."""
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
    """Normaliza un entrenamiento o borrador antes de persistirlo."""
    if not isinstance(payload, dict):
        return None

    date = str(payload.get('date', '')).strip()
    if not date:
        return None

    explicit_types = []
    if isinstance(payload.get('types'), list):
        explicit_types = [canonicalize_type(item) for item in payload.get('types', []) if canonicalize_type(item) != 'Sin Grupo']
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

    return {
        'date': date,
        'types': types,
        'exercises': exercises
    }

def normalize_stored_workout(raw_workout):
    normalized = normalize_workout_payload(raw_workout)
    if not normalized:
        return None

    if raw_workout.get('id'):
        normalized['id'] = str(raw_workout.get('id'))

    if raw_workout.get('isDraft'):
        normalized['isDraft'] = True

    if raw_workout.get('savedAt'):
        normalized['savedAt'] = str(raw_workout.get('savedAt'))

    return normalized

def merge_exercise_lists(exercises):
    merged_exercises = []
    exercise_index = {}

    for exercise in exercises:
        normalized_exercise = normalize_exercise(exercise)
        if not normalized_exercise:
            continue

        exercise_key = f"{normalized_exercise['type']}::{normalized_exercise['name'].strip().lower()}"
        existing_index = exercise_index.get(exercise_key)

        if existing_index is None:
            merged_exercises.append({
                'name': normalized_exercise['name'],
                'type': normalized_exercise['type'],
                'sets': list(normalized_exercise.get('sets', [])),
                'collapsed': bool(normalized_exercise.get('collapsed', False))
            })
            exercise_index[exercise_key] = len(merged_exercises) - 1
            continue

        existing_exercise = merged_exercises[existing_index]
        existing_exercise['sets'].extend(normalized_exercise.get('sets', []))
        existing_exercise['collapsed'] = existing_exercise.get('collapsed', False) and normalized_exercise.get('collapsed', False)

    return merged_exercises

def merge_workouts_by_day(workouts):
    merged_by_date = {}
    ordered_dates = []

    for raw_workout in workouts if isinstance(workouts, list) else []:
        normalized_workout = normalize_stored_workout(raw_workout)
        if not normalized_workout:
            continue

        workout_date = normalized_workout['date']
        current_entry = merged_by_date.get(workout_date)
        if current_entry is None:
            current_entry = {
                'date': workout_date,
                'types': list(normalized_workout.get('types', [])),
                'exercises': list(normalized_workout.get('exercises', []))
            }

            if normalized_workout.get('id'):
                current_entry['id'] = normalized_workout['id']

            if normalized_workout.get('isDraft'):
                current_entry['isDraft'] = True

            if normalized_workout.get('savedAt'):
                current_entry['savedAt'] = normalized_workout['savedAt']

            merged_by_date[workout_date] = current_entry
            ordered_dates.append(workout_date)
            continue

        if not current_entry.get('id') and normalized_workout.get('id'):
            current_entry['id'] = normalized_workout['id']

        if normalized_workout.get('savedAt'):
            existing_saved_at = str(current_entry.get('savedAt', ''))
            incoming_saved_at = str(normalized_workout.get('savedAt', ''))
            if incoming_saved_at > existing_saved_at:
                current_entry['savedAt'] = incoming_saved_at

        current_entry['isDraft'] = bool(current_entry.get('isDraft')) or bool(normalized_workout.get('isDraft'))
        current_entry['types'] = derive_types(
            {'types': [*current_entry.get('types', []), *normalized_workout.get('types', [])]},
            [*current_entry.get('exercises', []), *normalized_workout.get('exercises', [])]
        )
        current_entry['exercises'] = merge_exercise_lists([
            *current_entry.get('exercises', []),
            *normalized_workout.get('exercises', [])
        ])

    merged_workouts = []
    for workout_date in ordered_dates:
        merged_entry = merged_by_date[workout_date]
        merged_entry['exercises'] = merge_exercise_lists(merged_entry.get('exercises', []))
        merged_entry['types'] = derive_types({'types': merged_entry.get('types', [])}, merged_entry['exercises'])
        merged_workouts.append(merged_entry)

    merged_workouts.sort(key=lambda item: item.get('date', ''), reverse=True)
    return merged_workouts

def load_users():
    users = load_backend_document(CATEGORY_USERS, USERS_FILE, {})
    if not isinstance(users, dict):
        users = {}

    changed = False
    normalized_users = {}
    for username, password in users.items():
        normalized_username = str(username).strip().lower()
        normalized_password = str(password)
        if normalized_username and normalized_password:
            normalized_users[normalized_username] = normalized_password

    if normalized_users != users:
        changed = True

    if DEFAULT_USERNAME not in normalized_users:
        normalized_users[DEFAULT_USERNAME] = DEFAULT_PASSWORD
        changed = True

    if changed:
        save_backend_document(CATEGORY_USERS, USERS_FILE, normalized_users)

    return normalized_users

def save_users(users):
    save_backend_document(CATEGORY_USERS, USERS_FILE, users)

def load_workout_store():
    raw_data = load_backend_document(CATEGORY_WORKOUTS, DATA_FILE, {'users': {}})
    migrated = False
    users_store = {}

    if isinstance(raw_data, list):
        normalized_workouts = [normalize_stored_workout(item) for item in raw_data]
        users_store[DEFAULT_USERNAME] = [item for item in normalized_workouts if item]
        migrated = True
    elif isinstance(raw_data, dict) and isinstance(raw_data.get('users'), dict):
        for username, workouts in raw_data['users'].items():
            normalized_username = str(username).strip().lower()
            if not normalized_username:
                migrated = True
                continue

            raw_workout_list = workouts if isinstance(workouts, list) else []
            normalized_workouts = merge_workouts_by_day(raw_workout_list)
            if len(normalized_workouts) != len(raw_workout_list):
                migrated = True
            else:
                for index, workout in enumerate(raw_workout_list):
                    normalized = normalize_stored_workout(workout)
                    if not normalized or normalized_workouts[index] != normalized:
                        migrated = True
                        break

            users_store[normalized_username] = normalized_workouts
            if normalized_username != username:
                migrated = True
    else:
        migrated = True

    if DEFAULT_USERNAME not in users_store:
        users_store[DEFAULT_USERNAME] = []
        migrated = True

    normalized_store = {'users': users_store}
    if migrated:
        save_backend_document(CATEGORY_WORKOUTS, DATA_FILE, normalized_store)

    return normalized_store

def save_workout_store(store):
    save_backend_document(CATEGORY_WORKOUTS, DATA_FILE, store)

def load_draft_store():
    raw_data = load_backend_document(CATEGORY_DRAFTS, DRAFT_FILE, {'users': {}})
    migrated = False
    users_store = {}

    if isinstance(raw_data, dict) and isinstance(raw_data.get('users'), dict):
        for username, draft in raw_data['users'].items():
            normalized_username = str(username).strip().lower()
            if not normalized_username:
                migrated = True
                continue

            normalized_draft = normalize_stored_workout(draft) if isinstance(draft, dict) else None
            users_store[normalized_username] = normalized_draft
            if normalized_draft != draft:
                migrated = True
            if normalized_username != username:
                migrated = True
    elif isinstance(raw_data, dict):
        users_store[DEFAULT_USERNAME] = normalize_stored_workout(raw_data)
        migrated = True
    else:
        migrated = True

    normalized_store = {'users': users_store}
    if migrated:
        save_backend_document(CATEGORY_DRAFTS, DRAFT_FILE, normalized_store)

    return normalized_store

def save_draft_store(store):
    save_backend_document(CATEGORY_DRAFTS, DRAFT_FILE, store)

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

    return {
        'date': date,
        'weight': round(weight, 2)
    }

def load_body_weight_store():
    raw_data = load_backend_document(CATEGORY_BODY_WEIGHT, BODY_WEIGHT_FILE, {'users': {}})
    migrated = False
    users_store = {}

    if isinstance(raw_data, dict) and isinstance(raw_data.get('users'), dict):
        for username, entries in raw_data['users'].items():
            normalized_username = str(username).strip().lower()
            if not normalized_username:
                migrated = True
                continue

            normalized_entries = []
            for entry in entries if isinstance(entries, list) else []:
                normalized_entry = normalize_body_weight_entry(entry)
                if normalized_entry:
                    normalized_entries.append(normalized_entry)
                    if normalized_entry != entry:
                        migrated = True
                else:
                    migrated = True

            normalized_entries.sort(key=lambda item: item.get('date', ''), reverse=True)
            users_store[normalized_username] = normalized_entries
            if normalized_username != username:
                migrated = True
    else:
        migrated = True

    if DEFAULT_USERNAME not in users_store:
        users_store[DEFAULT_USERNAME] = []
        migrated = True

    normalized_store = {'users': users_store}
    if migrated:
        save_backend_document(CATEGORY_BODY_WEIGHT, BODY_WEIGHT_FILE, normalized_store)

    return normalized_store

def save_body_weight_store(store):
    save_backend_document(CATEGORY_BODY_WEIGHT, BODY_WEIGHT_FILE, store)

def load_body_weight_for_user(username):
    store = load_body_weight_store()
    return list(store['users'].get(username, []))

def save_body_weight_for_user(username, entries):
    store = load_body_weight_store()
    store['users'][username] = entries
    save_body_weight_store(store)

def default_nutrition_goals():
    return {
        'calories': None,
        'protein': None,
        'carbs': None,
        'fat': None
    }

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
        'protein': normalize_nutrition_metric(raw_goals.get('protein')),
        'carbs': normalize_nutrition_metric(raw_goals.get('carbs')),
        'fat': normalize_nutrition_metric(raw_goals.get('fat'))
    }

def normalize_nutrition_entry(raw_entry):
    if not isinstance(raw_entry, dict):
        return None

    date = str(raw_entry.get('date', '')).strip()
    name = str(raw_entry.get('name', '')).strip()
    meal = str(raw_entry.get('meal', '')).strip() or 'Comida'
    notes = str(raw_entry.get('notes', '')).strip()

    if not date or not name:
        return None

    grams = normalize_nutrition_metric(raw_entry.get('grams'))
    calories = normalize_nutrition_metric(raw_entry.get('calories'))
    protein = normalize_nutrition_metric(raw_entry.get('protein'))
    carbs = normalize_nutrition_metric(raw_entry.get('carbs'))
    fat = normalize_nutrition_metric(raw_entry.get('fat'))

    if all(value is None for value in (grams, calories, protein, carbs, fat)):
        return None

    entry_id = str(raw_entry.get('id', '')).strip() or str(uuid.uuid4())

    return {
        'id': entry_id,
        'date': date,
        'meal': meal[:40],
        'name': name[:120],
        'grams': grams,
        'calories': calories,
        'protein': protein,
        'carbs': carbs,
        'fat': fat,
        'notes': notes[:280]
    }

def load_nutrition_store():
    raw_data = load_backend_document(CATEGORY_NUTRITION, NUTRITION_FILE, {'users': {}})
    migrated = False
    users_store = {}

    if isinstance(raw_data, dict) and isinstance(raw_data.get('users'), dict):
        for username, nutrition_payload in raw_data['users'].items():
            normalized_username = str(username).strip().lower()
            if not normalized_username:
                migrated = True
                continue

            payload = nutrition_payload if isinstance(nutrition_payload, dict) else {}
            goals = normalize_nutrition_goals(payload.get('goals', {}))
            entries = []

            for entry in payload.get('entries', []) if isinstance(payload.get('entries'), list) else []:
                normalized_entry = normalize_nutrition_entry(entry)
                if normalized_entry:
                    entries.append(normalized_entry)
                    if normalized_entry != entry:
                        migrated = True
                else:
                    migrated = True

            entries.sort(key=lambda item: (item.get('date', ''), item.get('meal', ''), item.get('name', '')), reverse=True)
            users_store[normalized_username] = {
                'goals': goals,
                'entries': entries
            }

            if normalized_username != username:
                migrated = True
    else:
        migrated = True

    if DEFAULT_USERNAME not in users_store:
        users_store[DEFAULT_USERNAME] = {
            'goals': default_nutrition_goals(),
            'entries': []
        }
        migrated = True

    normalized_store = {'users': users_store}
    if migrated:
        save_backend_document(CATEGORY_NUTRITION, NUTRITION_FILE, normalized_store)

    return normalized_store

def save_nutrition_store(store):
    save_backend_document(CATEGORY_NUTRITION, NUTRITION_FILE, store)

def load_nutrition_for_user(username):
    store = load_nutrition_store()
    payload = store['users'].get(username, {
        'goals': default_nutrition_goals(),
        'entries': []
    })
    return {
        'goals': normalize_nutrition_goals(payload.get('goals', {})),
        'entries': list(payload.get('entries', []))
    }

def save_nutrition_for_user(username, payload):
    store = load_nutrition_store()
    goals = normalize_nutrition_goals((payload or {}).get('goals', {}))
    entries = []
    for entry in (payload or {}).get('entries', []):
        normalized_entry = normalize_nutrition_entry(entry)
        if normalized_entry:
            entries.append(normalized_entry)

    entries.sort(key=lambda item: (item.get('date', ''), item.get('meal', ''), item.get('name', '')), reverse=True)
    store['users'][username] = {
        'goals': goals,
        'entries': entries
    }
    save_nutrition_store(store)

def load_data_for_user(username):
    store = load_workout_store()
    return merge_workouts_by_day(store['users'].get(username, []))

def save_data_for_user(username, workouts):
    store = load_workout_store()
    store['users'][username] = merge_workouts_by_day(workouts)
    save_workout_store(store)

def load_draft_for_user(username):
    store = load_draft_store()
    return store['users'].get(username)

def save_draft_for_user(username, draft):
    store = load_draft_store()
    store['users'][username] = draft
    save_draft_store(store)

def delete_draft_for_user(username):
    store = load_draft_store()
    if username in store['users']:
        del store['users'][username]
        save_draft_store(store)

def get_logged_in_username():
    username = str(session.get('username', '')).strip().lower()
    if not username:
        return None

    users = load_users()
    if username not in users:
        session.clear()
        return None

    return username

def require_auth():
    username = get_logged_in_username()
    if not username:
        return None, (jsonify({'status': 'error', 'message': 'Sesión no iniciada.'}), 401)
    return username, None

def set_logged_in_user(username):
    session.clear()
    session.permanent = True
    session['username'] = username

@app.route('/api/auth/session', methods=['GET'])
def get_auth_session():
    username = get_logged_in_username()
    if not username:
        return jsonify({'authenticated': False})
    return jsonify({'authenticated': True, 'username': username})

@app.route('/api/auth/login', methods=['POST'])
def login():
    payload = request.get_json() or {}
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))

    if not username or not password:
        return jsonify({'status': 'error', 'message': 'Introduce usuario y contraseña.'}), 400

    users = load_users()
    if users.get(username) != password:
        return jsonify({'status': 'error', 'message': 'Credenciales incorrectas.'}), 401

    set_logged_in_user(username)
    return jsonify({'status': 'success', 'username': username})

@app.route('/api/auth/register', methods=['POST'])
def register():
    payload = request.get_json() or {}
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))

    if len(username) < 3:
        return jsonify({'status': 'error', 'message': 'El usuario debe tener al menos 3 caracteres.'}), 400

    if len(password) < 3:
        return jsonify({'status': 'error', 'message': 'La contraseña debe tener al menos 3 caracteres.'}), 400

    users = load_users()
    if username in users:
        return jsonify({'status': 'error', 'message': 'Ese usuario ya existe.'}), 409

    users[username] = password
    save_users(users)
    save_data_for_user(username, [])
    save_draft_for_user(username, None)
    save_nutrition_for_user(username, {'goals': default_nutrition_goals(), 'entries': []})
    set_logged_in_user(username)
    return jsonify({'status': 'success', 'username': username})

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'status': 'success'})

@app.route('/api/save_workout', methods=['POST'])
def save_workout():
    """
    Recibe los datos de un nuevo entrenamiento, le asigna un ID único,
    y lo guarda en el archivo JSON.
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    new_workout = normalize_workout_payload(request.get_json())

    if not new_workout:
        return jsonify({'status': 'error', 'message': 'Datos incompletos.'}), 400

    if not new_workout['types']:
        return jsonify({'status': 'error', 'message': 'Falta grupo muscular o tipos.'}), 400

    all_workouts = load_data_for_user(username)

    existing_same_day = next((workout for workout in all_workouts if workout.get('date') == new_workout['date']), None)
    new_workout['id'] = existing_same_day.get('id') if existing_same_day and existing_same_day.get('id') else str(uuid.uuid4())

    all_workouts.append(new_workout)
    
    save_data_for_user(username, all_workouts)
    
    return jsonify({'status': 'success', 'message': 'Entrenamiento guardado.'})

@app.route('/api/delete_workout/<string:workout_id>', methods=['DELETE'])
def delete_workout(workout_id):
    """
    Elimina un entrenamiento específico por su ID.
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    all_workouts = load_data_for_user(username)
    updated_workouts = [w for w in all_workouts if w.get('id') != workout_id]
    
    save_data_for_user(username, updated_workouts)
    
    return jsonify({'status': 'success', 'message': 'Entrenamiento eliminado.'})

@app.route('/api/history', methods=['GET'])
def get_all_history():
    """
    Devuelve el historial de entrenamientos.
    Soporta filtrado por 'type' y 'date' a través de query parameters.
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    all_workouts = load_data_for_user(username)
    
    w_type = canonicalize_type(request.args.get('type')) if request.args.get('type') else None
    w_date = request.args.get('date')
    w_month = str(request.args.get('month') or '').strip()
    
    filtered_workouts = all_workouts
    
    if w_type and w_type != 'Todos':
        filtered_workouts = [
            filtered for filtered in (filter_workout_by_type(workout, w_type) for workout in filtered_workouts)
            if filtered
        ]
        
    if w_date:
        filtered_workouts = [w for w in filtered_workouts if w.get('date') == w_date]
    elif w_month:
        filtered_workouts = [w for w in filtered_workouts if str(w.get('date', '')).startswith(f'{w_month}-')]
        
    # Ordenar por fecha descendente
    filtered_workouts.sort(key=lambda x: x.get('date', ''), reverse=True)
    
    return jsonify(filtered_workouts)

@app.route('/api/latest_exercises/<string:workout_type>', methods=['GET'])
def get_latest_exercises(workout_type):
    """
    Recopila la versión más reciente de cada ejercicio único para un grupo muscular.
    Busca en 'type' (legacy) o en 'types' array (nuevo sistema).
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    all_workouts = load_data_for_user(username)
    normalized_type = canonicalize_type(workout_type)
    
    workouts_by_type = [
        filtered for filtered in (filter_workout_by_type(workout, normalized_type) for workout in all_workouts)
        if filtered
    ]
    
    # 2. Ordenar por fecha (más reciente primero)
    workouts_by_type.sort(key=lambda x: x.get('date', ''), reverse=True)
    
    # 3. Recopilar la última versión de cada ejercicio
    latest_exercises = {}
    for session in workouts_by_type:
        for exercise in session.get('exercises', []):
            exercise_name = exercise.get('name')
            if exercise_name and exercise_name not in latest_exercises:
                latest_exercises[exercise_name] = exercise
                
    # 4. Devolver la lista de ejercicios únicos
    return jsonify(list(latest_exercises.values()))

@app.route('/api/history/<string:workout_type>', methods=['GET'])
def get_workout_history(workout_type):
    """
    Devuelve todo el historial de entrenamientos para un grupo muscular.
    Busca en 'type' (legacy) o en 'types' array (nuevo sistema).
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    all_workouts = load_data_for_user(username)
    normalized_type = canonicalize_type(workout_type)
    
    workouts_by_type = [
        filtered for filtered in (filter_workout_by_type(workout, normalized_type) for workout in all_workouts)
        if filtered
    ]
    
    # Ordenar por fecha (más reciente primero)
    workouts_by_type.sort(key=lambda x: x.get('date', ''), reverse=True)
    
    return jsonify(workouts_by_type)

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'storage': 'postgres' if USE_POSTGRES else 'json'
    })

@app.route('/')
def index():
    """Sirve el archivo principal de la aplicación."""
    response = send_from_directory('.', 'index.html', max_age=0, conditional=False, etag=False)
    return apply_no_cache_headers(response)

@app.route('/<path:path>')
def static_files(path):
    """Sirve archivos estáticos como CSS y JS."""
    if os.path.exists(path):
        response = send_from_directory('.', path, max_age=0, conditional=False, etag=False)
        if is_frontend_asset(path):
            return apply_no_cache_headers(response)
        return response
    else:
        return ("File not found", 404)

@app.route('/api/save_draft', methods=['POST'])
def save_draft_workout():
    """
    Guarda un borrador de entrenamiento (sobreescribe el existente).
    Ignora campos innecesarios, similar a save_workout.
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    draft = normalize_workout_payload(request.get_json())

    if not draft:
        return jsonify({'status': 'error', 'message': 'Datos incompletos.'}), 400

    # Añadir bandera de draft y timestamp
    draft['isDraft'] = True
    draft['savedAt'] = datetime.now().isoformat()

    save_draft_for_user(username, draft)
    
    return jsonify({'status': 'success', 'message': 'Borrador guardado.'})

@app.route('/api/get_draft', methods=['GET'])
def get_draft():
    """
    Devuelve el borrador actual si existe.
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    draft = load_draft_for_user(username)
    if draft:
        return jsonify(draft)
    return jsonify(None)

@app.route('/api/body_weight', methods=['GET'])
def get_body_weight():
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    entries = load_body_weight_for_user(username)
    entries.sort(key=lambda item: item.get('date', ''), reverse=True)
    return jsonify(entries)

@app.route('/api/body_weight', methods=['POST'])
def save_body_weight():
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    entry = normalize_body_weight_entry(request.get_json() or {})
    if not entry:
        return jsonify({'status': 'error', 'message': 'Fecha o peso corporal invalidos.'}), 400

    entries = load_body_weight_for_user(username)
    updated = False
    for index, current_entry in enumerate(entries):
        if current_entry.get('date') == entry['date']:
            entries[index] = entry
            updated = True
            break

    if not updated:
        entries.append(entry)

    entries.sort(key=lambda item: item.get('date', ''), reverse=True)
    save_body_weight_for_user(username, entries)

    return jsonify({'status': 'success', 'entry': entry})

@app.route('/api/nutrition', methods=['GET'])
def get_nutrition():
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    payload = load_nutrition_for_user(username)
    payload['entries'].sort(key=lambda item: (item.get('date', ''), item.get('meal', ''), item.get('name', '')), reverse=True)
    return jsonify(payload)

@app.route('/api/nutrition/goals', methods=['POST'])
def save_nutrition_goals():
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    current_payload = load_nutrition_for_user(username)
    current_payload['goals'] = normalize_nutrition_goals(request.get_json() or {})
    save_nutrition_for_user(username, current_payload)

    return jsonify({'status': 'success', 'goals': current_payload['goals']})

@app.route('/api/nutrition/entry', methods=['POST'])
def save_nutrition_entry():
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    entry = normalize_nutrition_entry(request.get_json() or {})
    if not entry:
        return jsonify({'status': 'error', 'message': 'Introduce fecha, alimento y al menos un valor nutricional.'}), 400

    payload = load_nutrition_for_user(username)
    entries = [item for item in payload['entries'] if item.get('id') != entry['id']]
    entries.append(entry)
    payload['entries'] = entries
    save_nutrition_for_user(username, payload)

    return jsonify({'status': 'success', 'entry': entry})

@app.route('/api/nutrition/entry/<string:entry_id>', methods=['DELETE'])
def delete_nutrition_entry(entry_id):
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    payload = load_nutrition_for_user(username)
    payload['entries'] = [item for item in payload['entries'] if item.get('id') != entry_id]
    save_nutrition_for_user(username, payload)

    return jsonify({'status': 'success', 'message': 'Entrada eliminada.'})

@app.route('/api/delete_draft', methods=['DELETE'])
def delete_draft():
    """
    Elimina el borrador si existe.
    """
    username, auth_error = require_auth()
    if auth_error:
        return auth_error

    delete_draft_for_user(username)
    return jsonify({'status': 'success', 'message': 'Borrador eliminado.'})

initialize_storage()
load_users()
load_workout_store()
load_draft_store()
load_body_weight_store()
load_nutrition_store()

if __name__ == '__main__':
    # Ejecuta la aplicación en modo debug para desarrollo.
    # El host 0.0.0.0 hace que sea accesible desde otros dispositivos en la misma red.
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '5000')), debug=env_flag('FLASK_DEBUG', False))
