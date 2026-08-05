"use client";

import { useEffect, useId, useState } from "react";
import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
import { displayStockSymbol } from "@/lib/market-data/stock-display";
import type { BrandEnrichmentRow } from "@/lib/market-intel/queries";
export type StockCorrectionContext = {
  companyId?: string;
  brandKey?: string;
  companyName?: string | null;
  domain?: string | null;
  onCorrected?: (firmographics: CompanyFirmographics, enrichment?: BrandEnrichmentRow) => void;
};
type StockTickerCorrectionDialogProps = {
  open: boolean;
  firmographics: CompanyFirmographics;
  context: StockCorrectionContext;
  onClose: () => void;
};
export function StockTickerCorrectionDialog({
  open,
  firmographics,
  context,
  onClose
}: StockTickerCorrectionDialogProps) {
  const titleId = useId();
  const currentSymbol = displayStockSymbol(firmographics) ?? "";
  const [symbol, setSymbol] = useState(currentSymbol);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setSymbol(firmographics.stock_symbol_override ?? currentSymbol);
      setError(null);
    }
  }, [open, firmographics.stock_symbol_override, currentSymbol]);
  if (!open) return null;
  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/market-data/stock/correct", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          symbol,
          company_id: context.companyId,
          brand_key: context.brandKey,
          company_name: context.companyName,
          domain: context.domain ?? firmographics.domain
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        firmographics?: CompanyFirmographics;
        enrichment?: BrandEnrichmentRow;
        warning?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      if (data.firmographics) {
        context.onCorrected?.(data.firmographics, data.enrichment);
      }
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl" onClick={event => event.stopPropagation()}>
        <h3 id={titleId} className="text-base font-semibold text-[#F4F1EB]">
          Correct stock ticker
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[#B9B2A6]">
          Enter the symbol you want to use for quotes and Google Finance links. Examples:{" "}
          <span className="text-[#ECE7DF]">TM</span>,{" "}
          <span className="text-[#ECE7DF]">MGDDY</span>,{" "}
          <span className="text-[#ECE7DF]">ML.PA</span>.
        </p>
        <label className="mt-4 block text-xs text-[#8E877A]">
          Ticker symbol
          <input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} placeholder="TM" className="mt-1 w-full rounded-md border border-white/10 bg-[#101311] px-3 py-2 text-sm text-[#F4F1EB] outline-none ring-0 placeholder:text-[#6E675C] focus:border-[#4F9E63]/50" autoFocus onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            void handleSave();
          }
        }} />
        </label>
        {error ? <p className="mt-2 text-xs text-[#E57373]">{error}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-[#D1CABF] hover:bg-white/5 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={busy || !symbol.trim()} className="rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-3 py-1.5 text-xs font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Saving…" : "Save ticker"}
          </button>
        </div>
      </div>
    </div>;
}