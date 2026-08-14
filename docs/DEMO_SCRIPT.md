# VoiceOps Studio — 30 saniyelik LinkedIn demo akışı

**Hazır video:** [`voiceops-linkedin-demo.mp4`](demo/voiceops-linkedin-demo.mp4)  
**Tekrar üretmek için:** `./script/build-linkedin-demo.sh`

## Ana mesaj

> Çok dilli bir ses demosunu, müşteriye kurulabilen ve kullanımı faturalandırılabilen yönetilen bir ürüne dönüştürdüm.

Videoda özellik listesi okumak yerine tek bir müşteri talebinin baştan sona ürün içindeki yolculuğu gösterilir.

## Kayıt öncesi

- Masaüstü ekranı 1440 × 900 veya 1920 × 1080 kullan.
- Tarayıcı yakınlaştırması `%100`, bildirimler kapalı, yalnız uygulama sekmesi açık olsun.
- `/#/present` sayfasını Türkçe aç.
- Veri işleme bilgilendirmesini ve ayrı talep kaydı iznini seç.
- Müşteri adı, telefon ve işletme bilgileri yalnız hazırlanmış demo verisi olsun.
- Mikrofon akışı çekilecekse önce ses seviyesini kontrol et; aksi hâlde metin alanı deterministik çekim sağlar.

## Zaman çizelgesi

| Süre | Ekran / hareket | Ekran yazısı veya anlatım |
| --- | --- | --- |
| 0–3 sn | Müşteriye göre markalanmış konsolu göster | “A multilingual voice demo is useful. A billable workflow is a product.” |
| 3–7 sn | Türkçe dili ve 10 dil seçeneğini aç-kapat | “One locale contract across browser, AI, speech and records.” |
| 7–12 sn | `Randevu oluştur` senaryosuna bas; ilk ses ölçümünü göster | “The agent listens and responds with live speech.” |
| 12–19 sn | `Adım Deniz Kaya` ve `Telefonum 0555 000 00 01` gir | “It collects only the missing fields and builds structured state.” |
| 19–23 sn | `KAYDEDİLDİ` durumunu, tarih ve saati göster | “The completed request becomes an encrypted, consented lead.” |
| 23–28 sn | `/#/admin` ekranına kesme yap; dakika ve görüşme kartlarını göster | “Usage is metered server-side, reportable and capped monthly.” |
| 28–30 sn | Canlı demo ve GitHub bağlantısını göster | “Live demo and engineering evidence in the post.” |

## Konuşmasız video için kısa altyazılar

1. `WHITE-LABEL / 10 LANGUAGES`
2. `LIVE SPEECH + STRUCTURED STATE`
3. `SEPARATE RECORD CONSENT`
4. `SERVER-SIDE USAGE METERING`
5. `MONTHLY COST LIMITS`

## Çekimde kullanacağımız demo verisi

```text
Talep: Yarın öğleden sonra saat üç için randevu almak istiyorum.
İsim: Adım Deniz Kaya.
Telefon: Telefonum 0555 000 00 01.
```

Bu veriler kurgusaldır; gerçek müşteri bilgisi kullanılmaz.

## Paylaşım sırası

1. Video: 30 saniyelik ana akış.
2. Görsel: `docs/assets/voiceops-product-console.png`.
3. Görsel: `docs/assets/voiceops-admin-dashboard.png`.
4. Görsel: `docs/assets/voiceops-product-mobile.png`.

Videoyu sessiz izleyenler için altyazı zorunlu tutulmalı. İlk iki saniyede ürünün sonucu görünmeli; logo animasyonu veya uzun giriş kullanılmamalıdır.
