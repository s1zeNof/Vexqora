import { redirect } from "next/navigation";

export default function SettingsRiskRedirect() {
  redirect("/dashboard/risk");
}
