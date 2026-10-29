"""Synthetic retail data shaped like BigQuery's public TheLook eCommerce dataset.

Same table and column names as TheLook, so swapping in the real export only means
changing paths in sources.yaml. Dates run up to today so recency scores are meaningful.
Deterministic for a given seed.
"""
import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

STATES = ["California", "Texas", "New York", "Florida", "Illinois", "Washington",
          "Massachusetts", "Georgia", "Colorado", "New Jersey"]
SOURCES = [("Search", 0.45), ("Organic", 0.2), ("Facebook", 0.15), ("Email", 0.1), ("Display", 0.1)]
CATEGORIES = {
    "Women": ["Jeans", "Dresses", "Tops & Tees", "Sweaters", "Outerwear & Coats", "Accessories"],
    "Men": ["Jeans", "Shirts", "Tops & Tees", "Sweaters", "Outerwear & Coats", "Active"],
}
BRANDS = ["Northwind", "Calder", "Lumen", "Aster", "Juniper", "Harbor", "Vela", "Oakline"]
EVENTS = ["home", "department", "product", "cart", "purchase"]


def _pick(rng, weighted):
    return rng.choices([w[0] for w in weighted], [w[1] for w in weighted])[0]


def _write(path: Path, header: list[str], rows: list[list]):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def generate(out_dir: Path, users: int = 20000, seed: int = 7) -> dict[str, int]:
    rng = random.Random(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now().replace(microsecond=0)
    start = now - timedelta(days=3 * 365)
    fmt = "%Y-%m-%d %H:%M:%S"

    products = []
    pid = 1
    for dept, cats in CATEGORIES.items():
        for cat in cats:
            for _ in range(40):
                price = round(rng.lognormvariate(3.6, 0.5), 2)
                products.append([pid, cat, dept, rng.choice(BRANDS), price])
                pid += 1
    _write(out_dir / "products.csv", ["id", "category", "department", "brand", "retail_price"], products)

    user_rows, order_rows, item_rows, event_rows = [], [], [], []
    oid = iid = eid = 1
    for uid in range(1, users + 1):
        created = start + timedelta(seconds=rng.randint(0, int((now - start).total_seconds() * 0.9)))
        src = _pick(rng, SOURCES)
        user_rows.append([uid, rng.randint(18, 70), rng.choice("MF"), rng.choice(STATES),
                          src, created.strftime(fmt)])
        # each customer has a loyalty level and may stop buying at some point
        rate = rng.lognormvariate(-4.2, 0.8)  # orders per day
        if src == "Email":
            rate *= 1.4
        churn_at = created + timedelta(days=rng.expovariate(1 / 400)) if rng.random() < 0.55 else now
        t = created
        while True:
            t += timedelta(days=rng.expovariate(rate))
            if t > min(churn_at, now):
                break
            status = _pick(rng, [("Complete", 0.62), ("Shipped", 0.18), ("Processing", 0.06),
                                 ("Cancelled", 0.08), ("Returned", 0.06)])
            n_items = rng.choice([1, 1, 1, 2, 2, 3, 4])
            order_rows.append([oid, uid, status, t.strftime(fmt), n_items])
            for _ in range(n_items):
                p = rng.choice(products)
                sale = round(p[4] * rng.uniform(0.7, 1.0), 2)
                item_rows.append([iid, oid, uid, p[0], status, t.strftime(fmt), sale])
                iid += 1
            oid += 1
        for _ in range(rng.randint(1, 8)):
            et = created + timedelta(seconds=rng.randint(0, int((now - created).total_seconds())))
            event_rows.append([eid, uid, rng.choice(EVENTS), src, et.strftime(fmt)])
            eid += 1

    _write(out_dir / "users.csv", ["id", "age", "gender", "state", "traffic_source", "created_at"], user_rows)
    _write(out_dir / "orders.csv", ["order_id", "user_id", "status", "created_at", "num_of_item"], order_rows)
    _write(out_dir / "order_items.csv",
           ["id", "order_id", "user_id", "product_id", "status", "created_at", "sale_price"], item_rows)
    _write(out_dir / "events.csv", ["id", "user_id", "event_type", "traffic_source", "created_at"], event_rows)
    return {"users": len(user_rows), "products": len(products), "orders": len(order_rows),
            "order_items": len(item_rows), "events": len(event_rows)}
