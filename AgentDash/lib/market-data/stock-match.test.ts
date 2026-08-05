import assert from "node:assert/strict";
import test from "node:test";
import {
  googleFinanceUrl,
  isVerifiedStockMatch,
  meaningfulBrandTokens,
  scoreCompanyNameAgainstProfile,
  stockDescriptionMismatch,
} from "./stock-match.js";

test("meaningfulBrandTokens excludes generic words like filters", () => {
  assert.deepEqual(meaningfulBrandTokens("Wix Filters"), ["wix filters", "wix"]);
});

test("Wix Filters does not verify against unrelated ADR profile", () => {
  assert.equal(
    isVerifiedStockMatch({
      companyName: "Wix Filters",
      domain: "wixfilters.com",
      profileName: "Asseco Poland SA",
      profileWeburl: "https://pl.asseco.com/",
      searchDescription: "ASSECO POLAND SA-UNSPON ADR",
    }),
    false
  );
});

test("Michelin verifies against ADR description", () => {
  assert.equal(
    isVerifiedStockMatch({
      companyName: "Michelin",
      domain: "michelinman.com",
      profileName: "Compagnie Generale des Etablissements Michelin SCA",
      profileWeburl: "https://www.michelin.fr/",
      searchDescription: "MICHELIN (CGDE)-UNSPON ADR",
    }),
    true
  );
});

test("Toyota verifies by company name", () => {
  assert.ok(
    scoreCompanyNameAgainstProfile("Toyota Motor Corp", "Toyota") >= 55
  );
});

test("stockDescriptionMismatch rejects Puma Biotechnology for Puma brand", () => {
  assert.equal(
    stockDescriptionMismatch("Puma", "PUMA BIOTECHNOLOGY INC"),
    true
  );
  assert.equal(
    isVerifiedStockMatch({
      companyName: "Puma",
      domain: "puma.com",
      profileName: "Puma Biotechnology Inc",
      searchDescription: "PUMA BIOTECHNOLOGY INC",
    }),
    false
  );
});

test("googleFinanceUrl builds exchange-specific link", () => {
  assert.equal(
    googleFinanceUrl("TM", "NEW YORK STOCK EXCHANGE, INC."),
    "https://www.google.com/finance/beta/quote/TM:NYSE"
  );
  assert.equal(
    googleFinanceUrl("MGDDY", "OTC MARKETS"),
    "https://www.google.com/finance/beta/quote/MGDDY:OTCMKTS"
  );
});

test("googleFinanceUrl ignores home-market exchange for US ADR symbols", () => {
  assert.equal(
    googleFinanceUrl("TM", "TOKYO STOCK EXCHANGE-TOKYO PRO MARKET"),
    "https://www.google.com/finance/beta/quote/TM:NYSE"
  );
});

test("googleFinanceUrl routes unsponsored OTC ADRs to OTCMKTS", () => {
  assert.equal(
    googleFinanceUrl("MGDDF", "NEW YORK STOCK EXCHANGE, INC."),
    "https://www.google.com/finance/beta/quote/MGDDF:OTCMKTS"
  );
  assert.equal(
    googleFinanceUrl("MGDDY", "NEW YORK STOCK EXCHANGE, INC."),
    "https://www.google.com/finance/beta/quote/MGDDY:OTCMKTS"
  );
});
