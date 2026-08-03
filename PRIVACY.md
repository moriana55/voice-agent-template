# Arama - veri işleme notu

Bu proje sesli müşteri talebini işleyen bir uygulamadır. Canlıya alınmadan önce
işletmeye özel KVKK/GDPR metni ve hukuki dayanak ayrıca doğrulanmalıdır.

## İşlenen veri

- Kullanıcının gönderdiği ses veya metin
- Görüşme dökümü
- Kullanıcı paylaşırsa isim, telefon ve randevu tercihi
- Teknik istek bilgisi: zaman, endpoint, durum kodu, süre ve rastgele istek kimliği

Ham ses kalıcı olarak saklanmaz. Tamamlanan talebin yapılandırılmış özeti ve son
görüşme mesajları `DATA_DIR` altındaki çağrı kayıtlarına yazılır.

## Koruma

- Production ortamında `DATA_ENCRYPTION_KEY` ayarlanmadıkça readiness kontrolü
  başarılı olmaz.
- API loglarına döküm, isim, telefon veya ses içeriği yazılmaz.
- Yönetim kayıtları yalnızca `ADMIN_API_KEY` ile okunabilir veya silinebilir.
- Varsayılan saklama süresi 30 gündür; `RECORD_RETENTION_DAYS` ile değiştirilebilir.
- Tarayıcı, açık kabul olmadan görüşme isteği göndermez; sunucu da `consent=true`
  olmayan web isteklerini reddeder.
- Twilio karşılama mesajı görüşmenin yapay zekâ servisleriyle işleneceğini bildirir.

## Veri akışı

Yapılandırmaya göre ses Fish Audio veya OpenAI'ye; metin Anthropic veya OpenAI'ye
gönderilebilir. Tamamlanan kayıt, isteğe bağlı CRM ve takvim webhooklarına
aktarılabilir. İlgili sağlayıcı sözleşmeleri, veri konumu ve saklama koşulları
işletme tarafından ayrıca değerlendirilmelidir.

## Silme

Tek bir kayıt aşağıdaki yönetim endpointiyle silinebilir:

```text
DELETE /api/admin/records/:id
Authorization: Bearer <ADMIN_API_KEY>
```
