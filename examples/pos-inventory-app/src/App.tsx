import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Archive,
  ArrowClockwise,
  Basket,
  CashRegister,
  Check,
  ClockCounterClockwise,
  FolderOpen,
  MagnifyingGlass,
  Minus,
  Package,
  Plus,
  Receipt,
  Storefront,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  HirayaSdkError,
  type AppCapabilities,
  type FileHandle,
  type HirayaClient,
  type LaunchContext,
} from "@hiraya/apps-sdk";
import {
  STORE_MIME_TYPE,
  adjustStock,
  completeSale,
  createStore,
  currencyFractionDigits,
  formatMoney,
  parseMoneyInput,
  parseStoreText,
  saveProduct,
  serializeStore,
  setProductActive,
  type Product,
  type Sale,
  type StoreDocument,
  type TenderMethod,
} from "./store";

export const APP_ID = "dev.hiraya.pos";

type View = "sell" | "products" | "inventory" | "sales";
type Status = Readonly<{ message: string; danger?: boolean }>;
type Session = Readonly<{ handle: FileHandle; revision: number; document: StoreDocument }>;
type ProductDraft = Readonly<{ id?: string; sku: string; name: string; price: string; openingStock: string; reorderLevel: string }>;
type StockDraft = Readonly<{ productId: string; direction: "receive" | "remove"; quantity: string; note: string }>;
type HirayaDialogElement = HTMLElement & { close(): void };

const EMPTY_PRODUCT: ProductDraft = { sku: "", name: "", price: "", openingStock: "0", reorderLevel: "0" };

