import asyncio
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from functools import partial
from hashlib import sha256

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from openpyxl import load_workbook

from ecommerce_mcp.server import create_server
from ecommerce_mcp.service import EcommerceService, money
from ecommerce_mcp.store import SEED, ExcelStore


@pytest.fixture
def service(tmp_path):
    return EcommerceService(ExcelStore(tmp_path))


def test_seed_references_dates_and_totals_reconcile(service):
    products = {r["product_id"] for r in service.store.rows("products")}
    users = {r["user_id"] for r in service.store.rows("users")}
    orders = {r["order_id"]: r for r in service.store.rows("orders")}
    assert len(products) == 30 and len(users) == 48 and len(orders) == 287
    totals = {key: Decimal(0) for key in orders}
    for line in service.store.rows("order_items"):
        assert line["product_id"] in products
        assert line["order_id"] in orders
        assert money(line["line_total"]) == money(
            Decimal(str(line["unit_price"]))
            * line["quantity"]
            * (1 - Decimal(str(line["discount"])))
        )
        totals[line["order_id"]] += money(line["line_total"])
    for key, order in orders.items():
        assert order["user_id"] in users
        assert "2026-07-01" <= order["order_date"] <= "2026-10-03"
        assert totals[key] == money(order["total"])
    snapshot = service.store.rows("purchase_history")
    assert {r["line_id"] for r in snapshot} == {r["line_id"] for r in service.sales()}
    assert sum((money(r["line_total"]) for r in snapshot), Decimal(0)) == sum(
        (money(r["line_total"]) for r in service.sales()), Decimal(0)
    )
    for recommendation in service.store.rows("recommendations"):
        assert recommendation["product_id"] in products
        assert recommendation["recommended_product_id"] in products


def test_october_rankings_exclude_cancelled_refunded_and_do_not_double_count(service):
    units = service.ranking("products", "2026-10")
    assert units["items"][0]["product_id"] == "PRD-001"
    assert units["items"][0]["units"] == 48
    assert units["qualifying_order_count"] == 25
    assert (
        service.ranking("products", "2026-10", "revenue")["items"][0]["product_id"]
        == "PRD-006"
    )
    assert service.ranking("users", "2026-10")["items"][0]["user_id"] == "USR-001"
    assert service.ranking("users", "2026-10")["items"][0]["spend"] == 5595.86
    assert service.ranking("products", "2027-01")["items"] == []
    assert (
        service.ranking("products", "2026-10", region="Scotland")[
            "qualifying_order_count"
        ]
        == 5
    )


def test_recommendations_are_explainable_and_region_aware(service):
    similar = service.recommendations(product_id="PRD-001", region="London")
    assert similar["probability_estimate"] is False
    assert {r["product_id"] for r in similar["items"][:2]} == {"PRD-003", "PRD-004"}
    assert similar["items"][0]["similarity_score"] == 0.8
    assert all(
        row["product_id"] not in ("PRD-001", "PRD-029", "PRD-030")
        for row in similar["items"]
    )
    cold = service.recommendations(user_id="USR-048")
    assert cold["method"] == "unique historical buyers"
    assert all(r["region"] in ("All", "North") for r in cold["items"])
    history = {r["product_id"] for r in service.sales(user_id="USR-001")}
    warm = service.recommendations(user_id="USR-001")
    assert all(r["product_id"] not in history for r in warm["items"])
    with pytest.raises(ValueError):
        service.recommendations()


def test_invoice_persists_exact_prices_and_idempotent_retry(service):
    seed_hashes = {
        p.name: sha256(p.read_bytes()).hexdigest() for p in SEED.glob("*.xlsx")
    }
    lines = [{"product_id": "PRD-001", "quantity": 2}]
    first = service.create_document("invoice", "USR-001", lines, "invoice-demo-1")
    assert first["document"]["total"] == 179.98
    assert first["document"]["status"] == "draft"
    again = service.create_document("invoice", "USR-001", lines, "invoice-demo-1")
    assert again["document"] == first["document"]
    assert again["replayed"]
    reopened = EcommerceService(ExcelStore(service.store.directory))
    assert (
        reopened.invoice_detail(first["document"]["invoice_id"])["items"]
        == first["items"]
    )
    assert len(service.store.working("Invoices")) == 1
    assert {
        p.name: sha256(p.read_bytes()).hexdigest() for p in SEED.glob("*.xlsx")
    } == seed_hashes
    with pytest.raises(ValueError, match="different details"):
        service.create_document("invoice", "USR-002", lines, "invoice-demo-1")


