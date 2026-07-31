import { expect, test } from "bun:test";
import { adjustStock, completeSale, createStore, parseMoneyInput, parseStoreText, saveProduct, serializeStore, setProductActive } from "./store";

function stockedStore() {
  return saveProduct(createStore("Corner Store", "PHP", 1), { sku: "COF-01", name: "Cold brew", priceMinor: 12500, openingStock: 8, reorderLevel: 2 }, "product-1", 2);
}

test("round-trips a strict store document and rejects unknown data", () => {
  const document = stockedStore();
  expect(parseStoreText(serializeStore(document))).toEqual(document);
  const parsed = JSON.parse(serializeStore(document));
  parsed.extra = true;
  expect(() => parseStoreText(JSON.stringify(parsed))).toThrow("unsupported or missing fields");
});

test("uses currency minor units without floating point arithmetic", () => {
  expect(parseMoneyInput("125.50", "PHP")).toBe(12550);
  expect(parseMoneyInput("125", "JPY")).toBe(125);
  expect(() => parseMoneyInput("1.001", "PHP")).toThrow();
  expect(() => parseMoneyInput("1.00", "ZZZ")).toThrow("valid ISO currency");
});

test("completes a sale and stock deduction in one document mutation", () => {
  const { document, sale } = completeSale(stockedStore(), [{ productId: "product-1", quantity: 2 }], { method: "cash", amountMinor: 30000 }, "sale-1", 3);
  expect(sale.number).toBe("S-000001");
  expect(sale.totalMinor).toBe(25000);
  expect(sale.tender.changeMinor).toBe(5000);
  expect(document.products[0].stock).toBe(6);
  expect(document.movements.at(-1)).toMatchObject({ type: "sale", quantity: -2, saleId: "sale-1" });
  expect(document.nextSaleNumber).toBe(2);
});

test("protects stock and product identity", () => {
  const document = stockedStore();
  expect(() => completeSale(document, [{ productId: "product-1", quantity: 9 }], { method: "cash", amountMinor: 200000 }, "sale-2", 3)).toThrow("only 8");
  expect(() => adjustStock(document, "product-1", -9, "adjustment", "Damage", "movement-2", 3)).toThrow("negative");
  expect(() => saveProduct(document, { sku: "cof-01", name: "Duplicate", priceMinor: 100, openingStock: 0, reorderLevel: 0 }, "product-2", 3)).toThrow("already assigned");
  expect(setProductActive(document, "product-1", false, 3).products[0].active).toBeFalse();
});

test("rejects inconsistent receipt sequence and non-cash tender history", () => {
  const { document } = completeSale(stockedStore(), [{ productId: "product-1", quantity: 1 }], { method: "cash", amountMinor: 20000 }, "sale-3", 3);
  const invalidSequence = JSON.parse(serializeStore(document));
  invalidSequence.nextSaleNumber = 3;
  expect(() => parseStoreText(JSON.stringify(invalidSequence))).toThrow("receipt history");

  const invalidTender = JSON.parse(serializeStore(document));
  invalidTender.sales[0].tender.method = "card";
  expect(() => parseStoreText(JSON.stringify(invalidTender))).toThrow("Non-cash tender");
});

test("rejects stock and sale history that contradicts the ledgers", () => {
  const { document } = completeSale(stockedStore(), [{ productId: "product-1", quantity: 1 }], { method: "cash", amountMinor: 20000 }, "sale-4", 3);

  const wrongStock = structuredClone(document);
  wrongStock.products[0].stock = 999;
  expect(() => parseStoreText(JSON.stringify(wrongStock))).toThrow("stock movements");

  const missingSaleReference = structuredClone(document);
  delete missingSaleReference.movements.at(-1)!.saleId;
  expect(() => parseStoreText(JSON.stringify(missingSaleReference))).toThrow("reference a sale");

  const wrongSaleQuantity = structuredClone(document);
  wrongSaleQuantity.movements.at(-1)!.quantity = -2;
  expect(() => parseStoreText(JSON.stringify(wrongSaleQuantity))).toThrow("stock movements");

  const zeroMovement = structuredClone(document);
  zeroMovement.movements[0].quantity = 0;
  expect(() => parseStoreText(JSON.stringify(zeroMovement))).toThrow("cannot be zero");

  const duplicateItem = structuredClone(document);
  duplicateItem.sales[0].items.push({ ...duplicateItem.sales[0].items[0] });
  expect(() => parseStoreText(JSON.stringify(duplicateItem))).toThrow("more than once");
});
