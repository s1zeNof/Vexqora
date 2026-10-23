import { redirect } from "next/navigation";

export default function SettingsAccountsRedirect() {
  redirect("/dashboard/accounts");
}
