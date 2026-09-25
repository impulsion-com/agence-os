"use client";

import { Printer } from "lucide-react";

import "@/styles/reporting.css";
import type { ReportData } from "@/lib/ads/load";
import { ReportView } from "./report-view";

/** Page publique du rapport : accent de l'espace, bouton d'export PDF (impression). */
export function PublicReport({ data }: { data: ReportData }) {
  return (
    <main className="rp-public" data-acc={data.workspace.accent || "indigo"}>
      <ReportView
        data={data}
        actions={
          <div className="actions no-print">
            <button type="button" className="btn" onClick={() => window.print()}>
              <Printer size={14} /> Télécharger en PDF
            </button>
          </div>
        }
      />
    </main>
  );
}