export function App({ hiraya, launch }: Readonly<{ hiraya: HirayaClient; launch: LaunchContext }>) {
  const [session, setSession] = useState<Session | null>(null);
  const [capabilities, setCapabilities] = useState<AppCapabilities>({ files: { write: false, writeReason: "temporarily-unavailable" }, externalEmbeddedPreviews: false });
  const [view, setView] = useState<View>("sell");
  const [status, setStatus] = useState<Status>({ message: "Choose or create a store to begin." });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [tenderMethod, setTenderMethod] = useState<TenderMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [stockDraft, setStockDraft] = useState<StockDraft | null>(null);
  const [formError, setFormError] = useState("");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("My Store");
  const [storeCurrency, setStoreCurrency] = useState("PHP");
  const sessionRef = useRef(session);
  const busyRef = useRef(busy);
  const cartRef = useRef(cart);
  const searchRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const openStoreRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const reloadStoreRef = useRef<(announce?: boolean) => Promise<void>>(() => Promise.resolve());
  const startNewSaleRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const started = useRef(false);
  sessionRef.current = session;
  busyRef.current = busy;
  cartRef.current = cart;
  startRef.current = start;
  openStoreRef.current = openStore;
  reloadStoreRef.current = reloadStore;
  startNewSaleRef.current = startNewSale;

  const document = session?.document ?? null;
  const canWrite = capabilities.files.write && !busy;
  const cartLines = document ? Object.entries(cart).flatMap(([productId, quantity]) => {
    const product = document.products.find((candidate) => candidate.id === productId);
    return product ? [{ product, quantity }] : [];
  }) : [];
  const totalMinor = cartLines.reduce((total, line) => total + line.product.priceMinor * line.quantity, 0);
  const selectedSale = document?.sales.find((sale) => sale.id === selectedSaleId) ?? receipt;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startRef.current();
  }, []);

  useEffect(() => {
    const unsubscribeCapabilities = hiraya.on("capabilities.changed", (next) => {
      setCapabilities(next);
      if (!next.files.write) setStatus({ message: writeRestriction(next.files.writeReason), danger: true });
    });
    const unsubscribeFiles = hiraya.on("files.changed", ({ handles }) => {
      const current = sessionRef.current;
      if (!current || !handles.includes(current.handle) || busyRef.current) return;
      if (Object.keys(cartRef.current).length > 0) {
        setStatus({ message: "The store changed elsewhere. Finish or discard the current sale before refreshing.", danger: true });
        return;
      }
      void reloadStoreRef.current(false);
    });
    const unsubscribeCommands = hiraya.on("commands.invoked", ({ id }) => {
      if (id === "new-sale") void startNewSaleRef.current();
      if (id === "products") setView("products");
      if (id === "inventory") setView("inventory");
      if (id === "sales") setView("sales");
      if (id === "open-store") void openStoreRef.current();
    });
    return () => { unsubscribeCapabilities(); unsubscribeFiles(); unsubscribeCommands(); };
  }, [hiraya]);

  const storeTitle = document?.store.name;
  useEffect(() => {
    void hiraya.window.setTitle(storeTitle ? `${storeTitle} - Hiraya POS` : "Hiraya POS");
  }, [hiraya, storeTitle]);

  useEffect(() => {
    void hiraya.window.setDirty(cartLines.length > 0 || productDraft !== null || stockDraft !== null);
  }, [cartLines.length, hiraya, productDraft, stockDraft]);

  useEffect(() => {
    void hiraya.commands.set([
      { id: "new-sale", title: "Start a new sale", shortcut: "Ctrl+N", enabled: Boolean(document) },
      { id: "products", title: "View products", enabled: Boolean(document) },
      { id: "inventory", title: "View inventory", enabled: Boolean(document) },
      { id: "sales", title: "View sales history", enabled: Boolean(document) },
      { id: "open-store", title: "Open another store", shortcut: "Ctrl+O", enabled: !busy },
    ]).catch(() => undefined);
  }, [busy, document, hiraya]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setView("sell"); setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); void startNewSaleRef.current(); }
      if (event.key.toLowerCase() === "o") { event.preventDefault(); void openStoreRef.current(); }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);

  async function start() {
    try {
      setCapabilities(await hiraya.app.getCapabilities());
      if (launch.files[0]) await loadStore(launch.files[0]);
    } catch (error) {
      setStatus({ message: describeError(error, "Hiraya POS could not finish starting."), danger: true });
    }
  }

  async function readStore(handle: FileHandle): Promise<Session> {
    const before = await hiraya.files.stat(handle, { timeoutMs: 120_000 });
    if (before.kind !== "file") throw new Error("The selected item is not a store file.");
    const result = await hiraya.files.readAll(handle, { timeoutMs: 120_000 });
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(result.data); } catch { throw new Error("The store file is not valid UTF-8 text."); }
    const after = await hiraya.files.stat(handle, { timeoutMs: 120_000 });
    if (after.kind !== "file" || before.metadata.contentRevision !== after.metadata.contentRevision) throw new HirayaSdkError("The store changed while it was being opened.", "CONFLICT");
    return { handle, revision: after.metadata.contentRevision, document: parseStoreText(text) };
  }

  async function loadStore(handle: FileHandle) {
    setBusy(true);
    try {
      const next = await readStore(handle);
      setSession(next);
      setCart({});
      setReceipt(null);
      setSelectedSaleId(null);
      setProductDraft(null);
      setStockDraft(null);
      setStatus({ message: `${next.document.store.name} is ready.` });
      setTimeout(() => searchRef.current?.focus(), 0);
    } catch (error) {
      setStatus({ message: describeError(error, "The store could not be opened."), danger: true });
    } finally {
      setBusy(false);
    }
  }

  async function openStore() {
    try {
      if ((Object.keys(cartRef.current).length > 0 || productDraft || stockDraft) && !await hiraya.dialogs.confirm({ title: "Discard unsaved work?", message: "Opening another store clears the current sale and any unsaved product or inventory form.", confirmLabel: "Discard and open", destructive: true })) return;
      const handles = await hiraya.dialogs.openFile();
      if (handles?.[0]) await loadStore(handles[0]);
    } catch (error) {
      const message = describeError(error, "The store could not be selected.");
      if (message) setStatus({ message, danger: true });
    }
  }

  async function createNewStore(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const next = createStore(storeName, storeCurrency);
      currencyFractionDigits(next.store.currency);
      const handle = await hiraya.dialogs.saveFile({ suggestedName: `${safeFilename(next.store.name)}.hpos`, mimeType: STORE_MIME_TYPE }, { timeoutMs: 120_000 });
      if (!handle) return;
      const entry = await hiraya.files.stat(handle, { timeoutMs: 120_000 });
      if (entry.kind !== "file") throw new Error("Hiraya did not create a store file.");
      const saved = await hiraya.files.writeAll(handle, exactBuffer(new TextEncoder().encode(serializeStore(next))), { mimeType: STORE_MIME_TYPE, expectedRevision: entry.metadata.contentRevision, timeoutMs: 120_000 });
      setSession({ handle, revision: saved.contentRevision, document: next });
      setStatus({ message: `${next.store.name} was created.` });
    } catch (error) {
      const message = describeError(error, "The store could not be created.");
      if (message) setStatus({ message, danger: true });
    } finally {
      setBusy(false);
    }
  }

  async function reloadStore(announce = true) {
    const current = sessionRef.current;
    if (!current || busyRef.current) return;
    if (Object.keys(cartRef.current).length > 0 && !await hiraya.dialogs.confirm({ title: "Discard current sale?", message: "Refreshing reloads prices and stock, so the current sale must be cleared first.", confirmLabel: "Discard and refresh", destructive: true })) return;
    setBusy(true);
    try {
      const next = await readStore(current.handle);
      if (next.revision !== current.revision) {
        setSession(next);
        setCart({});
        if (announce) setStatus({ message: "The store was refreshed from Hiraya." });
      }
    } catch (error) {
      setStatus({ message: describeError(error, "The store could not be refreshed."), danger: true });
    } finally {
      setBusy(false);
    }
  }

  async function commit(next: StoreDocument, successMessage: string, wasApplied: (document: StoreDocument) => boolean): Promise<StoreDocument | null> {
    const current = sessionRef.current;
    if (!current) return null;
    if (!capabilities.files.write) { setStatus({ message: writeRestriction(capabilities.files.writeReason), danger: true }); return null; }
    setBusy(true);
    try {
      const bytes = new TextEncoder().encode(serializeStore(next));
      const saved = await hiraya.files.writeAll(current.handle, exactBuffer(bytes), { mimeType: STORE_MIME_TYPE, expectedRevision: current.revision, timeoutMs: 120_000 });
      setSession({ handle: current.handle, revision: saved.contentRevision, document: next });
      setStatus({ message: successMessage });
      return next;
    } catch (error) {
      if (error instanceof HirayaSdkError && (error.code === "CONFLICT" || error.code === "TIMEOUT" || error.code === "CANCELLED")) {
        try {
          const latest = await readStore(current.handle);
          setSession(latest);
          if (wasApplied(latest.document)) {
            setStatus({ message: `${successMessage} The result was verified after an interrupted response.` });
            return latest.document;
          }
          setStatus({ message: error.code === "CONFLICT" ? "The store changed elsewhere. Current data was reloaded; review your pending work and try again." : "The save result was uncertain. Current data was reloaded and your pending work was preserved.", danger: true });
          return null;
        } catch (reloadError) {
          setStatus({ message: describeError(reloadError, "The save failed and the store could not be reloaded."), danger: true });
          return null;
        }
      }
      setStatus({ message: describeError(error, "The store could not be saved."), danger: true });
      return null;
    } finally {
      setBusy(false);
    }
  }

  function updateCart(product: Product, delta: number) {
    setReceipt(null);
    setSelectedSaleId(null);
    setCart((current) => {
      const quantity = Math.max(0, Math.min(product.stock, (current[product.id] ?? 0) + delta));
      if (quantity === 0) { const next = { ...current }; delete next[product.id]; return next; }
      return { ...current, [product.id]: quantity };
    });
  }

  async function startNewSale() {
    if (Object.keys(cartRef.current).length > 0 && !await hiraya.dialogs.confirm({ title: "Discard current sale?", message: "Starting a new sale clears every item currently in the cart.", confirmLabel: "Discard sale", destructive: true })) return;
    setView("sell");
    setReceipt(null);
    setSelectedSaleId(null);
    setCart({});
    setCashReceived("");
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  async function checkout(event: FormEvent) {
    event.preventDefault();
    if (!document || cartLines.length === 0) return;
    const saleId = crypto.randomUUID();
    try {
      const amountMinor = tenderMethod === "cash" ? parseMoneyInput(cashReceived, document.store.currency) : totalMinor;
      const result = completeSale(document, cartLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })), { method: tenderMethod, amountMinor }, saleId);
      const committed = await commit(result.document, `${result.sale.number} completed.`, (candidate) => candidate.sales.some((sale) => sale.id === saleId));
      if (committed) {
        const confirmed = committed.sales.find((sale) => sale.id === saleId) ?? result.sale;
        setReceipt(confirmed);
        setSelectedSaleId(confirmed.id);
        setCart({});
        setCashReceived("");
      }
    } catch (error) {
      setStatus({ message: describeError(error, "The sale could not be completed."), danger: true });
    }
  }

  async function submitProduct(event: FormEvent) {
    event.preventDefault();
    if (!document || !productDraft) return;
    try {
      const id = productDraft.id ?? crypto.randomUUID();
      const next = saveProduct(document, {
        sku: productDraft.sku,
        name: productDraft.name,
        priceMinor: parseMoneyInput(productDraft.price, document.store.currency),
        openingStock: Number(productDraft.openingStock),
        reorderLevel: Number(productDraft.reorderLevel),
      }, id);
      const expected = next.products.find((product) => product.id === id)!;
      const committed = await commit(next, `${expected.name} saved.`, (candidate) => {
        const product = candidate.products.find((item) => item.id === id);
        return Boolean(product && product.sku === expected.sku && product.name === expected.name && product.priceMinor === expected.priceMinor && product.reorderLevel === expected.reorderLevel);
      });
      if (committed) setProductDraft(null);
    } catch (error) {
      const message = describeError(error, "The product could not be saved.");
      setFormError(message);
      setStatus({ message, danger: true });
    }
  }

  async function toggleProduct(product: Product) {
    if (!document) return;
    const next = setProductActive(document, product.id, !product.active);
    await commit(next, `${product.name} ${product.active ? "archived" : "restored"}.`, (candidate) => candidate.products.find((item) => item.id === product.id)?.active === !product.active);
  }

  async function submitStock(event: FormEvent) {
    event.preventDefault();
    if (!document || !stockDraft) return;
    try {
      const magnitude = Number(stockDraft.quantity);
      const quantity = stockDraft.direction === "receive" ? magnitude : -magnitude;
      const movementId = crypto.randomUUID();
      const next = adjustStock(document, stockDraft.productId, quantity, stockDraft.direction === "receive" ? "receive" : "adjustment", stockDraft.note, movementId);
      const committed = await commit(next, "Inventory updated.", (candidate) => candidate.movements.some((movement) => movement.id === movementId));
      if (committed) setStockDraft(null);
    } catch (error) {
      const message = describeError(error, "Inventory could not be updated.");
      setFormError(message);
      setStatus({ message, danger: true });
    }
  }

  if (!document) return (
    <Welcome
      busy={busy}
      status={status}
      name={storeName}
      currency={storeCurrency}
      onName={setStoreName}
      onCurrency={setStoreCurrency}
      onCreate={createNewStore}
      onOpen={() => void openStore()}
    />
  );

  const filteredProducts = document.products.filter((product) => {
    const query = search.trim().toLocaleLowerCase();
    return product.active && (!query || product.name.toLocaleLowerCase().includes(query) || product.sku.toLocaleLowerCase().includes(query));
  }).slice(0, 50);

  return (
    <main className="pos-shell">
      <header className="topbar">
        <button className="store-identity" type="button" onClick={() => setView("sell")}>
          <span className="store-mark" aria-hidden="true"><CashRegister weight="duotone" /></span>
          <span><strong>{document.store.name}</strong><small>Hiraya POS</small></span>
        </button>
        <div className="topbar-actions">
          {!capabilities.files.write && <hiraya-badge tone="readonly">Read only</hiraya-badge>}
          <hiraya-button className="icon-action" variant="quiet" onClick={() => void reloadStore()} disabled={busy} aria-label="Refresh store"><ArrowClockwise className={busy ? "spin" : ""} /></hiraya-button>
          <hiraya-button className="open-store-button" onClick={() => void openStore()} disabled={busy} aria-label="Open store"><FolderOpen slot="icon-start" /><span>Open store</span></hiraya-button>
        </div>
      </header>

      <nav className="side-nav" aria-label="Hiraya POS">
        <NavButton active={view === "sell"} onClick={() => setView("sell")} icon={<Basket />} label="Sell" />
        <NavButton active={view === "products"} onClick={() => setView("products")} icon={<Package />} label="Products" />
        <NavButton active={view === "inventory"} onClick={() => setView("inventory")} icon={<Archive />} label="Inventory" />
        <NavButton active={view === "sales"} onClick={() => setView("sales")} icon={<Receipt />} label="Sales" />
      </nav>

      <section className="app-workspace">
        {view === "sell" && (
          <div className="sell-layout">
            <section className="catalog-surface" aria-labelledby="sell-title">
              <div className="command-heading">
                <div><h1 id="sell-title">What are they buying?</h1><p>Search the catalog by product name or SKU.</p></div>
                <span className="keyboard-hint">Ctrl K</span>
              </div>
              <label className="search-command">
                <MagnifyingGlass aria-hidden="true" />
                <span className="sr-only">Search products</span>
                <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or enter SKU" autoComplete="off" />
                {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X /></button>}
              </label>
              <div className="catalog-meta"><span>{filteredProducts.length} available</span><span>{document.products.filter((product) => product.active && product.stock <= product.reorderLevel).length} low stock</span></div>
              <div className="product-results">
                {filteredProducts.map((product) => {
                  const quantity = cart[product.id] ?? 0;
                  return (
                    <button className="product-result" type="button" key={product.id} onClick={() => updateCart(product, 1)} disabled={product.stock === 0 || quantity >= product.stock}>
                      <span className="product-result-main"><strong>{product.name}</strong><small>{product.sku}</small></span>
                      <span className={`stock-count${product.stock <= product.reorderLevel ? " stock-count--low" : ""}`}>{product.stock} in stock</span>
                      <strong className="product-price">{formatMoney(product.priceMinor, document.store.currency)}</strong>
                      <span className="add-mark" aria-hidden="true"><Plus /></span>
                    </button>
                  );
                })}
                {filteredProducts.length === 0 && <Empty icon={<Package />} title="No products found" message={document.products.length === 0 ? "Add the first product from Products, then return here to make a sale." : "Try another name or SKU."} />}
              </div>
            </section>

            <aside className="checkout-surface" aria-label="Current sale">
              {selectedSale ? (
                <ReceiptView sale={selectedSale} currency={document.store.currency} onNew={() => void startNewSale()} />
              ) : (
                <form className="checkout-form" onSubmit={checkout}>
                  <div className="checkout-heading"><div><h2>Current sale</h2><p>{cartLines.length ? `${cartLines.reduce((total, line) => total + line.quantity, 0)} items` : "Ready for the first item"}</p></div><Receipt aria-hidden="true" /></div>
                  <div className="cart-lines">
                    {cartLines.map(({ product, quantity }) => (
                      <div className="cart-line" key={product.id}>
                        <div><strong>{product.name}</strong><small>{formatMoney(product.priceMinor, document.store.currency)} each</small></div>
                        <div className="quantity-stepper" aria-label={`${product.name} quantity`}>
                          <button type="button" onClick={() => updateCart(product, -1)} aria-label={`Remove one ${product.name}`}><Minus /></button>
                          <output>{quantity}</output>
                          <button type="button" onClick={() => updateCart(product, 1)} disabled={quantity >= product.stock} aria-label={`Add one ${product.name}`}><Plus /></button>
                        </div>
                        <strong>{formatMoney(product.priceMinor * quantity, document.store.currency)}</strong>
                      </div>
                    ))}
                    {cartLines.length === 0 && <Empty icon={<Basket />} title="The receipt is empty" message="Choose a product from the catalog to begin." compact />}
                  </div>
                  <div className="checkout-total"><span>Total</span><strong>{formatMoney(totalMinor, document.store.currency)}</strong></div>
                  <fieldset className="tender-methods"><legend>Tender</legend>{(["cash", "card", "other"] as TenderMethod[]).map((method) => <label key={method}><input type="radio" name="tender" value={method} checked={tenderMethod === method} onChange={() => setTenderMethod(method)} /><span>{capitalize(method)}</span></label>)}</fieldset>
                  {tenderMethod === "cash" && <label className="field"><span>Cash received</span><input inputMode="decimal" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder={moneyPlaceholder(document.store.currency)} required /></label>}
                  <button className="charge-button" type="submit" disabled={!canWrite || cartLines.length === 0 || (tenderMethod === "cash" && !cashReceived)}><span>Complete sale</span><strong>{formatMoney(totalMinor, document.store.currency)}</strong></button>
                </form>
              )}
            </aside>
          </div>
        )}

        {view === "products" && (
          <ManagementSurface title="Products" description={`${document.products.filter((product) => product.active).length} active catalog products`} action={<hiraya-button variant="primary" onClick={() => { setFormError(""); setProductDraft(EMPTY_PRODUCT); }} disabled={!canWrite}><Plus slot="icon-start" /> Add product</hiraya-button>}>
            <div className="table-list product-table" role="table" aria-label="Products">
              <div className="table-header" role="row"><span role="columnheader">Name</span><span role="columnheader">SKU</span><span role="columnheader">Price</span><span role="columnheader">Stock</span><span role="columnheader">Actions</span></div>
              {document.products.map((product) => <div className={`table-row${product.active ? "" : " table-row--muted"}`} role="row" key={product.id}>
                <span role="cell"><button className="row-title" type="button" onClick={() => { setFormError(""); setProductDraft(productToDraft(product, document.store.currency)); }}><strong>{product.name}</strong><small>{product.active ? "Active" : "Archived"}</small></button></span>
                <span role="cell">{product.sku}</span><strong role="cell">{formatMoney(product.priceMinor, document.store.currency)}</strong><span role="cell">{product.stock}</span>
                <span role="cell"><hiraya-button variant="quiet" onClick={() => void toggleProduct(product)} disabled={!canWrite}>{product.active ? "Archive" : "Restore"}</hiraya-button></span>
              </div>)}
              {document.products.length === 0 && <Empty icon={<Package />} title="No products yet" message="Add a product with its SKU, price, and opening stock." />}
            </div>
          </ManagementSurface>
        )}

        {view === "inventory" && (
          <ManagementSurface title="Inventory" description="Receive stock and record every manual removal">
            <div className="inventory-layout">
              <div className="table-list inventory-table" role="table" aria-label="Inventory">
                <div className="table-header" role="row"><span role="columnheader">Product</span><span role="columnheader">On hand</span><span role="columnheader">Reorder at</span><span role="columnheader">Actions</span></div>
                {document.products.filter((product) => product.active).map((product) => <div className="table-row" role="row" key={product.id}>
                  <span className="row-title" role="cell"><strong>{product.name}</strong><small>{product.sku}</small></span>
                  <strong role="cell" className={product.stock <= product.reorderLevel ? "danger-text" : ""}>{product.stock}</strong><span role="cell">{product.reorderLevel}</span>
                  <span role="cell"><hiraya-button onClick={() => { setFormError(""); setStockDraft({ productId: product.id, direction: "receive", quantity: "1", note: "" }); }} disabled={!canWrite}>Adjust</hiraya-button></span>
                </div>)}
              </div>
              <section className="movement-ledger" aria-labelledby="movement-title"><div className="section-heading"><h2 id="movement-title">Recent movement</h2><ClockCounterClockwise /></div>
                <div className="movement-list">{[...document.movements].reverse().slice(0, 50).map((movement) => {
                  const product = document.products.find((candidate) => candidate.id === movement.productId);
                  return <div className="movement-row" key={movement.id}><div><strong>{product?.name ?? "Unknown product"}</strong><small>{movement.note} · {formatDate(movement.createdAt)}</small></div><strong className={movement.quantity < 0 ? "danger-text" : "positive-text"}>{movement.quantity > 0 ? "+" : ""}{movement.quantity}</strong></div>;
                })}{document.movements.length === 0 && <Empty icon={<Archive />} title="No movement yet" message="Opening stock and future adjustments appear here." compact />}</div>
              </section>
            </div>
          </ManagementSurface>
        )}

        {view === "sales" && (
          <ManagementSurface title="Sales" description={`${document.sales.length} completed receipts`}>
            <div className="sales-layout">
              <div className="sales-list">{[...document.sales].reverse().map((sale) => <button type="button" className={selectedSaleId === sale.id ? "sale-row sale-row--active" : "sale-row"} key={sale.id} onClick={() => setSelectedSaleId(sale.id)}><span><strong>{sale.number}</strong><small>{formatDate(sale.createdAt)} · {capitalize(sale.tender.method)}</small></span><strong>{formatMoney(sale.totalMinor, document.store.currency)}</strong></button>)}{document.sales.length === 0 && <Empty icon={<Receipt />} title="No completed sales" message="Receipts appear here after checkout." />}</div>
              <aside className="sale-detail">{selectedSale ? <ReceiptView sale={selectedSale} currency={document.store.currency} /> : <Empty icon={<Receipt />} title="Choose a receipt" message="Select a completed sale to inspect its immutable details." />}</aside>
            </div>
          </ManagementSurface>
        )}
      </section>

      <hiraya-status-bar className="statusbar" tone={status.danger ? "danger" : "neutral"} live="polite">{status.danger ? <WarningCircle /> : <Check />}<span>{status.message}</span><span className="status-file">.hpos · rev {session?.revision ?? 0}</span></hiraya-status-bar>

      <nav className="mobile-nav" aria-label="Hiraya POS">
        <NavButton active={view === "sell"} onClick={() => setView("sell")} icon={<Basket />} label="Sell" />
        <NavButton active={view === "products"} onClick={() => setView("products")} icon={<Package />} label="Products" />
        <NavButton active={view === "inventory"} onClick={() => setView("inventory")} icon={<Archive />} label="Inventory" />
        <NavButton active={view === "sales"} onClick={() => setView("sales")} icon={<Receipt />} label="Sales" />
      </nav>

      {productDraft && <Modal title={productDraft.id ? "Edit product" : "Add product"} closeLabel="Close product form" onClose={() => setProductDraft(null)}><form onSubmit={submitProduct}>
        {formError ? <hiraya-notice className="form-notice" tone="danger" live="assertive">{formError}</hiraya-notice> : <p className="sheet-description">Catalog details are shared with checkout and inventory.</p>}
        <label className="field"><span>Product name</span><input value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} maxLength={120} required autoFocus /></label>
        <label className="field"><span>SKU</span><input value={productDraft.sku} onChange={(event) => setProductDraft({ ...productDraft, sku: event.target.value })} maxLength={48} required /></label>
        <label className="field"><span>Final price ({document.store.currency})</span><input inputMode="decimal" value={productDraft.price} onChange={(event) => setProductDraft({ ...productDraft, price: event.target.value })} placeholder={moneyPlaceholder(document.store.currency)} required /></label>
        {!productDraft.id && <label className="field"><span>Opening stock</span><input type="number" min="0" step="1" value={productDraft.openingStock} onChange={(event) => setProductDraft({ ...productDraft, openingStock: event.target.value })} required /></label>}
        <label className="field"><span>Low-stock threshold</span><input type="number" min="0" step="1" value={productDraft.reorderLevel} onChange={(event) => setProductDraft({ ...productDraft, reorderLevel: event.target.value })} required /></label>
        <div className="sheet-actions"><hiraya-button onClick={() => setProductDraft(null)}>Cancel</hiraya-button><button className="primary-button" type="submit" disabled={!canWrite}>{busy ? "Saving..." : "Save product"}</button></div>
      </form></Modal>}

      {stockDraft && <Modal title="Adjust inventory" closeLabel="Close inventory form" onClose={() => setStockDraft(null)}><form onSubmit={submitStock}>
        {formError ? <hiraya-notice className="form-notice" tone="danger" live="assertive">{formError}</hiraya-notice> : <p className="sheet-description">{document.products.find((product) => product.id === stockDraft.productId)?.name}</p>}
        <fieldset className="tender-methods"><legend>Change</legend><label><input type="radio" name="direction" checked={stockDraft.direction === "receive"} onChange={() => setStockDraft({ ...stockDraft, direction: "receive" })} /><span>Receive</span></label><label><input type="radio" name="direction" checked={stockDraft.direction === "remove"} onChange={() => setStockDraft({ ...stockDraft, direction: "remove" })} /><span>Remove</span></label></fieldset>
        <label className="field"><span>Quantity</span><input type="number" min="1" step="1" value={stockDraft.quantity} onChange={(event) => setStockDraft({ ...stockDraft, quantity: event.target.value })} required autoFocus /></label>
        <label className="field"><span>Reason</span><input value={stockDraft.note} onChange={(event) => setStockDraft({ ...stockDraft, note: event.target.value })} maxLength={200} placeholder={stockDraft.direction === "receive" ? "Supplier delivery" : "Damage, expiry, or correction"} required /></label>
        <div className="sheet-actions"><hiraya-button onClick={() => setStockDraft(null)}>Cancel</hiraya-button><button className="primary-button" type="submit" disabled={!canWrite}>{busy ? "Saving..." : "Update stock"}</button></div>
      </form></Modal>}
    </main>
  );
}

