"use client";

import { BillingObservatory } from "./billing/billing-observatory";

/**
 * 计费统计入口组件（薄包装）。
 *
 * 保持原有 export 名和 props 接口，侧边栏引用无需改动。
 * 实际渲染由 BillingObservatory 全屏覆盖层接管。
 */

interface BillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillingDialog({ open, onOpenChange }: BillingDialogProps) {
  return <BillingObservatory open={open} onOpenChange={onOpenChange} />;
}