@pytest.mark.parametrize(
    "items",
    [
        [{"product_id": "PRD-029", "quantity": 1}],
        [{"product_id": "PRD-027", "quantity": 1}],
        [{"product_id": "missing", "quantity": 1}],
        [{"product_id": "PRD-001", "quantity": 0}],
        [{"product_id": "PRD-001", "quantity": True}],
        [
            {"product_id": "PRD-001", "quantity": 30},
            {"product_id": "PRD-001", "quantity": 30},
        ],
        [],
    ],
)
def test_invalid_invoice_is_atomic(service, items):
    with pytest.raises(ValueError):
        service.create_document("invoice", "USR-001", items, "bad-invoice")
    assert service.store.working("Invoices") == []
    assert service.store.working("InvoiceItems") == []
    assert service.store.working("Requests") == []


def test_create_customer_literal_text_and_draft_order(service):
    customer = service.create_customer(
        '=HYPERLINK("https://example.test")',
        28,
        "new@example.test",
        "London",
        "customer-1",
    )
    workbook = load_workbook(service.store.path, data_only=False)
    assert workbook["Users"]["B2"].data_type == "s"
    workbook.close()
    with pytest.raises(ValueError, match="already exists"):
        service.create_customer(
            "Duplicate", 29, "new@example.test", "London", "customer-2"
        )
    before = service.ranking("products", "2026-10")
    order = service.create_document(
        "order",
        customer["user_id"],
        [{"product_id": "PRD-001", "quantity": 2}],
        "new-order",
    )
    assert (
        service.order_detail(order["document"]["order_id"])["order"]["status"]
        == "draft"
    )
    assert service.ranking("products", "2026-10") == before
    assert service.purchase_history(customer["user_id"])["total"] == 0


def test_concurrent_retries_create_one_invoice(service):
    create = partial(
        service.create_document,
        "invoice",
        "USR-001",
        [{"product_id": "PRD-001", "quantity": 1}],
        "concurrent-1",
    )
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: create(), range(4)))
    assert len({r["document"]["invoice_id"] for r in results}) == 1
    assert len(service.store.working("Invoices")) == 1


def test_mcp_protocol_queries_and_writes(tmp_path):
    async def run():
        server = create_server(tmp_path)
        app = server.streamable_http_app()
        async with (  # noqa: SIM117 - group session lifetime outside client contexts
            server.session_manager.run(),
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as client,
        ):
            async with (
                streamable_http_client(
                    "http://127.0.0.1:8012/mcp", http_client=client
                ) as (read, write, _),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                tools = {t.name: t for t in (await session.list_tools()).tools}
                assert len(tools) == 15
                assert tools["best_selling_products"].annotations.readOnlyHint
                assert not tools["create_draft_invoice"].annotations.readOnlyHint
                assert tools["create_draft_invoice"].annotations.idempotentHint
                result = await session.call_tool(
                    "best_selling_products", {"month": "2026-10"}
                )
                assert result.structuredContent["items"][0]["product_id"] == "PRD-001"
                invalid = await session.call_tool(
                    "create_draft_invoice",
                    {
                        "user_id": "USR-001",
                        "items": [{"product_id": "PRD-001", "quantity": -1}],
                        "request_key": "test-key",
                    },
                )
                assert invalid.isError
                result = await session.call_tool(
                    "create_draft_invoice",
                    {
                        "user_id": "USR-001",
                        "items": [{"product_id": "PRD-001", "quantity": 1}],
                        "request_key": "test-key",
                    },
                )
                assert not result.isError
                assert result.structuredContent["document"]["total"] == 89.99
                invalid = await session.call_tool("search_products", {"limit": 1000})
                assert invalid.isError

    asyncio.run(run())


def test_audience_recommendations_report_limits(service):
    result = service.audience_recommendations()
    assert result["customers_considered"] == 44
    assert result["customers_without_history"] == 4
    assert result["probability_estimate"] is False
    assert result["items"]
    assert all(0 < row["recommended_customer_count"] <= 44 for row in result["items"])
    assert all(
        row["product_id"] not in ("PRD-029", "PRD-030") for row in result["items"]
    )


def test_workbook_save_failure_leaves_previous_records_intact(service, monkeypatch):
    from openpyxl.workbook.workbook import Workbook

    first = service.create_document(
        "invoice",
        "USR-001",
        [{"product_id": "PRD-001", "quantity": 1}],
        "initial-invoice",
    )
    before = service.store.path.read_bytes()

    def fail(*args, **kwargs):
        raise OSError("Simulated full disk")

    monkeypatch.setattr(Workbook, "save", fail)
    with pytest.raises(OSError):
        service.create_document(
            "invoice",
            "USR-001",
            [{"product_id": "PRD-001", "quantity": 2}],
            "second-invoice",
        )
    assert service.store.path.read_bytes() == before
    assert (
        service.invoice_detail(first["document"]["invoice_id"])["document"]["total"]
        == 89.99
    )
