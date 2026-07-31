export const STORE_MIME_TYPE = "application/vnd.hiraya.pos+json";
export const STORE_EXTENSION = ".hpos";

export type TenderMethod = "cash" | "card" | "other";
export type MovementType = "opening" | "receive" | "adjustment" | "sale";

export type Product = Readonly<{
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  stock: number;
  reorderLevel: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}>;

export type StockMovement = Readonly<{
  id: string;
  productId: string;
  type: MovementType;
  quantity: number;
  note: string;
  saleId?: string;
  createdAt: number;
}>;

export type SaleItem = Readonly<{
  productId: string;
  sku: string;
  name: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}>;

export type Sale = Readonly<{
  id: string;
  number: string;
  createdAt: number;
  items: SaleItem[];
  subtotalMinor: number;
  totalMinor: number;
  tender: Readonly<{ method: TenderMethod; amountMinor: number; changeMinor: number }>;
}>;

export type StoreDocument = Readonly<{
  schemaVersion: 1;
  store: Readonly<{ name: string; currency: string; createdAt: number }>;
  nextSaleNumber: number;
  products: Product[];
  movements: StockMovement[];
  sales: Sale[];
}>;

export type ProductInput = Readonly<{
  sku: string;
  name: string;
  priceMinor: number;
  openingStock: number;
  reorderLevel: number;
}>;

export type CartLine = Readonly<{ productId: string; quantity: number }>;

const MAX_MONEY = 1_000_000_000_000;
const MAX_QUANTITY = 1_000_000_000;
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export function currencyFractionDigits(currency: string): number {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency must be a three-letter ISO code.");
  if (!ISO_CURRENCIES.has(code)) throw new Error("Currency must be a valid ISO currency code.");
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new Error("Currency must be a valid ISO currency code.");
  }
}

export function formatMoney(valueMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(valueMinor / 10 ** digits);
}

