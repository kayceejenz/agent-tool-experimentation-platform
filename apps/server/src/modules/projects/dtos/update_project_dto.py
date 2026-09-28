from pydantic import BaseModel, ConfigDict, model_validator

from modules.projects.dtos.create_project_dto import Description, ProjectName


class UpdateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: ProjectName | None = None
    description: Description | None = None

    @model_validator(mode="after")
    def validate_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Name cannot be null")
        return self
