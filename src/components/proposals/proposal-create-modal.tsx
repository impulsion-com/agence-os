"use client";

import { Modal } from "@/components/ui/overlay";

export interface ProposalDefaults {
  company_id?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
}

// À IMPLÉMENTER (module Propositions)
export function ProposalCreateModal({ onClose }: { defaults?: ProposalDefaults; onClose: () => void }) {
  return <Modal title="Nouvelle proposition" onClose={onClose}>…</Modal>;
}
