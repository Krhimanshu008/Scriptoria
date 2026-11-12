import { redirect } from "next/navigation";
import { getSessionUserFast } from "@/lib/auth/session";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUserFast();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const colabConnected =
    typeof params.colabConnected === "string" ? params.colabConnected : "";
  const colabError = typeof params.colabError === "string" ? params.colabError : "";

  if (colabConnected) {
    redirect(`/vms?colabConnected=${encodeURIComponent(colabConnected)}`);
  }
  if (colabError) {
    redirect(`/vms?colabError=${encodeURIComponent(colabError)}`);
  }

  const settings = await getOrCreateWorkspaceSettings(user.userId);
  redirect(settings.defaultDashboard === "studio" ? "/studio" : "/vms");
}
