import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { getSetting, logEvent, setSetting } from "./db.js";
import { authorizationUrl, exchangeCode, isConnected, needsMessageReconnect } from "./ebay/auth.js";
import { defaultRules } from "./pricing/rules.js";
import { rulesFor } from "./jobs/sync-prices.js";

const app = createApp();
const { db } = app;

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · eBay Panel</title><style>
body{font:15px system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1d2433}
nav{background:#1d2433;padding:12px 16px}nav a{color:#fff;margin-right:16px;text-decoration:none}
main{max-width:1100px;margin:0 auto;padding:16px}table{width:100%;border-collapse:collapse;background:#fff}
th,td{padding:8px;border-bottom:1px solid #e3e6eb;text-align:left;vertical-align:top}
form.inline{display:inline}input,select,textarea{font:inherit;padding:4px}button{font:inherit;padding:4px 10px;cursor:pointer}
.card{background:#fff;padding:16px;margin-bottom:16px;border-radius:6px}.err{color:#b42318}.ok{color:#067647}
.wrap{overflow-x:auto}.muted{color:#667085}
.msg{background:#fff;padding:10px 14px;margin:8px 0;border-radius:6px;max-width:75%;white-space:pre-wrap}
.msg.buyer{border-left:4px solid #2e90fa}.msg.me{margin-left:auto;background:#ecfdf3;border-right:4px solid #12b76a}</style></head><body>
<nav><a href="/">Özet</a><a href="/products">Ürünler</a><a href="/orders">Siparişler</a><a href="/messages">Mesajlar</a><a href="/rules">Kurallar</a></nav>
<main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return new URLSearchParams(data);
}

function send(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(html);
}
const redirect = (res: ServerResponse, to: string) => res.writeHead(303, { Location: to }).end();

function authorized(req: IncomingMessage): boolean {
  const password = process.env.PANEL_PASSWORD;
  if (!password) return true;
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(Buffer.from(header.replace(/^Basic /, ""), "base64").toString().split(":").slice(1).join(":"));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function dashboard(): string {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const events = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 20").all() as Array<{ at: string; kind: string; message: string }>;
  const connected = isConnected(db);
  return page("Özet", `
<div class="card">eBay: ${connected ? `<span class="ok">bağlı</span>` : `<span class="err">bağlı değil</span> · <a href="/auth/ebay">eBay hesabını bağla</a>`}
 (${esc(process.env.EBAY_ENV ?? "sandbox")})</div>
<div class="card">Ürün: <b>${count("SELECT COUNT(*) n FROM products")}</b> · Stokta olmayan: <b>${count("SELECT COUNT(*) n FROM products WHERE supplier_in_stock = 0")}</b>
 · Bekleyen sipariş: <b>${count("SELECT COUNT(*) n FROM orders WHERE fulfillment_status != 'FULFILLED'")}</b>
 · Okunmamış mesajlı konuşma: <b>${count("SELECT COUNT(*) n FROM conversations WHERE unread_count > 0")}</b></div>
<div class="card"><form class="inline" method="post" action="/sync/prices"><button>Fiyat/stok kontrolü çalıştır</button></form>
 <form class="inline" method="post" action="/sync/orders"><button>Siparişleri çek</button></form>
 <form class="inline" method="post" action="/sync/messages"><button>Mesajları çek</button></form></div>
<div class="card"><h2>Son olaylar</h2><table>${events.map((e) => `<tr><td>${esc(e.at)}</td><td class="${e.kind === "error" ? "err" : ""}">${esc(e.kind)}</td><td>${esc(e.message)}</td></tr>`).join("")}</table></div>`);
}

function products(): string {
  const rows = db.prepare("SELECT * FROM products ORDER BY sku").all() as Array<Record<string, unknown>>;
  return page("Ürünler", `
<div class="card"><h2>Ürün ekle</h2><form method="post" action="/products">
<input name="sku" placeholder="eBay SKU" required> <input name="ebay_offer_id" placeholder="eBay offer ID">
<select name="supplier"><option value="manual">Manuel / toptancı</option><option value="amazon">Amazon (Keepa)</option></select>
<input name="supplier_product_id" placeholder="Tedarikçi ürün kodu / ASIN" required> <input name="title" placeholder="Başlık">
<input name="rule_set" placeholder="Kural seti" value="default"> <button>Ekle</button></form></div>
<div class="wrap"><table><tr><th>SKU</th><th>Tedarikçi</th><th>Maliyet</th><th>Stok</th><th>eBay fiyat</th><th>eBay adet</th><th>Son kontrol</th><th></th></tr>
${rows.map((r) => `<tr><td>${esc(r.sku)}<br><small>${esc(r.title)}</small></td><td>${esc(r.supplier)}: ${esc(r.supplier_product_id)}</td>
<td>${r.supplier === "manual" ? `<form class="inline" method="post" action="/products/${encodeURIComponent(String(r.sku))}/manual">
<input name="price" size="6" value="${esc(r.supplier_price)}"> <label><input type="checkbox" name="in_stock" ${r.supplier_in_stock === 1 ? "checked" : ""}>stokta</label> <button>Kaydet</button></form>` : esc(r.supplier_price)}</td>
<td>${r.supplier_in_stock === null ? "?" : r.supplier_in_stock ? "var" : `<span class="err">yok</span>`}</td>
<td>${esc(r.listing_price)}</td><td>${esc(r.listing_quantity)}</td><td>${esc(r.last_checked_at)}${r.last_error ? `<br><span class="err">${esc(r.last_error)}</span>` : ""}</td>
<td><form class="inline" method="post" action="/products/${encodeURIComponent(String(r.sku))}/delete"><button>Sil</button></form></td></tr>`).join("")}
</table></div>`);
}

function orders(): string {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all() as Array<Record<string, unknown>>;
  return page("Siparişler", `<div class="wrap"><table><tr><th>Sipariş</th><th>Ürünler</th><th>Adres</th><th>Durum</th><th>Tedarikçi siparişi ve kargo</th></tr>
${rows.map((r) => {
    const items = JSON.parse(String(r.line_items)) as Array<{ sku?: string; title: string; quantity: number }>;
    const ship = JSON.parse(String(r.ship_to)) as { fullName?: string; contactAddress?: Record<string, string> } | null;
    const addr = ship?.contactAddress ?? {};
    return `<tr><td>${esc(r.order_id)}<br><small>${esc(r.created_at)}<br>${esc(r.buyer)} · ${esc(r.total)} ${esc(r.currency)}</small></td>
<td>${items.map((i) => `${esc(i.quantity)}× ${esc(i.title)} <small>(${esc(i.sku)})</small>`).join("<br>")}</td>
<td><small>${esc(ship?.fullName)}<br>${esc(addr.addressLine1)} ${esc(addr.addressLine2)}<br>${esc(addr.city)} ${esc(addr.stateOrProvince)} ${esc(addr.postalCode)} ${esc(addr.countryCode)}</small></td>
<td>${esc(r.fulfillment_status)}</td>
<td><form method="post" action="/orders/${encodeURIComponent(String(r.order_id))}">
<input name="supplier_order_id" placeholder="Tedarikçi sipariş no" value="${esc(r.supplier_order_id)}"><br>
<input name="carrier" placeholder="Kargo (USPS, UPS...)" value="${esc(r.carrier)}" size="8"> <input name="tracking_number" placeholder="Takip no" value="${esc(r.tracking_number)}" size="14"><br>
${r.tracking_uploaded_at ? `<small class="ok">eBay'e gönderildi</small>` : `<button>Kaydet</button>`}</form></td></tr>`;
  }).join("")}</table></div>`);
}

const reconnectNote = () =>
  needsMessageReconnect(db)
    ? `<div class="card err">Mesajları okumak için eBay'e yeni bir izin gerekiyor. <a href="/auth/ebay">eBay hesabını yeniden bağla</a>, sonra "Mesajları çek" de.</div>`
    : "";

/** Most recent order of this buyer, so a message can be read next to its order. */
const latestOrderOf = (buyer: unknown) =>
  buyer ? (db.prepare("SELECT * FROM orders WHERE buyer = ? ORDER BY created_at DESC LIMIT 1").get(String(buyer)) as Record<string, unknown> | undefined) : undefined;

function messages(): string {
  const rows = db.prepare(`
    SELECT c.*, (SELECT body FROM messages m WHERE m.message_id = c.last_message_id) AS last_body,
      (SELECT sender FROM messages m WHERE m.message_id = c.last_message_id) AS last_sender
    FROM conversations c ORDER BY c.last_message_at DESC LIMIT 200`).all() as Array<Record<string, unknown>>;
  const syncedAt = getSetting(db, "messages.synced_at");
  return page("Mesajlar", `${reconnectNote()}
<div class="card"><form class="inline" method="post" action="/sync/messages"><button>Mesajları çek</button></form>
 <span class="muted">Son çekme: ${esc(syncedAt ?? "henüz yok")} · Bu sayfa sadece okur, eBay'e hiçbir şey göndermez.</span></div>
<div class="wrap"><table><tr><th>Alıcı</th><th>Konu</th><th>Son mesaj</th><th>Sipariş</th><th>Zaman</th></tr>
${rows.map((r) => {
    const order = latestOrderOf(r.buyer);
    const fromBuyer = r.buyer && r.last_sender === r.buyer;
    const body = String(r.last_body ?? "");
    return `<tr><td>${Number(r.unread_count) > 0 ? "<b>●</b> " : ""}${esc(r.buyer ?? "?")}</td>
<td><a href="/messages/${encodeURIComponent(String(r.conversation_id))}">${esc(r.title)}</a></td>
<td><small>${fromBuyer ? "" : `<span class="muted">Sen:</span> `}${esc(body.length > 120 ? `${body.slice(0, 120)}…` : body)}</small></td>
<td><small>${order ? `${esc(order.order_id)}<br>${esc(order.fulfillment_status)}` : `<span class="muted">bulunamadı</span>`}</small></td>
<td><small>${esc(r.last_message_at)}</small></td></tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">Henüz mesaj yok. "Mesajları çek" butonuna bas.</td></tr>`}
</table></div>`);
}

function conversation(id: string): string | undefined {
  const c = db.prepare("SELECT * FROM conversations WHERE conversation_id = ?").get(id) as Record<string, unknown> | undefined;
  if (!c) return undefined;
  const msgs = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at").all(id) as Array<Record<string, unknown>>;
  const order = latestOrderOf(c.buyer);
  const items = order ? (JSON.parse(String(order.line_items)) as Array<{ title: string; quantity: number }>) : [];
  return page(String(c.title ?? "Konuşma"), `<p><a href="/messages">← Mesajlar</a></p>
<div class="card">Alıcı: <b>${esc(c.buyer ?? "?")}</b>${c.reference_id ? ` · İlan: ${esc(c.reference_id)}` : ""}<br>
${order ? `Son sipariş: <b>${esc(order.order_id)}</b> (${esc(order.created_at)}) · ${esc(order.fulfillment_status)}<br>
${items.map((i) => `${esc(i.quantity)}× ${esc(i.title)}`).join("<br>")}<br>
Kargo: ${order.tracking_number ? `${esc(order.carrier)} ${esc(order.tracking_number)}${order.tracking_uploaded_at ? " (eBay'e gönderildi)" : ""}` : `<span class="muted">takip no girilmemiş</span>`}`
    : `<span class="muted">Bu alıcıya ait sipariş panelde bulunamadı.</span>`}</div>
${msgs.map((m) => {
    const fromBuyer = c.buyer ? m.sender === c.buyer : true;
    const media = (m.media ? (JSON.parse(String(m.media)) as Array<{ mediaName?: string; mediaUrl?: string }>) : []).filter((x) => x.mediaUrl?.startsWith("https://"));
    return `<div class="msg ${fromBuyer ? "buyer" : "me"}"><small class="muted">${esc(m.sender)} · ${esc(m.created_at)}</small><br>${esc(m.body)}${media
      .map((x) => `<br><a href="${esc(x.mediaUrl)}" rel="noreferrer" target="_blank">📎 ${esc(x.mediaName ?? "ek")}</a>`).join("")}</div>`;
  }).join("")}`);
}

function rules(name = "default", error = ""): string {
  const sets = (db.prepare("SELECT key FROM settings WHERE key LIKE 'rules.%'").all() as Array<{ key: string }>).map((r) => r.key.slice(6));
  return page("Fiyat kuralları", `${error ? `<p class="err">${esc(error)}</p>` : ""}
<div class="card">Kayıtlı setler: ${["default", ...sets.filter((s) => s !== "default")].map((s) => `<a href="/rules?set=${encodeURIComponent(s)}">${esc(s)}</a>`).join(" · ")}</div>
<div class="card"><form method="post" action="/rules"><input name="set" value="${esc(name)}"><br>
<textarea name="json" rows="14" cols="60">${esc(JSON.stringify(rulesFor(db, name), null, 2))}</textarea><br><button>Kaydet</button></form>
<p><small>markupPercent: maliyet üstü kâr oranı (0.2 = %20) · minProfit: satış başı en az kâr · ebayFeePercent: eBay + ödeme komisyonu · quantityWhenInStock: eBay'de gösterilecek adet · maxSupplierPrice: bu maliyetin üstünde satışı durdur</small></p></div>`);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const post = req.method === "POST";

  if (!authorized(req)) return res.writeHead(401, { "WWW-Authenticate": 'Basic realm="panel"' }).end();

  if (url.pathname === "/") return send(res, 200, dashboard());
  if (url.pathname === "/products" && !post) return send(res, 200, products());
  if (url.pathname === "/orders") return send(res, 200, orders());
  if (url.pathname === "/rules" && !post) return send(res, 200, rules(url.searchParams.get("set") ?? "default"));
  if (url.pathname === "/messages" && !post) return send(res, 200, messages());
  if (parts[0] === "messages" && parts[1] && !post) {
    const html = conversation(parts[1]);
    return html ? send(res, 200, html) : send(res, 404, page("Bulunamadı", ""));
  }

  if (url.pathname === "/auth/ebay") {
    const state = randomBytes(16).toString("hex");
    setSetting(db, "ebay.oauth_state", state);
    return res.writeHead(302, { Location: authorizationUrl(config.ebay, state) }).end();
  }
  if (url.pathname === "/auth/ebay/callback") {
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.get("state") !== getSetting(db, "ebay.oauth_state")) return send(res, 400, page("Hata", "Geçersiz eBay yanıtı."));
    await exchangeCode(db, config.ebay, code);
    logEvent(db, "auth", "eBay account connected");
    return redirect(res, "/");
  }

  if (!post) return send(res, 404, page("Bulunamadı", ""));
  const form = await readForm(req);

  if (url.pathname === "/products") {
    db.prepare("INSERT INTO products (sku, ebay_offer_id, supplier, supplier_product_id, title, rule_set) VALUES (?, ?, ?, ?, ?, ?)").run(
      form.get("sku")!, form.get("ebay_offer_id") || null, form.get("supplier") ?? "manual", form.get("supplier_product_id")!, form.get("title") || null, form.get("rule_set") || "default");
    return redirect(res, "/products");
  }
  if (parts[0] === "products" && parts[2] === "delete") {
    db.prepare("DELETE FROM products WHERE sku = ?").run(parts[1]!);
    return redirect(res, "/products");
  }
  if (parts[0] === "products" && parts[2] === "manual") {
    const price = form.get("price");
    db.prepare("UPDATE products SET supplier_price = ?, supplier_in_stock = ? WHERE sku = ?").run(price ? Number(price) : null, form.has("in_stock") ? 1 : 0, parts[1]!);
    return redirect(res, "/products");
  }
  if (parts[0] === "orders" && parts[1]) {
    db.prepare("UPDATE orders SET supplier_order_id = ?, carrier = ?, tracking_number = ? WHERE order_id = ? AND tracking_uploaded_at IS NULL").run(
      form.get("supplier_order_id") || null, form.get("carrier") || null, form.get("tracking_number") || null, parts[1]);
    return redirect(res, "/orders");
  }
  if (url.pathname === "/rules") {
    const name = form.get("set") || "default";
    try {
      const parsed = JSON.parse(form.get("json") ?? "{}") as Record<string, unknown>;
      const unknownKeys = Object.keys(parsed).filter((k) => !(k in defaultRules) && k !== "maxSupplierPrice");
      if (unknownKeys.length) throw new Error(`Bilinmeyen alan: ${unknownKeys.join(", ")}`);
      setSetting(db, `rules.${name}`, JSON.stringify(parsed));
      return redirect(res, `/rules?set=${encodeURIComponent(name)}`);
    } catch (err) {
      return send(res, 400, rules(name, (err as Error).message));
    }
  }
  if (url.pathname === "/sync/prices") {
    await app.runPriceSync();
    return redirect(res, "/");
  }
  if (url.pathname === "/sync/orders") {
    await app.runOrderSync();
    return redirect(res, "/");
  }
  if (url.pathname === "/sync/messages") {
    if (needsMessageReconnect(db)) return redirect(res, "/messages");
    await app.runMessageSync();
    return redirect(res, "/messages");
  }
  send(res, 404, page("Bulunamadı", ""));
}

createServer((req, res) => {
  handle(req, res).catch((err: Error) => {
    logEvent(db, "error", err.message);
    send(res, 500, page("Hata", `<p class="err">${esc(err.message)}</p><a href="/">Geri dön</a>`));
  });
}).listen(config.port, process.env.HOST ?? "127.0.0.1", () => console.log(`Panel: http://localhost:${config.port}`));

// Background schedule; set the minutes to 0 to disable a job.
function every(minutes: number, name: string, job: () => Promise<unknown>) {
  if (minutes <= 0) return;
  setInterval(() => {
    if (!isConnected(db)) return;
    job().catch((err: Error) => logEvent(db, "error", `${name}: ${err.message}`));
  }, minutes * 60_000);
}
every(Number(process.env.PRICE_SYNC_MINUTES ?? 60), "prices", app.runPriceSync);
every(Number(process.env.ORDER_SYNC_MINUTES ?? 10), "orders", app.runOrderSync);
every(Number(process.env.MESSAGE_SYNC_MINUTES ?? 5), "messages", async () => {
  if (!needsMessageReconnect(db)) await app.runMessageSync();
});
