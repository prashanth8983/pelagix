"""The shape of every config file, so the CLI, the API and the app's editor reject the
same mistakes with the same messages."""
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

IDENT = r"^[A-Za-z_][A-Za-z0-9_]*$"
IDENT_RE = re.compile(IDENT)
FORMATS = ("number", "money", "count", "ratio", "percent", "days", "date", "text")
OPS = (">", ">=", "<", "<=", "=", "!=", "in", "not_in", "is_null", "is_not_null")
Scalar = float | int | str


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Warehouse(_Model):
    kind: Literal["duckdb", "postgres", "snowflake"] = "duckdb"
    path: str | None = None          # duckdb: database file
    url_env: str | None = None       # postgres: env var holding the URL (default SCOREBASE_WAREHOUSE_URL)
    database: str | None = None      # snowflake
    schema_: str | None = Field(None, alias="schema", pattern=IDENT)   # postgres, snowflake
    compute: str | None = None       # snowflake


class Publish(_Model):
    postgres_url_env: str = "SCOREBASE_PG_URL"
    table: str = Field("entity_scores", pattern=IDENT)
    history: bool = False            # keep <table>_history: one row per entity per run


class Display(_Model):
    """How the app lists entities. Every name here must be a score (or an attribute, for columns)."""
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
    attributes: list[str] = []                      # entity table columns copied into the score table
    warehouse: Warehouse = Warehouse()
    publish: Publish = Publish()
    display: Display = Display()

    @model_validator(mode="after")
    def _entity_pair(self):
        if bool(self.entity_table) != bool(self.entity_key):
            raise ValueError("entity_table and entity_key go together")
        return self

    @field_validator("attributes")
    @classmethod
    def _attr_names(cls, v):
        bad = [a for a in v if not IDENT_RE.match(a)]
        if bad:
            raise ValueError(f"not column names: {bad}")
        dup = {a for a in v if v.count(a) > 1}
        if dup:
            raise ValueError(f"duplicate attributes: {sorted(dup)}")
        return v


class Checks(_Model):
    columns: list[str] = []     # must exist
    not_null: list[str] = []
    unique: list[str] = []
    min_rows: int | None = Field(None, ge=0)


class Source(_Model):
    name: str = Field(pattern=IDENT)
    connector: Literal["csv", "parquet", "json", "postgres"] = "csv"
    path: str | None = None             # file or glob under data/, or an allowed remote URL
    dsn_env: str | None = Field(None, pattern=r"^[A-Z][A-Z0-9_]*_(URL|DSN)$")   # postgres: env var with the URL
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
        for k in v:
            if not IDENT_RE.match(k):
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
    # An aggregate over another table: its own FROM (with joins), WHERE and key expression.
    from_: str | None = Field(None, alias="from", min_length=1)
    where: str | None = None
    key_expr: str | None = Field(None, min_length=1)

    @model_validator(mode="after")
    def _own_source(self):
        if self.from_ and not self.key_expr:
            raise ValueError("a score with its own `from` needs its own `key_expr`")
        if (self.where or self.key_expr) and not self.from_:
            raise ValueError("`where` and `key_expr` on a score go with its own `from`")
        return self


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
    op: Literal[OPS]  # type: ignore[valid-type]
    value: Scalar | list[Scalar] | None = None

    @field_validator("value", mode="before")
    @classmethod
    def _no_bool(cls, v):
        if isinstance(v, bool) or (isinstance(v, list) and any(isinstance(x, bool) for x in v)):
            raise ValueError("rule values must be numbers or text, not booleans")
        return v

    @model_validator(mode="after")
    def _value_shape(self):
        if self.op in ("is_null", "is_not_null"):
            if self.value is not None:
                raise ValueError(f"'{self.op}' takes no value")
        elif self.op in ("in", "not_in"):
            if not isinstance(self.value, list) or not self.value:
                raise ValueError(f"'{self.op}' needs a list of values")
        elif self.value is None or isinstance(self.value, list):
            raise ValueError(f"'{self.op}' needs one value")
        return self


class Segment(_Model):
    name: str = Field(pattern=IDENT)
    label: str | None = None
    description: str | None = None
    match: Literal["all", "any"] = "all"
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
        out = []
        for err in e.errors():
            loc = ".".join(str(x) for x in err["loc"] if not (isinstance(x, str) and x.startswith("function-")))
            msg = err["msg"].removeprefix("Value error, ")
            out.append(f"{loc or section}: {msg}")
        return out
    return []
