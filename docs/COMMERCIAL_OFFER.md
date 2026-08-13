# VoiceOps Studio — ticari paket ve fiyatlama

Bu belge ilk müşteri görüşmelerinde kullanılacak ürün sınırını ve fiyat tabanını tanımlar. Fiyatlar KDV hariç tekliflenmeli ve sağlayıcı maliyetleri her ay yeniden kontrol edilmelidir.

## Önerilen başlangıç paketi

| Kalem | Fiyat |
| --- | ---: |
| Tek seferlik kurulum | 14.900 TL |
| Aylık yönetilen hizmet | 4.900 TL |
| Dahil aktif ses kullanımı | 300 dakika |
| Paket aşımı — web | 12 TL/dakika |
| Paket aşımı — telefon | 15 TL/dakika + operatör numara bedeli |

Kurulum; müşteriye özel marka ve ajan adı, işletme bilgi tabanı, seçilen diller, bir CRM/takvim webhook'u, gizlilik bağlantısı ve canlıya alma kontrolünü kapsar. Yeni kapsam, özel panel geliştirmesi, SLA, çağrı merkezi yönlendirmesi ve hukuki danışmanlık ayrıca fiyatlanır.

## Neden yalnız dakika satmıyoruz?

Sabit aylık ücret; sunucu, izleme, sağlayıcı hesabı, bakım, hata takibi ve müşteri desteğini karşılar. Dakika bedeli yalnız değişken kullanımı taşır. Bu nedenle `0 TL sabit + dakika` modeli düşük trafikli müşteride sürdürülebilir değildir.

## Doğrulanmış maliyet tabanı

- Fish Audio `transcribe-1`: **$0,36 / ses saati**, yaklaşık **$0,006/dakika**.
- Fish Audio S2 Pro: **$15 / 1 milyon UTF-8 byte**; sağlayıcının İngilizce eşdeğerine göre yaklaşık 12 saat konuşma, yani yaklaşık **$0,021/dakika**.
- Sadece Fish ses katmanı toplamı yaklaşık **$0,027/dakika**dır. Dil, konuşma hızı ve UTF-8 byte sayısı TTS maliyetini değiştirir.
- LLM token maliyeti, Railway kullanımı, ağ çıkışı, ödeme/fatura gideri, destek ve başarısız çağrılar bunun üzerine eklenir.

Resmî kaynaklar: [Fish Audio fiyatları](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits), [Railway fiyatlandırması](https://railway.com/pricing), [OpenAI GPT-5.4 mini duyurusu](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/).

İlk tekliflerde iç maliyet için **2–3 TL/dakika güvenli taban**, satış fiyatı için **12 TL web / 15 TL telefon** kullanılmalıdır. Gerçek marj, ilk müşterinin bir aylık sağlayıcı faturasıyla yeniden kalibre edilmelidir.

## Ürün içindeki faturalama sınırı

Uygulama bugün `active-voice-seconds` ölçer: gönderilen sesin WAV süresi ile ajan yanıtının sunucu taraflı konuşma süresi tahmini toplanır. Aylık toplam saniye dakikaya çevrilir; tur başına dakika yuvarlaması yapılmaz. Telefon operatörünün hat süresi ayrıca faturalandırılıyorsa Twilio durum callback'i eklenmeden bu ölçüm “telefon hattında kalma süresi” diye sunulmamalıdır.

`USAGE_HARD_LIMIT_MINUTES` sağlayıcı maliyetini sınırlar. Ücretli müşteri ortamında bu değer sıfır bırakılamaz; `CUSTOMER_MODE=true` readiness kontrolü eksik ticari yapılandırmayı reddeder.

## Satış sınırı

Mevcut sürüm, yönetilen ve müşteriye özel tekil kurulum olarak satılabilir bir MVP'dir. Self-servis çok kiracılı SaaS, otomatik ödeme, rol tabanlı müşteri hesapları, garantili webhook kuyruğu, harici alarm ve SLA henüz kapsam dışıdır.
