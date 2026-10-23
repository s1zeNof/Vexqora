import { redirect } from "next/navigation";

export default function SettingsIntegrationsRedirect() {
  redirect("/dashboard/integrations");
}
