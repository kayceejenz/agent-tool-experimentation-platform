# Ecommerce Excel MCP demo

A standalone local MCP server for agent testing. All people, emails and transactions
are synthetic. Prices and totals are GBP; regions are London, Midlands, North,
Scotland and Wales. The dataset covers July 1–October 3, 2026.

## Run

From this directory:

```sh
uv sync
uv run ecommerce-mcp
```

In the platform's MCP Servers page add:

- Name: Ecommerce Excel Demo
- Endpoint: `http://127.0.0.1:8012/mcp`
- Transport: Streamable HTTP
- Authentication: None

Use **Manage → Check connection → Discover tools**. The platform API must allow
`http://127.0.0.1:8012` in `AGENT_MCP_DEVELOPMENT_ORIGINS` in development. This
endpoint is bound to loopback and intended for synthetic local demonstrations.
There is no customer authentication or per-project isolation inside this demo:
each server instance has one working dataset. Do not use it for real customer data.

If port 8012 is occupied, stop that demo or choose an unused port and explicitly
allow that origin in the platform development configuration:

```sh
ECOMMERCE_PORT=8014 uv run ecommerce-mcp
```

Working records are saved to `runtime/records.xlsx`. Set `ECOMMERCE_DATA_DIR` to a
separate directory for an independent demo instance. Do not change the directory
between retries. Keep the working workbook closed in Excel while the server writes.
The server does not alter the bundled seed workbooks.

## Excel files and relationships

The bundled source files live in `src/ecommerce_mcp/seed/`. Each data sheet has
filterable column headers in row 1, stable IDs, frozen headers, and typed values.

| File | Contents | Relationship |
| --- | --- | --- |
| products.xlsx | 30 products: ID, name, description, category, price, currency, region, tags, stock, active | `product_id` |
| users.xlsx | 48 customers: ID, name, age, synthetic email, region, joining date | `user_id` |
| orders.xlsx | 287 order headers and 560 historical order lines | Orders → users; lines → orders and products |
| purchase_history.xlsx | 480 completed purchase lines, a derived seed snapshot | Derived from eligible order lines; not an additional sales ledger |
| recommendations.xlsx | 90 product-to-product content recommendation rows | Both product IDs → products |
| records.xlsx | Empty template for newly created customers, draft orders, draft invoices and request keys | Copied into the working directory on first write |

The runtime workbook contains Users, Orders, OrderItems, Invoices, InvoiceItems and
Requests sheets. Writes replace this one workbook atomically under a file lock.
The Requests sheet makes creation idempotent: retry the same request key and
arguments to receive the same record; changed arguments with that key are rejected.
Generated UUID-based record IDs do not overlap the seed IDs. Invoice line prices
and customer names/emails are snapshots at creation time.

Purchase-history and recommendation source files are generated snapshots. The
query tools recompute purchases and recommendations from authoritative products,
orders, order lines and users. Never sum a purchase-history snapshot with the
orders ledger. Product ages and customer ages are not recommendation features.

## Tools

| Purpose | Tools |
| --- | --- |
| Understand available data | `describe_store` |
| Find products and customers | `search_products`, `list_customers` |
| Review transactions | `list_orders`, `get_order`, `get_purchase_history` |
| Compare performance | `best_selling_products`, `top_customers` |
| Recommend products | `recommend_products`, `recommend_for_audience` |
| Create synthetic records | `create_customer`, `create_draft_order`, `create_draft_invoice` |
| Review draft invoices | `list_invoices`, `get_invoice` |

Tools return bounded, structured results. Listing tools expose `next_offset`.
There is no arbitrary SQL, Python execution, filesystem-path input or tool-driven
file upload. Discovery exposes read/write and idempotency annotations.

### Sales and reporting dates

Eligible sales have status **paid**, **shipped** or **delivered**. Pending, draft,
cancelled and fully refunded orders are excluded. Amounts are merchandise totals
after historical line discounts, before tax and shipping. Historical order-line
prices are used instead of today's catalog prices. Money is rounded to pennies
using decimal arithmetic.

Sales-ranking tools default to the actual current calendar month in Europe/London.
For reproducible demos supply `month: "2026-10"`. They return empty results when
there are no qualifying records, and do not silently fall back to a past month.
Other history tools include all months when month is omitted.

### Recommendations

`recommend_products` uses Jaccard similarity on product category and tags.
For a customer, it selects the strongest match to their completed purchases,
excludes products already purchased, and filters by stock, active status and
region. Historical unique buyers break similarity ties. Customers with no purchase
history get popularity-based recommendations, explicitly labeled as a fallback.

`recommend_for_audience` ranks products by how many customers receive them among
their top three positive content matches. Customers without purchase history are
reported separately and not scored. This is recommendation coverage, not a
calibrated purchase probability, future demand prediction or validated model.

### Record creation

Before creating an invoice, identify the customer and specific product(s), and
use the user's instruction to create the record. A draft invoice does **not** place
an order, accept a payment, reserve stock, calculate tax/shipping or send email.
Draft orders have the same limits and are excluded from sales. Invoice and order
creation reject unavailable products, insufficient per-line stock and regional
mismatches. Repeated product IDs are combined before validating quantity.

New customers must use `@example.test` emails and adult ages. Workbook strings are
written as literal text, including any strings beginning with `=`.

## Demo prompts

- Which product sold the most units in October 2026? How does that compare with revenue?
- Which customer spent the most in October 2026? Show their purchase history.
- Which products are recommended to the most customers in Scotland, and why?
- Recommend alternatives to PRD-001 available in London under £100.
- Create a draft invoice for USR-001 for two units of PRD-001. Show me the total.
- Create a synthetic customer called Demo Buyer, age 30, demo.buyer@example.test, in London.

Known October answers for checking agent behavior:

- PRD-001 Wireless Headphones: 48 units across 24 orders; £4,319.52 revenue.
- PRD-006 Creator Laptop: £5,196.00 revenue from four qualifying units.
- USR-001 Alex Reed: £5,595.86 spend.
- Two PRD-001 units produce a £179.98 draft invoice.
- The cancelled 10-laptop order and refunded 8-laptop order must not count as sales.

## Validation and fixture regeneration

```sh
uv run pytest -q
uv run ruff check src scripts/generate_seed.py tests
```

Tests use temporary working directories. They cover totals and foreign keys,
month and status filtering, recommendation eligibility, persistent invoice writes,
retry conflicts, concurrent retries, formula-looking text, failed saves and actual
MCP initialization, discovery, querying and creation through Streamable HTTP.

`python scripts/generate_seed.py` creates the deterministic JSON input for fixture
regeneration. `scripts/build-workbooks.mjs` authors the styled Excel files using
`@oai/artifact-tool` and exports previews to `outputs/ecommerce-demo/`. This authoring
step uses the bundled artifact runtime; it is not required to run the MCP server.
The application uses openpyxl to read Excel and maintain the working record file.

The source schema and row limits are designed for a small local demo. Excel offers
neither production transaction throughput nor access-control enforcement.
