# eBay Dropship Paneli

Kendi sunucunda çalışan, AutoDS benzeri bir eBay mağaza otomasyonu:

- **Fiyat ve stok takibi:** tedarikçi fiyatını periyodik olarak kontrol eder, senin kurallarına göre eBay fiyatını hesaplar, stok bitince ilanın adedini 0 yapar.
- **Sipariş yönetimi:** açık eBay siparişlerini çeker. Tedarikçi sipariş numarasını ve kargo takip numarasını panelden girersin, takip numarası eBay'e otomatik gönderilir.
- **Müşteri mesajları (sadece okuma):** alıcı mesajlarını eBay Message API'den çeker, **Mesajlar** sayfasında konuşma konuşma gösterir ve her konuşmanın yanında alıcının son siparişini ve kargo durumunu gösterir. Şimdilik eBay'e hiçbir mesaj göndermez.
- **Kendi kuralların:** birden fazla fiyat kural seti (kâr oranı, en az kâr, komisyon, gösterilecek adet, maliyet sınırı, fiyat sonu .99).
- **Tedarikçiler:** Amazon (Keepa API üzerinden, scraping yok) ve manuel/toptancı (fiyat ve stoğu sen girersin ya da script ile güncellersin). Yeni tedarikçi eklemek için `src/suppliers/types.ts` içindeki `Supplier` arayüzünü uygulaman yeterli.

Sadece eBay'in resmi API'lerini (Sell Inventory, Fulfillment ve Commerce Message) kullanır.

## Önemli: kurallar

- **eBay dropshipping politikası:** başka bir perakendeciden (Amazon, Walmart...) alıp doğrudan müşteriye gönderdirmek eBay'de yasak. Sadece toptancı tedarikçiyle dropshipping'e izin var. Amazon tedarikçisini fiyat araştırması için ya da riskini bilerek kullan. Kalıcı iş için toptancı öneriyorum.
- **Amazon:** scraping ve otomatik sipariş botları Amazon'un kullanım şartlarına aykırı. Bu proje Amazon verisini Keepa API'den okur ve tedarikçi siparişini otomatik vermez.

## Kurulum

Gerekenler: Node.js 22.13 veya üstü.

```bash
npm install
cp .env.example .env   # sonra .env içini doldur
npm start              # http://localhost:3000
```

### eBay anahtarları

1. https://developer.ebay.com adresinde geliştirici hesabı aç.
2. **Application Keys** sayfasından Sandbox (ve sonra Production) için App ID (Client ID) ve Cert ID (Client Secret) al.
3. **User Tokens** sayfasında "Get a Token from eBay via Your Application" bölümünden bir **RuName** oluştur. "Your auth accepted URL" alanına `http://localhost:3000/auth/ebay/callback` yaz. Production için eBay HTTPS adres ister, sunucuya taşıyınca kendi alan adını gir.
4. Bu değerleri `.env` dosyasına yaz, paneli aç ve **eBay hesabını bağla** de.

Önce `EBAY_ENV=sandbox` ile dene, her şey çalışınca `production`'a geç.

### Keepa (Amazon fiyat/stok)

https://keepa.com/#!api adresinden API anahtarı al ve `KEEPA_API_KEY` olarak yaz. Keepa ücretli ve token bazlı, her kontrol token harcar. `PRICE_SYNC_MINUTES` ile kontrol sıklığını ayarla.

## Kullanım

1. **Ürünler** sayfasında ürün ekle: eBay SKU, eBay offer ID, tedarikçi ve tedarikçi ürün kodu (Amazon için ASIN).
2. **Kurallar** sayfasında `default` setini kendi marjına göre düzenle. Farklı kategoriler için başka setler de açabilirsin.
3. Fiyat/stok kontrolü varsayılan olarak saatte bir, sipariş çekme 10 dakikada bir çalışır. Özet sayfasındaki butonlarla elle de çalıştırabilirsin.
4. Sipariş geldiğinde **Siparişler** sayfasında adresi gör, tedarikçiden sipariş ver, tedarikçi sipariş numarasını ve kargo takip numarasını gir. Bir sonraki senkronizasyonda takip numarası eBay'e gider ve sipariş "gönderildi" olur.

Not: eBay Inventory API sadece Inventory API ile oluşturulmuş ilanlarda çalışır. Seller Hub'dan açtığın eski ilanları önce eBay'in `bulk_migrate_listing` çağrısıyla taşıman gerekir. Bu adım bir sonraki sürümde panele eklenebilir.

### Mesajlar

Mesaj özelliği eklenmeden önce eBay hesabını bağladıysan, panel **Mesajlar** sayfasında "eBay hesabını yeniden bağla" der. Bir kez tıklayıp izin vermen yeterli. Fiyat ve sipariş senkronu bu sırada çalışmaya devam eder.

İlk çekme son `MESSAGE_HISTORY_DAYS` günün (varsayılan 90) konuşmalarını getirir, sonra her `MESSAGE_SYNC_MINUTES` dakikada (varsayılan 5) sadece yenileri çekilir. `EBAY_SELLER_USERNAME` doluysa panel senin mesajlarını alıcınınkinden kesin olarak ayırır; boşsa alıcıyı sipariş listesinden tahmin eder.

## Ayarlar (.env)

| Değişken | Açıklama |
| --- | --- |
| `EBAY_ENV` | `sandbox` veya `production` |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME` | eBay geliştirici anahtarları |
| `EBAY_MARKETPLACE_ID`, `EBAY_CURRENCY` | Örn. `EBAY_US`, `USD` |
| `KEEPA_API_KEY`, `KEEPA_DOMAIN` | Amazon verisi için (1 = amazon.com) |
| `PORT`, `HOST` | Panel adresi (varsayılan `127.0.0.1:3000`) |
| `PANEL_PASSWORD` | Paneli sunucuya açarsan mutlaka belirle (tarayıcı şifre sorar) |
| `PRICE_SYNC_MINUTES`, `ORDER_SYNC_MINUTES`, `MESSAGE_SYNC_MINUTES` | Otomatik çalışma sıklığı, 0 kapatır |
| `EBAY_SELLER_USERNAME` | eBay kullanıcı adın (mesajlarda kimin yazdığını ayırmak için) |
| `MESSAGE_HISTORY_DAYS` | İlk mesaj çekmede kaç gün geriye gidilsin (varsayılan 90) |
| `DATABASE_PATH` | SQLite dosyası (varsayılan `data/app.db`) |

## Geliştirme

```bash
npm test          # testler
npm run typecheck
npm run dev       # değişiklikte otomatik yeniden başlatır
```

## Yol haritası

- Seller Hub ilanlarını içe aktarma ve migration
- Tedarikçi ürününden eBay ilanı oluşturma (başlık/açıklama şablonları, görseller)
- Toptancı CSV fiyat listesi içe aktarma
- Sipariş ve kâr raporları, e-posta/Telegram bildirimleri