function Welcome({ busy, status, name, currency, onName, onCurrency, onCreate, onOpen }: Readonly<{ busy: boolean; status: Status; name: string; currency: string; onName(value: string): void; onCurrency(value: string): void; onCreate(event: FormEvent): void; onOpen(): void }>) {
  return <main className="welcome-shell"><section className="welcome-copy"><span className="welcome-mark" aria-hidden="true"><CashRegister weight="duotone" /></span><h1>One file.<br />One clear register.</h1><p>Sell products and keep stock reconciled in the same portable Hiraya store file. No payment processor, hidden database, or network service required.</p><hiraya-button onClick={onOpen} disabled={busy}><FolderOpen slot="icon-start" /> Open an existing .hpos store</hiraya-button></section><section className="create-store-panel"><div><Storefront /><h2>Create a store</h2><p>Choose the name and currency that every receipt will use.</p></div><form onSubmit={onCreate}><label className="field"><span>Store name</span><input value={name} onChange={(event) => onName(event.target.value)} maxLength={80} required /></label><label className="field"><span>ISO currency</span><input value={currency} onChange={(event) => onCurrency(event.target.value.toUpperCase())} minLength={3} maxLength={3} pattern="[A-Z]{3}" required /></label><button className="primary-button create-button" type="submit" disabled={busy}>{busy ? "Creating..." : "Create store file"}</button></form><p className={status.danger ? "welcome-status welcome-status--danger" : "welcome-status"} role="status">{status.message}</p></section></main>;
}

