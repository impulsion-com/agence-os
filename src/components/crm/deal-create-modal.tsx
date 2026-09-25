"use client";

import { Modal } from "@/components/ui/overlay";

export interface DealDefaults {
  company_id?: string | null;
  contact_id?: string | null;
  stage_id?: string | null;
}

// À IMPLÉMENTER (module CRM)
export function DealCreateModal({ onClose }: { defaults?: DealDefaults; onClose: () => void }) {
  return <Modal title="Nouveau deal" onClose={onClose}>…</Modal>;
}
