import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import BindingAdminPage from "./admin-client";

export const metadata = { title: "账号归属核验 · 妙妙剪辑团" };

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  return <BindingAdminPage actorId={user.id} />;
}