function Modal({ title, closeLabel, onClose, children }: Readonly<{ title: string; closeLabel: string; onClose(): void; children: ReactNode }>) {
  const ref = useRef<HirayaDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const requestClose = () => onClose();
    dialog.addEventListener("hiraya-request-close", requestClose);
    return () => dialog.removeEventListener("hiraya-request-close", requestClose);
  }, [onClose]);
  return <hiraya-dialog ref={ref} className="edit-sheet" open close-label={closeLabel}><span slot="title">{title}</span>{children}</hiraya-dialog>;
}

function NavButton({ active, onClick, icon, label }: Readonly<{ active: boolean; onClick(): void; icon: ReactNode; label: string }>) {
  return <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}><span aria-hidden="true">{icon}</span><strong>{label}</strong></button>;
}

function ManagementSurface({ title, description, action, children }: Readonly<{ title: string; description: string; action?: ReactNode; children: ReactNode }>) {
  return <section className="management-surface"><header className="management-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</header><div className="management-body">{children}</div></section>;
}

function Empty({ icon, title, message, compact = false }: Readonly<{ icon: ReactNode; title: string; message: string; compact?: boolean }>) {
  return <hiraya-empty-state className={compact ? "empty-state empty-state--compact" : "empty-state"}><span slot="icon" aria-hidden="true">{icon}</span><strong slot="title">{title}</strong><span>{message}</span></hiraya-empty-state>;
}

