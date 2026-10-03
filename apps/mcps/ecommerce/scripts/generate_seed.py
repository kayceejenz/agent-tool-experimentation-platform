"""Generate deterministic synthetic records as JSON for the Excel authoring step."""

import json
import random
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from ecommerce_mcp.service import COMPLETED, REGIONS, similarity

rng = random.Random(20261003)
products = []
catalog = [
    (
        "Wireless Headphones",
        "Audio",
        89.99,
        "wireless|music|portable",
        "Comfortable wireless headphones for everyday music and calls.",
    ),
    (
        "Studio Headphones",
        "Audio",
        149.50,
        "music|studio|wired",
        "Detailed wired headphones for home recording and listening.",
    ),
    (
        "Travel Earbuds",
        "Audio",
        59.95,
        "wireless|music|portable|travel",
        "Compact wireless earbuds with a pocket charging case.",
    ),
    (
        "Bluetooth Speaker",
        "Audio",
        79.00,
        "wireless|music|portable|outdoor",
        "Portable speaker for small rooms and outdoor listening.",
    ),
    (
        "Desk Microphone",
        "Audio",
        69.00,
        "studio|wired|work",
        "USB microphone for meetings and recordings.",
    ),
    (
        "Creator Laptop",
        "Computing",
        1299.00,
        "work|portable|creative",
        "Portable laptop for creative work and everyday computing.",
    ),
    (
        "Compact Keyboard",
        "Computing",
        49.99,
        "work|wireless|desk",
        "Compact wireless keyboard for a tidy desk.",
    ),
    (
        "Wireless Mouse",
        "Computing",
        29.99,
        "work|wireless|desk|portable",
        "Comfortable wireless mouse for home and travel.",
    ),
    (
        "USB-C Dock",
        "Computing",
        99.00,
        "work|wired|desk",
        "Multiport dock for connecting a laptop to desk accessories.",
    ),
    (
        "Laptop Stand",
        "Computing",
        39.95,
        "work|desk|ergonomic",
        "Adjustable stand for a more comfortable laptop setup.",
    ),
    (
        "Desk Lamp",
        "Home",
        44.00,
        "desk|work|lighting",
        "Adjustable LED desk lamp for reading and work.",
    ),
    (
        "Reading Lamp",
        "Home",
        34.50,
        "reading|lighting|bedroom",
        "Warm bedside lamp for evening reading.",
    ),
    (
        "Storage Basket",
        "Home",
        24.00,
        "storage|organisation|home",
        "Woven basket for everyday household storage.",
    ),
    (
        "Water Bottle",
        "Outdoors",
        22.00,
        "travel|outdoor|fitness",
        "Reusable insulated bottle for commutes and walks.",
    ),
    (
        "Day Backpack",
        "Outdoors",
        64.00,
        "travel|outdoor|portable",
        "Lightweight day bag with organised compartments.",
    ),
    (
        "Rain Jacket",
        "Outdoors",
        79.50,
        "travel|outdoor|waterproof",
        "Packable rain jacket for changeable weather.",
    ),
    (
        "Yoga Mat",
        "Fitness",
        32.00,
        "fitness|home|stretching",
        "Supportive mat for stretching and floor workouts.",
    ),
    (
        "Resistance Bands",
        "Fitness",
        18.00,
        "fitness|portable|strength",
        "Set of resistance bands for home exercise.",
    ),
    (
        "Training Bag",
        "Fitness",
        42.00,
        "fitness|travel|storage",
        "Compact gym bag with separate accessory pockets.",
    ),
    (
        "Fitness Towel",
        "Fitness",
        12.50,
        "fitness|portable|travel",
        "Quick-drying towel for workouts and trips.",
    ),
    (
        "Coffee Grinder",
        "Kitchen",
        58.00,
        "coffee|home|kitchen",
        "Compact grinder for freshly ground coffee.",
    ),
    (
        "Travel Coffee Cup",
        "Kitchen",
        19.95,
        "coffee|travel|portable",
        "Reusable cup for hot drinks on the go.",
    ),
    (
        "Pour-over Brewer",
        "Kitchen",
        27.00,
        "coffee|home|kitchen",
        "Simple pour-over brewer for a daily coffee routine.",
    ),
    (
        "Kitchen Scale",
        "Kitchen",
        21.00,
        "coffee|kitchen|baking",
        "Digital scale for coffee and baking measurements.",
    ),
    (
        "Lunch Box",
        "Kitchen",
        17.50,
        "kitchen|travel|storage",
        "Reusable divided lunch box for work and day trips.",
    ),
    (
        "North Walking Guide",
        "Books",
        16.00,
        "outdoor|reading|travel",
        "Fictional walking guide covering northern routes.",
    ),
    (
        "Scotland Photo Guide",
        "Books",
        24.00,
        "creative|outdoor|reading",
        "Fictional guide to landscape photography in Scotland.",
    ),
    (
        "Home Coffee Guide",
        "Books",
        14.00,
        "coffee|home|reading",
        "Fictional beginner guide to home coffee brewing.",
    ),
    (
        "Premium Earbuds",
        "Audio",
        199.00,
        "wireless|music|portable",
        "Premium earbuds, currently out of stock in this demo.",
    ),
    (
        "Legacy Speaker",
        "Audio",
        49.00,
        "music|wired|home",
        "Discontinued wired speaker retained for historical records.",
    ),
]
for index, (name, category, price, tags, description) in enumerate(catalog, 1):
    products.append(
        {
            "product_id": f"PRD-{index:03d}",
            "name": name,
            "description": description,
            "category": category,
            "price": price,
            "currency": "GBP",
            "region": {26: "North", 27: "Scotland"}.get(index, "All"),
            "tags": tags,
            "stock": 0 if index == 29 else 40 + index * 3,
            "active": index != 30,
        }
    )
