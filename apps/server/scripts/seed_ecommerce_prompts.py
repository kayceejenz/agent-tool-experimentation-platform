"""Explicitly add the ecommerce experiment prompts to one project, without overwriting edits.

Run from apps/server with --project and --actor (an owner/editor user ID).
Re-running keeps the same prompt identities and all existing revisions.
"""

import argparse
import asyncio
from pathlib import Path
from uuid import UUID, uuid5

from psycopg.rows import dict_row

from core.settings import Settings
from integrations.database import Database
from modules.prompts.dtos.prompt_dto import CreatePromptRequest
from modules.prompts.repos.prompt_repo import PromptRepository

PROMPT_DIRECTORY = Path(__file__).resolve().parents[3] / "apps/mcps/ecommerce/prompts"
PROMPTS = {
    "system": (
        "Ecommerce — System Rules",
        "Shared grounding, sales definitions, dates, data trust and draft-write rules for the UK ecommerce MCP.",
    ),
    "agent": (
        "Ecommerce — Research and Sales Agent",
        "Tool selection and workflows for product research, sales analysis, recommendations and requested draft invoices/orders.",
    ),
    "evaluation": (
        "Ecommerce — Experiment Evaluation",
        "Evidence-based assessment of tool selection, argument meaning, dependencies, answer quality and write discipline.",
    ),
}


async def seed(project_id: UUID, actor_id: UUID):
    definitions = [
        CreatePromptRequest(
            type=kind,
            name=name,
            description=description,
            content=(PROMPT_DIRECTORY / f"{kind}.md").read_text(),
        )
        for kind, (name, description) in PROMPTS.items()
    ]
    database = Database(Settings())
    await database.open()
    report = []
    try:
        async with database.connection() as connection:
            async with connection.cursor(row_factory=dict_row) as db:
                await PromptRepository.member(db, actor_id, project_id, True)
                for body in definitions:
                    prompt_id = uuid5(
                        project_id, f"ecommerce-experiment-prompt/{body.type}"
                    )
                    inserted = await (
                        await db.execute(
                            "INSERT INTO agent_platform.prompts(id,project_id,type) VALUES (%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING id",
                            (prompt_id, project_id, body.type),
                        )
                    ).fetchone()
                    if inserted:
                        await PromptRepository.insert_revision(
                            db, prompt_id, 1, actor_id, body
                        )
                    report.append(
                        f"{'Created' if inserted else 'Kept existing'}: {body.name} ({prompt_id})"
                    )
        for line in report:
            print(line)
    finally:
        await database.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=UUID, required=True)
    parser.add_argument("--actor", type=UUID, required=True)
    args = parser.parse_args()
    asyncio.run(seed(args.project, args.actor))
