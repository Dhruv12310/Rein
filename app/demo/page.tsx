import { DemoPanel } from "@/components/demo-panel";
import { PageHeader } from "@/components/ui";

export default function DemoPage() {
  return (
    <div>
      <PageHeader
        title="Demo scenarios"
        description="Run each scenario through the real purchase path, then watch the Overview and Activity tabs reflect it live."
      />
      <DemoPanel />
    </div>
  );
}