first = ["Alex", "Sam", "Morgan", "Taylor", "Jordan", "Casey", "Jamie", "Riley"]
last = ["Reed", "Clarke", "Brooks", "Ellis", "Hayes", "Parker"]
users = [
    {
        "user_id": f"USR-{i + 1:03d}",
        "name": f"{first[i % 8]} {last[i // 8]}",
        "age": 20 + (i * 7) % 49,
        "email": f"customer{i + 1:03d}@example.test",
        "region": REGIONS[i % 5],
        "joined_date": "2026-01-15",
    }
    for i in range(48)
]
orders, lines = [], []


def order(day, user, selected, status="delivered", discount=0):
    order_id = f"ORD-{len(orders) + 1:04d}"
    total = Decimal(0)
    for product, quantity in selected:
        amount = (
            Decimal(str(product["price"])) * quantity * (1 - Decimal(str(discount)))
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total += amount
        lines.append(
            {
                "line_id": f"LIN-{len(lines) + 1:05d}",
                "order_id": order_id,
                "product_id": product["product_id"],
                "product_name": product["name"],
                "quantity": quantity,
                "unit_price": product["price"],
                "discount": discount,
                "line_total": float(amount),
            }
        )
    orders.append(
        {
            "order_id": order_id,
            "user_id": user["user_id"],
            "order_date": day,
            "status": status,
            "region": user["region"],
            "currency": "GBP",
            "total": float(total),
        }
    )


for index in range(260):
    day = (date(2026, 7, 1) + timedelta(days=rng.randrange(92))).isoformat()
    user = users[
        index % 44
    ]  # Four customers intentionally have no completed purchase history.
    eligible = [p for p in products[:28] if p["region"] in ("All", user["region"])]
    selected = [(p, rng.randint(1, 3)) for p in rng.sample(eligible, rng.randint(1, 3))]
    status = rng.choices(
        ["delivered", "shipped", "paid", "pending", "cancelled", "refunded"],
        [60, 12, 12, 6, 5, 5],
    )[0]
    order(day, user, selected, status, rng.choice([0, 0, 0.05, 0.10]))
for index in range(24):
    order(
        f"2026-10-{index % 3 + 1:02d}",
        users[index % 20],
        [(products[0], 2), (products[21], 1)],
        "delivered",
    )
order("2026-10-02", users[0], [(products[5], 4)], "paid")
order("2026-10-03", users[1], [(products[5], 10)], "cancelled")
order("2026-10-03", users[2], [(products[5], 8)], "refunded")
by_id = {o["order_id"]: o for o in orders}
purchases = [
    dict(
        purchase_id=f"PUR-{i + 1:05d}",
        **line,
        user_id=by_id[line["order_id"]]["user_id"],
        purchase_date=by_id[line["order_id"]]["order_date"],
        region=by_id[line["order_id"]]["region"],
    )
    for i, line in enumerate(lines)
    if by_id[line["order_id"]]["status"] in COMPLETED
]
recommendations = []
for product in products:
    candidates = sorted(
        [
            (similarity(product, p), p)
            for p in products
            if p["product_id"] != product["product_id"]
            and p["active"]
            and p["stock"] > 0
        ],
        key=lambda x: (-x[0], x[1]["product_id"]),
    )
    for rank, (score, candidate) in enumerate(candidates[:3], 1):
        recommendations.append(
            {
                "product_id": product["product_id"],
                "recommended_product_id": candidate["product_id"],
                "rank": rank,
                "similarity_score": round(score, 4),
                "method": "category/tag Jaccard similarity",
                "snapshot_date": "2026-10-03",
            }
        )
schema = {
    "Users": list(users[0]),
    "Orders": list(orders[0]),
    "OrderItems": list(lines[0]),
    "Invoices": [
        "invoice_id",
        "user_id",
        "customer_name",
        "customer_email",
        "invoice_date",
        "status",
        "region",
        "currency",
        "total",
        "note",
    ],
    "InvoiceItems": [
        "invoice_id",
        "line_id",
        "product_id",
        "product_name",
        "quantity",
        "unit_price",
        "discount",
        "line_total",
    ],
    "Requests": ["request_key", "operation", "payload_hash", "entity_id"],
}
books = {
    "products": {"Products": products},
    "users": {"Users": users},
    "orders": {"Orders": orders, "OrderItems": lines},
    "purchase_history": {"Purchases": purchases},
    "recommendations": {"Recommendations": recommendations},
    "records": {k: [] for k in schema},
}
payload = {"books": books, "empty_schemas": schema, "snapshot_date": "2026-10-03"}
output = Path(__file__).with_name("seed-data.json")
output.write_text(json.dumps(payload, indent=2))
print(
    {
        book: {sheet: len(rows) for sheet, rows in sheets.items()}
        for book, sheets in books.items()
    }
)
