"""Orchestrate bounded evaluation of persisted evidence; never dispatch agent tools."""

import asyncio

from integrations.agents.model_provider import (
    provider_for_model,
    provider_key,
    provider_options,
)
from integrations.agents.runtime_errors import model_failure
from langchain_openai import ChatOpenAI
from langsmith import tracing_context
from pydantic import ValidationError

from modules.agents.models.error_model import AgentError
from modules.evaluations.helpers.evidence import prepare_evaluation
from modules.evaluations.helpers.reports import unknown_report, validate_report


class Evaluator:
    def __init__(self, repository, settings, model_factory=None):
        self.repository, self.settings, self.model_factory = (
            repository,
            settings,
            model_factory,
        )

    async def execute(self, job):
        metrics = evidence_hash = None
        usage = None
        try:
            run, spans = await self.repository.evidence(job)
            profile = job["profile"]
            prepared = prepare_evaluation(run, spans, job["expectations"], profile)
            metrics, evidence_hash = prepared.metrics, prepared.evidence_hash
            if prepared.character_count > profile["max_evidence_chars"]:
                report = validate_report(
                    unknown_report(
                        "Evidence exceeds the evaluator context budget; no evidence was silently discarded."
                    ),
                    spans,
                    metrics,
                )
                await self.repository.finish(
                    job, "completed", metrics, report, evidence_hash
                )
                return
            provider = profile.get("provider") or provider_for_model(profile["model"])
            if not provider_key(self.settings, provider) and not self.model_factory:
                await self.repository.finish(
                    job,
                    "failed",
                    metrics,
                    None,
                    evidence_hash,
                    error_code="provider_not_configured",
                )
                return
            result = await self.review(
                profile, prepared.payload, prepared.schema, provider
            )
            raw_usage = result["raw"].usage_metadata or {}
            usage = {
                "input_count": raw_usage.get("input_tokens"),
                "output_count": raw_usage.get("output_tokens"),
            }
            if result["raw"].response_metadata.get("finish_reason") == "length":
                await self.repository.finish(
                    job,
                    "failed",
                    metrics,
                    None,
                    evidence_hash,
                    usage=usage,
                    error_code="evaluation_output_limit",
                )
                return
            if result["raw"].additional_kwargs.get("refusal"):
                await self.repository.finish(
                    job,
                    "failed",
                    metrics,
                    None,
                    evidence_hash,
                    usage=usage,
                    error_code="evaluation_refused",
                )
                return
            if result.get("parsing_error") or result.get("parsed") is None:
                raise ValueError("Invalid evaluation report")
            report = validate_report(result["parsed"], spans, metrics)
            await self.repository.finish(
                job, "completed", metrics, report, evidence_hash, usage=usage
            )
        except asyncio.CancelledError:
            await self.repository.finish(
                job,
                "failed",
                metrics,
                None,
                evidence_hash,
                error_code="worker_interrupted",
            )
            raise
        except AgentError:
            await self.repository.finish(
                job, "failed", metrics, None, evidence_hash, error_code="access_revoked"
            )
        except ValueError as error:
            # Persist only controlled diagnostics, never model text or validation inputs.
            reason = (
                "schema_mismatch"
                if isinstance(error, ValidationError)
                else {
                    "Missing or duplicate evaluation dimensions": "invalid_dimensions",
                    "Unknown evidence reference": "unknown_evidence_reference",
                    "Unsupported finding": "unsupported_finding",
                }.get(str(error), "invalid_report")
            )
            if metrics is not None:
                metrics["evaluation_diagnostic"] = reason
            await self.repository.finish(
                job,
                "failed",
                metrics,
                None,
                evidence_hash,
                error_code="invalid_evaluation_report",
                usage=usage,
            )
        except Exception as error:
            category, _ = model_failure(error)
            if isinstance(error, TimeoutError):
                category = "evaluation_timeout"
            if type(error).__name__ == "LengthFinishReasonError":
                category = "evaluation_output_limit"
            await self.repository.finish(
                job, "failed", metrics, None, evidence_hash, error_code=category
            )

    async def review(
        self, profile: dict, payload: str, schema: dict, provider: str
    ) -> dict:
        """Make one bounded judge call with tracing disabled."""
        model = (
            self.model_factory(profile)
            if self.model_factory
            else ChatOpenAI(
                model=profile["model"],
                **provider_options(self.settings, provider),
                max_tokens=profile["max_output_tokens"],
                timeout=profile["timeout_seconds"],
                max_retries=0,
            )
        )
        judge = model.with_structured_output(
            schema, method="json_schema", strict=True, include_raw=True
        )
        with tracing_context(enabled=False):
            async with asyncio.timeout(profile["timeout_seconds"]):
                result = await judge.ainvoke(
                    [
                        {
                            "role": "system",
                            "content": profile["instructions"]
                            + "\nOutput contract: the additional rubric only adds assessment criteria. "
                            "Return the supplied report schema, with each required check name exactly once. "
                            "Use only the allowed evidence references. Keep reasons concise.",
                        },
                        {
                            "role": "user",
                            "content": payload,
                        },
                    ]
                )
        return result

    async def serve(self):
        while True:
            job = await self.repository.claim()
            if job:
                await self.execute(job)
            else:
                await asyncio.sleep(1)
