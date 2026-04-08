# Database migrations (Alembic)

Schema changes are versioned with [Alembic](https://alembic.sqlalchemy.org/). Install dependencies from `requirements.txt` (includes `alembic`).

Ensure `DATABASE_URL` is set in `.env` (same variable as the app), for example:

`mysql+pymysql://user:password@127.0.0.1:3306/your_database`

Run Alembic from the **project root** (where `alembic.ini` lives):

```bash
python -m alembic <command>
```

---

## Existing databases: stamp before autogenerate

If **`users` and `banner_tasks` already exist** (production or local), Alembic has no revision history yet. You must **stamp** the database to the current migration head **without** running `upgrade`, so Alembic records that the schema is already in place.

1. Ensure a baseline revision exists in `alembic/versions/` (this repo includes an empty baseline: `baseline_existing_schema`).
2. With `DATABASE_URL` pointing at that database:

   ```bash
   python -m alembic stamp head
   ```

This writes the `alembic_version` table and sets the revision to **head**, but does **not** execute `upgrade()` SQL. After that, future changes use autogenerate and `upgrade` normally.

**If you skip stamping** and run `alembic revision --autogenerate` first, Alembic may think every column is “new” and generate a migration that tries to recreate existing tables.

---

## Generate a migration after changing `models.py`

After editing `models.py`, create a revision from the model metadata diff:

```bash
python -m alembic revision --autogenerate -m "short description of change"
```

Review the generated file under `alembic/versions/` (autogenerate is not perfect, especially for renames and MySQL-specific types).

---

## Apply migrations

```bash
python -m alembic upgrade head
```

---

## Useful commands

| Command | Purpose |
|--------|---------|
| `python -m alembic current` | Show revision applied to the connected DB |
| `python -m alembic history` | List migration chain |
| `python -m alembic downgrade -1` | Step back one revision (use with care) |
