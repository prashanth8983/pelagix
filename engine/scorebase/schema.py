"""The shape of every config file, so the CLI, the API and the app's editor reject the
same mistakes with the same messages."""
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

IDENT = r"^[A-Za-z_][A-Za-z0-9_]*$"
FORMATS = ("number", "money", "count", "ratio", "percent", "days", "date", "text")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Warehouse(_Model):
    kind: Literal["duckdb", "snowflake"] = "duckdb"
    path: str | None = None          # duckdb file
    database: str | None = None      # snowflake
    schema_: str | None = Field(None, alias="schema")
    compute: str | None = None


class Publish(_Model):
    postgres_url_env: str = "SCOREBASE_PG_URL"
    table: str = Field("entity_scores", pattern=IDENT)


class Display(_Model):
    """How the app lists entities. Every name here must be a score."""
    entity_label: str | None = None                 # plural, e.g. "Customers"
    columns: list[str] = []                         # shown in the members table, in order
    highlight: str | None = None                    # drawn as a bar (a 0..1 score)
    default_sort: str | None = None
    sort_dir: Literal["asc", "desc"] = "desc"


class Project(_Model):
    name: str | None = None
    entity: str = "entity"
    key: str = Field(pattern=IDENT)
    entity_table: str | None = Field(None, pattern=IDENT)
    entity_key: str | None = Field(None, pattern=IDENT)
    warehouse: Warehouse = Warehouse()
    publish: Publish = Publish()
    display: Display = Display()

    @model_validator(mode="after")
    def _entity_pair(self):
        if bool(self.entity_table) != bool(self.entity_key):
            raise ValueError("entity_table and entity_key go together")
        return self


class Checks(_Model):
    columns: list[str] = []     # must exist
    not_null: list[str] = []
    unique: list[str] = []
    min_rows: int | None = Field(None, ge=0)


class Source(_Model):
    name: str = Field(pattern=IDENT)
    connector: Literal["csv", "parquet", "json", "postgres"] = "csv"
    path: str | None = None             # file, glob, or s3:// / https:// URL
    dsn_env: str | None = None          # postgres: env var holding the connection string
    table: str | None = None            # postgres: schema.table
    query: str | None = None            # postgres: or a query instead of a table
    options: dict[str, Any] = {}        # passed to the reader, e.g. {delim: ";", header: true}
    mode: Literal["replace", "incremental"] = "replace"
    cursor: str | None = Field(None, pattern=IDENT)   # incremental: only rows above max(cursor)
    checks: Checks = Checks()

    @model_validator(mode="after")
    def _connector_fields(self):
        if self.connector == "postgres":
            if not self.dsn_env or not (self.table or self.query):
                raise ValueError("postgres sources need dsn_env and table or query")
        elif not self.path:
            raise ValueError(f"{self.connector} sources need a path")
        if self.mode == "incremental" and not self.cursor:
            raise ValueError("incremental sources need a cursor column")
        return self

    @field_validator("options")
    @classmethod
    def _option_keys(cls, v):
        import re
        for k in v:
            if not re.match(IDENT, k):
                raise ValueError(f"bad option name: {k}")
        return v


class Score(_Model):
    name: str = Field(pattern=IDENT)
    sql: str = Field(min_length=1)
    label: str | None = None
    description: str | None = None
    format: Literal[FORMATS] = "number"  # type: ignore[valid-type]
    default: float | int | None = None    # value for entities with no rows in `from`
    window: bool = False


class Scores(_Model):
    from_: str = Field(alias="from", min_length=1)
    where: str | None = None
    key_expr: str = Field(min_length=1)
    scores: list[Score] = Field(min_length=1)

    @field_validator("scores")
    @classmethod
    def _unique(cls, v):
        names = [s.name for s in v]
        dup = {n for n in names if names.count(n) > 1}
        if dup:
            raise ValueError(f"duplicate score names: {sorted(dup)}")
        return v


class Rule(_Model):
    column: str = Field(pattern=IDENT)
    op: Literal[">", ">=", "<", "<=", "=", "!="]
    value: float | int

    @field_validator("value", mode="before")
    @classmethod
    def _no_bool(cls, v):
        if isinstance(v, bool):
            raise ValueError("segment rule values must be numbers")
        return v


class Segment(_Model):
    name: str = Field(pattern=IDENT)
    label: str | None = None
    description: str | None = None
    rules: list[Rule] = []


class Table(_Model):
    description: str = ""
    columns: dict[str, str] = {}


class Model(_Model):
    tables: dict[str, Table] = {}
    joins: list[str] = []
    synonyms: dict[str, str] = {}


class Golden(_Model):
    question: str = Field(min_length=3)
    sql: str = Field(min_length=1)


SECTIONS = {
    "project": ("project.yaml", Project),
    "sources": ("sources.yaml", list[Source]),
    "scores": ("scores.yaml", Scores),
    "segments": ("segments.yaml", list[Segment]),
    "model": ("model.yaml", Model),
    "golden": ("golden.yaml", list[Golden]),
}


def errors(section: str, data) -> list[str]:
    """Validation messages for one section, as 'path: message' strings."""
    from pydantic import TypeAdapter

    _, shape = SECTIONS[section]
    try:
        TypeAdapter(shape).validate_python(data)
    except ValidationError as e:
        return [f"{'.'.join(map(str, err['loc'])) or section}: {err['msg']}" for err in e.errors()]
    return []