export function parseMoneyInput(value: string, currency: string): number {
  const digits = currencyFractionDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{0,${digits}})?$`);
  const normalized = value.trim();
  if (!pattern.test(normalized)) throw new Error(`Enter a valid amount with no more than ${digits} decimal places.`);
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_MONEY) throw new Error("The amount is outside the supported range.");
  return result;
}

export function createStore(name: string, currency: string, now = Date.now()): StoreDocument {
  return {
    schemaVersion: 1,
    store: { name: requiredText(name, "Store name", 80), currency: currency.trim().toUpperCase(), createdAt: timestamp(now, "Store creation time") },
    nextSaleNumber: 1,
    products: [],
    movements: [],
    sales: [],
  } satisfies StoreDocument;
}

export function saveProduct(document: StoreDocument, input: ProductInput, id: string, now = Date.now()): StoreDocument {
  const sku = requiredText(input.sku, "SKU", 48);
  const name = requiredText(input.name, "Product name", 120);
  const priceMinor = boundedInteger(input.priceMinor, "Price", 0, MAX_MONEY);
  const openingStock = boundedInteger(input.openingStock, "Opening stock", 0, MAX_QUANTITY);
  const reorderLevel = boundedInteger(input.reorderLevel, "Reorder level", 0, MAX_QUANTITY);
  const existingIndex = document.products.findIndex((product) => product.id === id);
  const duplicate = document.products.find((product) => product.id !== id && product.sku.toLocaleLowerCase() === sku.toLocaleLowerCase());
  if (duplicate) throw new Error(`SKU ${sku} is already assigned to ${duplicate.name}.`);

  if (existingIndex >= 0) {
    const current = document.products[existingIndex];
    const products = [...document.products];
    products[existingIndex] = { ...current, sku, name, priceMinor, reorderLevel, updatedAt: timestamp(now, "Product update time") };
    return { ...document, products };
  }

  const createdAt = timestamp(now, "Product creation time");
  const product: Product = { id: identifier(id, "Product ID"), sku, name, priceMinor, stock: openingStock, reorderLevel, active: true, createdAt, updatedAt: createdAt };
  const movement: StockMovement | null = openingStock === 0 ? null : {
    id: identifier(`${id}-opening`, "Movement ID"), productId: id, type: "opening", quantity: openingStock, note: "Opening stock", createdAt,
  };
  return { ...document, products: [...document.products, product], movements: movement ? [...document.movements, movement] : document.movements };
}

export function setProductActive(document: StoreDocument, productId: string, active: boolean, now = Date.now()): StoreDocument {
  const index = document.products.findIndex((product) => product.id === productId);
  if (index < 0) throw new Error("Product was not found.");
  const products = [...document.products];
  products[index] = { ...products[index], active, updatedAt: timestamp(now, "Product update time") };
  return { ...document, products };
}

export function adjustStock(document: StoreDocument, productId: string, quantity: number, type: "receive" | "adjustment", note: string, movementId: string, now = Date.now()): StoreDocument {
  const index = document.products.findIndex((product) => product.id === productId);
  if (index < 0) throw new Error("Product was not found.");
  const delta = boundedInteger(quantity, "Stock change", -MAX_QUANTITY, MAX_QUANTITY);
  if (delta === 0) throw new Error("Stock change cannot be zero.");
  if (type === "receive" && delta < 0) throw new Error("Received stock must be positive.");
  const nextStock = document.products[index].stock + delta;
  if (!Number.isSafeInteger(nextStock) || nextStock < 0 || nextStock > MAX_QUANTITY) throw new Error("Stock cannot become negative or exceed the supported range.");
  const createdAt = timestamp(now, "Movement time");
  const products = [...document.products];
  products[index] = { ...products[index], stock: nextStock, updatedAt: createdAt };
  const movement: StockMovement = { id: identifier(movementId, "Movement ID"), productId, type, quantity: delta, note: requiredText(note, "Adjustment reason", 200), createdAt };
  return { ...document, products, movements: [...document.movements, movement] };
}

export function completeSale(document: StoreDocument, cart: CartLine[], tender: Readonly<{ method: TenderMethod; amountMinor: number }>, saleId: string, now = Date.now()): Readonly<{ document: StoreDocument; sale: Sale }> {
  if (cart.length === 0 || cart.length > 100) throw new Error("A sale must contain between 1 and 100 products.");
  if (!(["cash", "card", "other"] as const).includes(tender.method)) throw new Error("Tender method is invalid.");
  const seen = new Set<string>();
  const items = cart.map((line) => {
    if (seen.has(line.productId)) throw new Error("A product appears more than once in the cart.");
    seen.add(line.productId);
    const product = document.products.find((candidate) => candidate.id === line.productId);
    if (!product || !product.active) throw new Error("A cart product is no longer available.");
    const quantity = boundedInteger(line.quantity, `${product.name} quantity`, 1, MAX_QUANTITY);
    if (quantity > product.stock) throw new Error(`${product.name} has only ${product.stock} in stock.`);
    const lineTotalMinor = product.priceMinor * quantity;
    if (!Number.isSafeInteger(lineTotalMinor) || lineTotalMinor > MAX_MONEY) throw new Error("Sale total exceeds the supported range.");
    return { productId: product.id, sku: product.sku, name: product.name, unitPriceMinor: product.priceMinor, quantity, lineTotalMinor } satisfies SaleItem;
  });
  const totalMinor = items.reduce((total, item) => total + item.lineTotalMinor, 0);
  if (!Number.isSafeInteger(totalMinor) || totalMinor > MAX_MONEY) throw new Error("Sale total exceeds the supported range.");
  const amountMinor = boundedInteger(tender.amountMinor, "Tender amount", 0, MAX_MONEY);
  if (amountMinor < totalMinor) throw new Error("Tender amount does not cover the sale total.");
  if (tender.method !== "cash" && amountMinor !== totalMinor) throw new Error("Card and other tender must match the sale total.");
  const createdAt = timestamp(now, "Sale time");
  const validSaleId = identifier(saleId, "Sale ID");
  const sale: Sale = {
    id: validSaleId,
    number: `S-${String(document.nextSaleNumber).padStart(6, "0")}`,
    createdAt,
    items,
    subtotalMinor: totalMinor,
    totalMinor,
    tender: { method: tender.method, amountMinor, changeMinor: amountMinor - totalMinor },
  };
  const quantityByProduct = new Map(items.map((item) => [item.productId, item.quantity]));
  const products = document.products.map((product) => {
    const quantity = quantityByProduct.get(product.id);
    return quantity === undefined ? product : { ...product, stock: product.stock - quantity, updatedAt: createdAt };
  });
  const movements = items.map((item) => ({
    id: identifier(`${validSaleId}-${item.productId}`, "Movement ID"), productId: item.productId, type: "sale" as const, quantity: -item.quantity, note: sale.number, saleId: validSaleId, createdAt,
  }));
  return { document: { ...document, nextSaleNumber: document.nextSaleNumber + 1, products, movements: [...document.movements, ...movements], sales: [...document.sales, sale] }, sale };
}

export function serializeStore(document: StoreDocument): string {
  parseStore(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseStoreText(text: string): StoreDocument {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This store file is not valid JSON."); }
  return parseStore(value);
}

export function parseStore(value: unknown): StoreDocument {
  const object = record(value, "Store file");
  exact(object, ["schemaVersion", "store", "nextSaleNumber", "products", "movements", "sales"], "Store file");
  if (object.schemaVersion !== 1) throw new Error("This store file uses an unsupported schema version.");
  const storeValue = record(object.store, "Store settings");
  exact(storeValue, ["name", "currency", "createdAt"], "Store settings");
  const currency = requiredText(storeValue.currency, "Currency", 3).toUpperCase();
  currencyFractionDigits(currency);
  const productsValue = boundedArray(object.products, "Products", 5_000);
  const movementsValue = boundedArray(object.movements, "Stock movements", 50_000);
  const salesValue = boundedArray(object.sales, "Sales", 10_000);
  const products = productsValue.map(parseProduct);
  const productIds = new Set<string>();
  const skus = new Set<string>();
  for (const product of products) {
    if (productIds.has(product.id)) throw new Error("Product IDs must be unique.");
    if (skus.has(product.sku.toLocaleLowerCase())) throw new Error("Product SKUs must be unique.");
    productIds.add(product.id);
    skus.add(product.sku.toLocaleLowerCase());
  }
  const movements = movementsValue.map((item) => parseMovement(item, productIds));
  const movementIds = new Set<string>();
  for (const movement of movements) {
    if (movementIds.has(movement.id)) throw new Error("Stock movement IDs must be unique.");
    movementIds.add(movement.id);
  }
  const sales = salesValue.map((item) => parseSale(item, productIds));
  const saleIds = new Set<string>();
  const saleNumbers = new Set<string>();
  let lastSaleNumber = 0;
  for (const sale of sales) {
    if (saleIds.has(sale.id)) throw new Error("Sale IDs must be unique.");
    if (saleNumbers.has(sale.number)) throw new Error("Sale numbers must be unique.");
    saleIds.add(sale.id);
    saleNumbers.add(sale.number);
    lastSaleNumber = Math.max(lastSaleNumber, saleSequence(sale.number));
  }
  const nextSaleNumber = boundedInteger(object.nextSaleNumber, "Next sale number", 1, 10_000_001);
  if (nextSaleNumber !== lastSaleNumber + 1) throw new Error("Next sale number is inconsistent with receipt history.");
  for (const movement of movements) if (movement.saleId && !saleIds.has(movement.saleId)) throw new Error("A stock movement references an unknown sale.");
  const stockByProduct = new Map(products.map((product) => [product.id, 0]));
  const saleMovements = new Map<string, StockMovement>();
  for (const movement of movements) {
    stockByProduct.set(movement.productId, stockByProduct.get(movement.productId)! + movement.quantity);
    if (movement.type === "sale") {
      const key = `${movement.saleId}\0${movement.productId}`;
      if (saleMovements.has(key)) throw new Error("A sale has duplicate stock movements for one product.");
      saleMovements.set(key, movement);
    }
  }
  for (const product of products) if (stockByProduct.get(product.id) !== product.stock) throw new Error("Product stock is inconsistent with stock movements.");
  for (const sale of sales) {
    for (const item of sale.items) {
      const key = `${sale.id}\0${item.productId}`;
      const movement = saleMovements.get(key);
      if (!movement || movement.quantity !== -item.quantity || movement.note !== sale.number || movement.createdAt !== sale.createdAt) throw new Error("Sale stock movements do not match receipt history.");
      saleMovements.delete(key);
    }
  }
  if (saleMovements.size) throw new Error("Sale stock movements do not match receipt history.");
  return {
    schemaVersion: 1,
    store: { name: requiredText(storeValue.name, "Store name", 80), currency, createdAt: timestamp(storeValue.createdAt, "Store creation time") },
    nextSaleNumber,
    products,
    movements,
    sales,
  };
}

function parseProduct(value: unknown): Product {
  const object = record(value, "Product");
  exact(object, ["id", "sku", "name", "priceMinor", "stock", "reorderLevel", "active", "createdAt", "updatedAt"], "Product");
  return {
    id: identifier(object.id, "Product ID"), sku: requiredText(object.sku, "SKU", 48), name: requiredText(object.name, "Product name", 120),
    priceMinor: boundedInteger(object.priceMinor, "Price", 0, MAX_MONEY), stock: boundedInteger(object.stock, "Stock", 0, MAX_QUANTITY), reorderLevel: boundedInteger(object.reorderLevel, "Reorder level", 0, MAX_QUANTITY),
    active: boolean(object.active, "Product active state"), createdAt: timestamp(object.createdAt, "Product creation time"), updatedAt: timestamp(object.updatedAt, "Product update time"),
  };
}

function parseMovement(value: unknown, productIds: Set<string>): StockMovement {
  const object = record(value, "Stock movement");
  const required = ["id", "productId", "type", "quantity", "note", "createdAt"];
  const allowed = object.saleId === undefined ? required : [...required, "saleId"];
  exact(object, allowed, "Stock movement");
  const productId = identifier(object.productId, "Movement product ID");
  if (!productIds.has(productId)) throw new Error("A stock movement references an unknown product.");
  const type = object.type;
  if (type !== "opening" && type !== "receive" && type !== "adjustment" && type !== "sale") throw new Error("Stock movement type is invalid.");
  const saleId = object.saleId === undefined ? undefined : identifier(object.saleId, "Movement sale ID");
  const quantity = boundedInteger(object.quantity, "Movement quantity", -MAX_QUANTITY, MAX_QUANTITY);
  if (quantity === 0) throw new Error("Stock movement quantity cannot be zero.");
  if ((type === "opening" || type === "receive") && quantity < 0) throw new Error("Opening and received stock movements must be positive.");
  if (type === "sale" && (quantity > 0 || !saleId)) throw new Error("Sale stock movements must be negative and reference a sale.");
  if (type !== "sale" && saleId) throw new Error("Only sale stock movements can reference a sale.");
  return { id: identifier(object.id, "Movement ID"), productId, type, quantity, note: requiredText(object.note, "Movement note", 200), ...(saleId ? { saleId } : {}), createdAt: timestamp(object.createdAt, "Movement time") };
}

function parseSale(value: unknown, productIds: Set<string>): Sale {
  const object = record(value, "Sale");
  exact(object, ["id", "number", "createdAt", "items", "subtotalMinor", "totalMinor", "tender"], "Sale");
  const itemProductIds = new Set<string>();
  const items = boundedArray(object.items, "Sale items", 100).map((value) => {
    const item = record(value, "Sale item");
    exact(item, ["productId", "sku", "name", "unitPriceMinor", "quantity", "lineTotalMinor"], "Sale item");
    const productId = identifier(item.productId, "Sale product ID");
    if (!productIds.has(productId)) throw new Error("A sale references an unknown product.");
    if (itemProductIds.has(productId)) throw new Error("A product appears more than once in a sale.");
    itemProductIds.add(productId);
    const unitPriceMinor = boundedInteger(item.unitPriceMinor, "Sale unit price", 0, MAX_MONEY);
    const quantity = boundedInteger(item.quantity, "Sale quantity", 1, MAX_QUANTITY);
    const lineTotalMinor = boundedInteger(item.lineTotalMinor, "Sale line total", 0, MAX_MONEY);
    if (lineTotalMinor !== unitPriceMinor * quantity) throw new Error("A sale line total is inconsistent.");
    return { productId, sku: requiredText(item.sku, "Sale SKU", 48), name: requiredText(item.name, "Sale product name", 120), unitPriceMinor, quantity, lineTotalMinor };
  });
  if (items.length === 0) throw new Error("A sale must contain an item.");
  const subtotalMinor = boundedInteger(object.subtotalMinor, "Sale subtotal", 0, MAX_MONEY);
  const totalMinor = boundedInteger(object.totalMinor, "Sale total", 0, MAX_MONEY);
  if (subtotalMinor !== items.reduce((total, item) => total + item.lineTotalMinor, 0) || totalMinor !== subtotalMinor) throw new Error("Sale totals are inconsistent.");
  const tender = record(object.tender, "Sale tender");
  exact(tender, ["method", "amountMinor", "changeMinor"], "Sale tender");
  if (tender.method !== "cash" && tender.method !== "card" && tender.method !== "other") throw new Error("Tender method is invalid.");
  const amountMinor = boundedInteger(tender.amountMinor, "Tender amount", 0, MAX_MONEY);
  const changeMinor = boundedInteger(tender.changeMinor, "Tender change", 0, MAX_MONEY);
  if (amountMinor - totalMinor !== changeMinor) throw new Error("Tender change is inconsistent.");
  if (tender.method !== "cash" && (amountMinor !== totalMinor || changeMinor !== 0)) throw new Error("Non-cash tender must exactly match the sale total.");
  return { id: identifier(object.id, "Sale ID"), number: requiredText(object.number, "Sale number", 24), createdAt: timestamp(object.createdAt, "Sale time"), items, subtotalMinor, totalMinor, tender: { method: tender.method, amountMinor, changeMinor } };
}

function saleSequence(value: string): number {
  const match = /^S-(\d{6,8})$/.exec(value);
  if (!match) throw new Error("Sale number is invalid.");
  return boundedInteger(Number(match[1]), "Sale number", 1, 10_000_000);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: string[], label: string): void {
  const allowed = new Set(fields);
  if (Object.keys(value).some((key) => !allowed.has(key)) || fields.some((field) => !(field in value))) throw new Error(`${label} contains unsupported or missing fields.`);
}

function boundedArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must contain no more than ${maximum} records.`);
  return value;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  return result;
}

function identifier(value: unknown, label: string): string {
  const result = requiredText(value, label, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function timestamp(value: unknown, label: string): number {
  return boundedInteger(value, label, 0, 8_640_000_000_000_000);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}
