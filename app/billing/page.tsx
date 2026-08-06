import type { Metadata } from "next";
import { BillingPage } from "@/components/billing/billing-page";

export const metadata: Metadata = {
  title: "计费观测台 · 商拍生成工作台",
  description: "双渠道消费与余额总览",
};

export default function Page() {
  return <BillingPage />;
}
