import type { Metadata } from "next";
import { CopilotWorkspace } from "@/components/csm-copilot/workspace";
import { getWorkspaceBootstrapData } from "@/lib/csm-data";

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "A two-pane customer success workspace for morning triage, pre-call prep, and similarity-based account analysis.",
};

export default async function Home() {
  const workspaceData = await getWorkspaceBootstrapData();

  return <CopilotWorkspace initialData={workspaceData} />;
}
