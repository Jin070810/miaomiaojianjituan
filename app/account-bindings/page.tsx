import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import BindingMemberPage from "./member-client";

export const metadata = { title: "平台账号验证 · 妙妙剪辑团" };

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <BindingMemberPage />;
}
