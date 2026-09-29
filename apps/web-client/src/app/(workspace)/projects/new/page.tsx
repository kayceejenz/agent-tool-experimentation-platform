import { PageHeader } from '@/components/workspace/workspace-views';
import { ProjectForm } from '@/components/projects/project-form';
export default function NewProjectPage() {
	return <><PageHeader title='Create project' description='Give your tools, agents, and experiments a shared home.' /><section className='panel'><ProjectForm /></section></>;
}
