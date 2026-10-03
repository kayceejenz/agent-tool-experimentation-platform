"""Business definitions and bounded tools for the Excel ecommerce demo."""

from collections import defaultdict
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from ecommerce_mcp.store import SOURCES, ExcelStore, records

REGIONS = ("London", "Midlands", "North", "Scotland", "Wales")
COMPLETED = {"paid", "shipped", "delivered"}


def money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def today():
    return datetime.now(ZoneInfo("Europe/London")).date().isoformat()


def month_key(month):
    month = month or today()[:7]
    try:
        date.fromisoformat(f"{month}-01")
        if len(month) != 7:
            raise ValueError
    except ValueError:
        raise ValueError("Use a month in YYYY-MM format.") from None
    return month


def page(rows, limit=20, offset=0):
    if not 1 <= limit <= 100 or offset < 0:
        raise ValueError("Limit must be 1–100 and offset must be nonnegative.")
    return {
        "items": rows[offset : offset + limit],
        "total": len(rows),
        "next_offset": offset + limit if offset + limit < len(rows) else None,
    }


def find(rows, field, identifier):
    for row in rows:
        if row[field] == identifier:
            return row
    raise ValueError(f"Unknown {field}.")


def allowed(product, region):
    return (
        product["active"]
        and product["stock"] > 0
        and product["region"] in ("All", region)
    )


def features(product):
    return set(str(product["tags"]).split("|")) | {product["category"].lower()}


def similarity(left, right):
    a, b = features(left), features(right)
    return len(a & b) / len(a | b) if a | b else 0


