import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { PerformancePanel } from "./performance-panel";
export default async function PerformancePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  return <PerformancePanel />;
}
