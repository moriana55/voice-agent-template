# VoiceOps Studio - veri işleme notu

Bu proje sesli müşteri talebini işleyen bir uygulamadır. Canlıya alınmadan önce
işletmeye özel KVKK/GDPR metni ve hukuki dayanak ayrıca doğrulanmalıdır.

## İşlenen veri

- Kullanıcının gönderdiği ses veya metin
- Görüşme dökümü
- Kullanıcı paylaşırsa isim, telefon ve randevu tercihi
- Teknik istek bilgisi: zaman, endpoint, durum kodu, süre ve rastgele istek kimliği

Ham ses kalıcı olarak saklanmaz. Görüşmenin restart sonrasında devam edebilmesi
için aktif görüşmenin son başarılı durumu, `WEB_SESSION_STORAGE=encrypted-file`
iken `DATA_DIR` altında şifreli biçimde en fazla `WEB_SESSION_TTL_MINUTES`
(varsayılan 120 dakika) tutulur. Bu geçici operasyon durumu, ayrıca izin verilen
tamamlanmış müşteri kaydından ayrıdır. Yalnızca kullanıcı ayrı kayıt iznini
seçerse tamamlanan talebin yapılandırılmış özeti ve son görüşme mesajları çağrı
kayıtlarına daha uzun süreli olarak yazılır.

## Koruma

- Production ortamında `DATA_ENCRYPTION_KEY` ayarlanmadıkça readiness kontrolü
  başarılı olmaz.
- API loglarına döküm, isim, telefon veya ses içeriği yazılmaz.
- Yönetim kayıtları yalnızca `ADMIN_API_KEY` ile okunabilir veya silinebilir.
- Varsayılan saklama süresi 30 gündür; `RECORD_RETENTION_DAYS` ile değiştirilebilir.
- Geçici restart oturumları startup sırasında ve periyodik olarak TTL'ye göre
  temizlenir; bozuk veya yanlış anahtarlı oturum deposu sessizce sıfırlanmaz.
- Tarayıcı, veri işleme bilgilendirmesi kabul edilmeden görüşme isteği göndermez;
  sunucu da `noticeAcknowledged=true` olmayan web isteklerini reddeder.
- Kayıt/aktarım izni `storageConsent` ile bilgilendirme kabulünden ayrı tutulur.
- Twilio karşılama mesajı görüşmenin yapay zekâ servisleriyle işleneceğini bildirir.
  Telefon kaydı `TELEPHONY_RECORD_STORAGE=enabled` açıkça ayarlanana kadar kapalıdır.
- Faturalama sayacı ham içerik yerine çağrının özetlenmiş aktif ses saniyesini ve
  tek yönlü çağrı kimliği özetini saklar.

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