class EcommerceService:
    def __init__(self, store: ExcelStore):
        self.store = store

    def describe(self):
        orders = self.store.source("orders")
        return {
            "synthetic": True,
            "currency": "GBP",
            "snapshot_date": "2026-10-03",
            "available_months": sorted({order["order_date"][:7] for order in orders}),
            "default_month": today()[:7],
            "timezone": "Europe/London",
            "tables": {
                name: {
                    "file": location[0],
                    "sheet": location[1],
                    "rows": len(self.store.rows(name)),
                }
                for name, location in SOURCES.items()
            },
            "regions": REGIONS,
            "definitions": {
                "sales": "Paid, shipped and delivered order lines. Excludes pending, draft, cancelled and refunded orders. Net merchandise amounts after line discount, before tax and shipping.",
                "purchase_history": "Read-only snapshot derived from qualifying seed orders. Live analytics join authoritative orders and order_items, never add snapshot totals to orders.",
                "recommendations": "Content similarity of category and tags. Scores are similarity, not calibrated purchase probabilities. New customers use popularity fallback.",
                "writes": "Append-only draft invoices, draft orders and synthetic customers in records.xlsx. No payment, fulfilment, stock reservation or email sending.",
                "currency": "All prices and totals are GBP. No tax or shipping calculation is performed.",
            },
        }

    def search_products(
        self,
        query="",
        category=None,
        region=None,
        min_price=None,
        max_price=None,
        in_stock=True,
        limit=20,
        offset=0,
    ):
        if region and region not in REGIONS:
            raise ValueError("Unknown region.")
        if min_price is not None and max_price is not None and min_price > max_price:
            raise ValueError("Minimum price exceeds maximum price.")
        rows = self.store.rows("products")
        rows = [
            p
            for p in rows
            if p["active"]
            and (not in_stock or p["stock"] > 0)
            and (
                not query
                or query.lower()
                in " ".join(
                    str(p[k]) for k in ("product_id", "name", "description", "tags")
                ).lower()
            )
            and (not category or p["category"].lower() == category.lower())
            and (not region or p["region"] in ("All", region))
            and (min_price is None or p["price"] >= min_price)
            and (max_price is None or p["price"] <= max_price)
        ]
        return {"currency": "GBP", **page(rows, limit, offset)}

    def list_customers(self, query="", region=None, limit=20, offset=0):
        rows = self.store.rows("users")
        rows = [
            u
            for u in rows
            if (
                not query
                or query.lower() in f"{u['user_id']} {u['name']} {u['email']}".lower()
            )
            and (not region or u["region"] == region)
        ]
        return page(rows, limit, offset)

    def orders(self, user_id=None, month=None, status=None, limit=20, offset=0):
        if user_id:
            find(self.store.rows("users"), "user_id", user_id)
        if month:
            month = month_key(month)
        rows = [
            o
            for o in self.store.rows("orders")
            if (not user_id or o["user_id"] == user_id)
            and (not month or o["order_date"][:7] == month)
            and (not status or o["status"] == status)
        ]
        rows.sort(key=lambda o: (o["order_date"], o["order_id"]), reverse=True)
        return page(rows, limit, offset)

    def order_detail(self, order_id):
        order = find(self.store.rows("orders"), "order_id", order_id)
        return {
            "order": order,
            "items": [
                i for i in self.store.rows("order_items") if i["order_id"] == order_id
            ],
        }

    def sales(self, month=None, region=None, user_id=None):
        if month:
            month = month_key(month)
        if region and region not in REGIONS:
            raise ValueError("Unknown region.")
        orders = {
            o["order_id"]: o
            for o in self.store.rows("orders")
            if o["status"] in COMPLETED
            and (not month or o["order_date"][:7] == month)
            and (not region or o["region"] == region)
            and (not user_id or o["user_id"] == user_id)
        }
        return [
            {
                **line,
                "user_id": orders[line["order_id"]]["user_id"],
                "order_date": orders[line["order_id"]]["order_date"],
                "region": orders[line["order_id"]]["region"],
            }
            for line in self.store.rows("order_items")
            if line["order_id"] in orders
        ]

    def purchase_history(self, user_id, month=None, limit=20, offset=0):
        find(self.store.rows("users"), "user_id", user_id)
        rows = self.sales(month=month, user_id=user_id)
        rows.sort(key=lambda x: (x["order_date"], x["order_id"]), reverse=True)
        return {"currency": "GBP", "user_id": user_id, **page(rows, limit, offset)}

    def ranking(self, kind, month=None, metric=None, region=None, limit=10):
        month = month_key(month)
        metric = metric or ("units" if kind == "products" else "spend")
        valid = (
            {"units", "revenue", "buyers"}
            if kind == "products"
            else {"spend", "orders", "units"}
        )
        if metric not in valid:
            raise ValueError("Unsupported ranking metric.")
        key = "product_id" if kind == "products" else "user_id"
        aggregates = defaultdict(
            lambda: {"units": 0, "amount": Decimal(0), "orders": set(), "buyers": set()}
        )
        lines = self.sales(month, region)
        for line in lines:
            group = aggregates[line[key]]
            group["units"] += line["quantity"]
            group["amount"] += money(line["line_total"])
            group["orders"].add(line["order_id"])
            group["buyers"].add(line["user_id"])
        names = {
            r[key]: r["name"]
            for r in self.store.rows("products" if kind == "products" else "users")
        }
        results = [
            {
                key: identifier,
                "name": names[identifier],
                "units": row["units"],
                "revenue" if kind == "products" else "spend": float(row["amount"]),
                "orders": len(row["orders"]),
                "buyers": len(row["buyers"]),
            }
            for identifier, row in aggregates.items()
        ]
        results.sort(key=lambda row: (-row[metric], row[key]))
        return {
            "month": month,
            "region": region or "All",
            "currency": "GBP",
            "ranked_by": metric,
            "qualifying_order_count": len({line["order_id"] for line in lines}),
            "sales_definition": "Paid, shipped and delivered; after discounts, before tax and shipping.",
            **page(results, limit),
        }

    def recommendations(self, user_id=None, product_id=None, region=None, limit=5):
        if bool(user_id) == bool(product_id):
            raise ValueError("Provide exactly one of user_id or product_id.")
        products = self.store.rows("products")
        by_id = {p["product_id"]: p for p in products}
        purchased = set()
        if user_id:
            user = find(self.store.rows("users"), "user_id", user_id)
            region = region or user["region"]
            purchased = {line["product_id"] for line in self.sales(user_id=user_id)}
            anchors = [by_id[identifier] for identifier in purchased]
        else:
            anchors = [find(products, "product_id", product_id)]
        if region and region not in REGIONS:
            raise ValueError("Unknown region.")
        popularity = defaultdict(set)
        for line in self.sales(region=region):
            popularity[line["product_id"]].add(line["user_id"])
        rows = []
        for product in products:
            identifier = product["product_id"]
            if (
                identifier in purchased
                or identifier == product_id
                or not product["active"]
                or product["stock"] <= 0
            ):
                continue
            if region and not allowed(product, region):
                continue
            score = max((similarity(product, anchor) for anchor in anchors), default=0)
            if anchors and score == 0:
                continue
            best = max(
                anchors, key=lambda anchor: similarity(product, anchor), default=None
            )
            rows.append(
                {
                    "product_id": identifier,
                    "name": product["name"],
                    "price": product["price"],
                    "similarity_score": round(score, 4),
                    "historical_buyers": len(popularity[identifier]),
                    "reason": f"Shares {', '.join(sorted(features(product) & features(best)))} with {best['name']}."
                    if best
                    else "Popularity fallback: no completed purchase history.",
                    "region": product["region"],
                }
            )
        rows.sort(
            key=lambda r: (
                -r["similarity_score"],
                -r["historical_buyers"],
                r["product_id"],
            )
        )
        return {
            "method": "category/tag Jaccard similarity"
            if anchors
            else "unique historical buyers",
            "currency": "GBP",
            "region": region or "All",
            "probability_estimate": False,
            "excluded_previously_purchased": bool(user_id),
            **page(rows, limit),
        }

    def audience_recommendations(self, region=None, limit=10):
        """Rank products by how often they appear in customers' top three content matches."""
        if region and region not in REGIONS:
            raise ValueError("Unknown region.")
        users = [
            u for u in self.store.rows("users") if not region or u["region"] == region
        ]
        products = self.store.rows("products")
        by_id = {p["product_id"]: p for p in products}
        purchases = defaultdict(set)
        for line in self.sales():
            purchases[line["user_id"]].add(line["product_id"])
        totals = defaultdict(lambda: {"customers": 0, "score": 0.0})
        eligible_users = 0
        for user in users:
            bought = purchases[user["user_id"]]
            if not bought:
                continue
            eligible_users += 1
            candidates = []
            for product in products:
                if product["product_id"] in bought or not allowed(
                    product, user["region"]
                ):
                    continue
                score = max(
                    similarity(product, by_id[identifier]) for identifier in bought
                )
                if score > 0:
                    candidates.append((score, product["product_id"]))
            for score, identifier in sorted(
                candidates, key=lambda pair: (-pair[0], pair[1])
            )[:3]:
                totals[identifier]["customers"] += 1
                totals[identifier]["score"] += score
        rows = [
            {
                "product_id": identifier,
                "name": by_id[identifier]["name"],
                "recommended_customer_count": total["customers"],
                "average_similarity": round(total["score"] / total["customers"], 4),
            }
            for identifier, total in totals.items()
        ]
        rows.sort(
            key=lambda row: (
                -row["recommended_customer_count"],
                -row["average_similarity"],
                row["product_id"],
            )
        )
        return {
            "method": "Count of top-three positive content matches among customers with completed purchases.",
            "region": region or "All",
            "customers_considered": eligible_users,
            "customers_without_history": len(users) - eligible_users,
            "probability_estimate": False,
            **page(rows, limit),
        }

    def create_customer(self, name, age, email, region, request_key):
        name, email = name.strip(), email.strip().lower()
        if not name or not 18 <= age <= 120 or region not in REGIONS:
            raise ValueError(
                "Provide a name, an adult age (18–120), and a supported region."
            )
        if (
            email.count("@") != 1
            or not email.endswith("@example.test")
            or any(c.isspace() for c in email)
        ):
            raise ValueError(
                "Use a synthetic email ending in @example.test for this demo."
            )
        payload = {"name": name, "age": age, "email": email, "region": region}
        with self.store.transaction() as workbook:
            existing, digest = self.store.request(
                workbook, request_key, "create_customer", payload
            )
            if existing:
                return find(records(workbook["Users"]), "user_id", existing)
            users = self.store.source("users") + records(workbook["Users"])
            if any(user["email"].lower() == email for user in users):
                raise ValueError("A customer with that email already exists.")
            result = {
                "user_id": f"USR-{uuid4().hex[:12]}",
                **payload,
                "joined_date": today(),
            }
            self.store.append(workbook, "Users", result)
            self.store.append(
                workbook,
                "Requests",
                {
                    "request_key": request_key,
                    "operation": "create_customer",
                    "payload_hash": digest,
                    "entity_id": result["user_id"],
                },
            )
            return result

    def create_document(self, kind, user_id, items, request_key):
        if kind not in ("invoice", "order"):
            raise ValueError("Unknown document kind.")
        payload = {"user_id": user_id, "items": items}
        with self.store.transaction() as workbook:
            existing, digest = self.store.request(
                workbook, request_key, f"create_{kind}", payload
            )
            sheet, item_sheet, key = (
                ("Invoices", "InvoiceItems", "invoice_id")
                if kind == "invoice"
                else ("Orders", "OrderItems", "order_id")
            )
            if existing:
                return {
                    "document": find(records(workbook[sheet]), key, existing),
                    "items": [
                        r for r in records(workbook[item_sheet]) if r[key] == existing
                    ],
                    "replayed": True,
                }
            user = find(
                self.store.source("users") + records(workbook["Users"]),
                "user_id",
                user_id,
            )
            quantities = defaultdict(int)
            for item in items:
                if (
                    isinstance(item["quantity"], bool)
                    or not isinstance(item["quantity"], int)
                    or not 1 <= item["quantity"] <= 100
                ):
                    raise ValueError("Quantity must be a whole number from 1 to 100.")
                quantities[item["product_id"]] += item["quantity"]
            if not 1 <= len(items) <= 20:
                raise ValueError("Provide 1–20 line items.")
            products = self.store.source("products")
            identifier = f"{'INV' if kind == 'invoice' else 'ORD'}-{uuid4().hex[:12]}"
            lines = []
            for product_id, quantity in sorted(quantities.items()):
                product = find(products, "product_id", product_id)
                if (
                    not allowed(product, user["region"])
                    or quantity > product["stock"]
                    or quantity > 100
                ):
                    raise ValueError(
                        "A product is unavailable in this customer's region or requested quantity."
                    )
                amount = money(money(product["price"]) * quantity)
                lines.append(
                    {
                        key: identifier,
                        "line_id": f"{identifier}-{len(lines) + 1}",
                        "product_id": product_id,
                        "product_name": product["name"],
                        "quantity": quantity,
                        "unit_price": float(money(product["price"])),
                        "discount": 0,
                        "line_total": float(amount),
                    }
                )
            total = sum((money(line["line_total"]) for line in lines), Decimal(0))
            document = {
                key: identifier,
                "user_id": user_id,
                f"{kind}_date": today(),
                "status": "draft",
                "region": user["region"],
                "currency": "GBP",
                "total": float(total),
            }
            if kind == "invoice":
                document.update(
                    customer_name=user["name"],
                    customer_email=user["email"],
                    note="Demo draft. Tax and shipping not calculated. No payment or order placed.",
                )
            self.store.append(workbook, sheet, document)
            for line in lines:
                self.store.append(workbook, item_sheet, line)
            self.store.append(
                workbook,
                "Requests",
                {
                    "request_key": request_key,
                    "operation": f"create_{kind}",
                    "payload_hash": digest,
                    "entity_id": identifier,
                },
            )
            return {"document": document, "items": lines, "replayed": False}

    def invoices(self, user_id=None, limit=20, offset=0):
        return page(
            [
                r
                for r in self.store.working("Invoices")
                if not user_id or r["user_id"] == user_id
            ],
            limit,
            offset,
        )

    def invoice_detail(self, invoice_id):
        # Hold the same lock across both reads for a consistent snapshot.
        with self.store.lock:
            return {
                "document": find(
                    self.store.working("Invoices"), "invoice_id", invoice_id
                ),
                "items": [
                    r
                    for r in self.store.working("InvoiceItems")
                    if r["invoice_id"] == invoice_id
                ],
            }