function ReceiptView({ sale, currency, onNew }: Readonly<{ sale: Sale; currency: string; onNew?: () => void }>) {
  return <div className="receipt-view"><div className="receipt-success"><span aria-hidden="true"><Check /></span><div><strong>{sale.number}</strong><small>{formatDate(sale.createdAt)}</small></div></div><div className="receipt-items">{sale.items.map((item) => <div key={item.productId}><span><strong>{item.name}</strong><small>{item.quantity} × {formatMoney(item.unitPriceMinor, currency)}</small></span><strong>{formatMoney(item.lineTotalMinor, currency)}</strong></div>)}</div><dl className="receipt-totals"><div><dt>Total</dt><dd>{formatMoney(sale.totalMinor, currency)}</dd></div><div><dt>{capitalize(sale.tender.method)} received</dt><dd>{formatMoney(sale.tender.amountMinor, currency)}</dd></div>{sale.tender.changeMinor > 0 && <div><dt>Change</dt><dd>{formatMoney(sale.tender.changeMinor, currency)}</dd></div>}</dl>{onNew && <button className="primary-button new-sale-button" type="button" onClick={onNew}><Plus /> Start next sale</button>}</div>;
}

function productToDraft(product: Product, currency: string): ProductDraft {
  const digits = currencyFractionDigits(currency);
  return { id: product.id, sku: product.sku, name: product.name, price: (product.priceMinor / 10 ** digits).toFixed(digits), openingStock: "0", reorderLevel: String(product.reorderLevel) };
}

function moneyPlaceholder(currency: string): string {
  return currencyFractionDigits(currency) === 0 ? "0" : `0.${"0".repeat(currencyFractionDigits(currency))}`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function safeFilename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "store";
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function writeRestriction(reason: AppCapabilities["files"]["writeReason"]): string {
  if (reason === "read-only") return "This store is read-only. Copy it to a desktop you own before making changes.";
  if (reason === "shared-offline") return "Shared stores can only be changed while Hiraya is online.";
  return "Store changes are temporarily unavailable. Your current cart is preserved.";
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof HirayaSdkError) {
    if (error.code === "CANCELLED") return "";
    if (error.code === "OFFLINE") return "This store is not available offline. Reconnect to Hiraya and try again.";
    if (error.code === "CONFLICT") return "The store changed elsewhere. Your pending work is preserved; reload and review it.";
    if (error.code === "PERMISSION_DENIED") return "Hiraya no longer permits this store action.";
    if (error.code === "QUOTA_EXCEEDED") return "The store exceeds the available Hiraya storage limit.";
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : fallback;
}
